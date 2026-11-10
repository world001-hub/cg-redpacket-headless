---
name: cg-redpacket-headless
description: 红包接龙（Cocos H5 前端 + Go/WASM 游戏 SDK + 云信 NIM 聊天室）的 headless 抢包方案。核心是把游戏自己的 sdk.wasm 放进 Node 的 vm 沙箱里直接跑（完全不启动浏览器），网络层用 undici(HTTP/2)+SOCKS5，聊天室只开一个实例、把红包事件通过 TCP 指令通道广播给其它窗口，抢包请求按「公告自带的 roomID」下发，所有 SDK 调用串行化。文档包含参考实现「CG红包接龙通用版」的完整解构（engine.js 27KB + 控制器 exe + 依赖清单）、抢包判定逻辑（余额最高首抢 / 余额最低收尾 / 逻辑金额 / 补救延迟 / 休止节奏）、该平台真实 API 契约（t=1 开包 / t=2 领取 / t=3 结算，消息体带 roomID）、以及六个必踩的坑（2 分钟未抢包被重分房间、join 回显房间号不可信、多聊天室实例互踢、WASM 并发调用越界即报废、代理出口 IP 与登录 IP 必须一致、页面白屏）。当用户要做红包接龙/抢红包自动化、复现 headless 抢包、分析同类 H5 小游戏 SDK 宿主方案、或排查「同桌完成却抢不到」时加载。
whenToUse: 用户要求实现/复现红包接龙自动抢包；要把浏览器方案换成 headless；需要该平台 SDK 的 Node 宿主引导代码；需要排查 500「不在本房间」/510「超过2分钟未抢包」/SDK 卡死；需要把抢包逻辑固化成技能复用。
---

# 红包接龙 headless 抢包：SDK 沙箱宿主方案

> 结论先行：**这套平台（`cocos.*.com/Hbjl/` + `h5-api.nwitkey.com`）的正确打法不是"用浏览器点按钮"，而是把游戏自己的 `sdk.wasm` 放进 Node 沙箱里直接调用。**
> 浏览器方案（CDP + 页面注入）能跑，但每次调用多两跳（CDP → 页面 → WASM → fetch），实测比 headless 慢 80~150ms，且页面会白屏、会因 2 分钟规则被踢。

---

## 1. 平台与协议事实（实测，非推测）

| 项 | 事实 |
|---|---|
| 前端 | Cocos Creator 3.x，`SystemJS` + `import-map`，页面里挂 `window.gameSdk`（Go/WASM）与 `window.Chatroom`（云信 NIM） |
| API 主机 | `https://h5-api.nwitkey.com`（页面带的 `sk` 参数就是它） |
| 关键接口 | `POST /games/redbag/chain/v1/room/join`、`POST /games/redbag/chain/v1/room/out`、`GET /games/redbag/chain/v1/room/grab/list?params=` ；抢包是 `grabRoomRedBag(roomId, packetId)` |
| 请求体 | 加密（AES 系，非聊天室那把 key），**不要试图裸 HTTP 复刻**，正确做法是让 WASM SDK 自己发 |
| 聊天室消息 | AES-256-CBC，`key = SHA256('f36b75b67fe5b39f')`，`iv = 0000000000000000`（Hex） |
| 消息类型 | `t=1` 开新包（含 `bags`、`roomID`）｜`t=2` 领取（含 `grab` 序号、`roomID`）｜`t=3` 结算（含 `list[]` 金额与 `min` 标记）｜`t=4` 系统公告（中奖播报） |
| 分桌 | `joinRoom(gameId, roomType)` 随机分配（本平台实测在 47~54 之间跳），**无法指定房间号** |
| 2 分钟规则 | 账号 **120 秒内没"抢到过包"** → 下一次抢包直接回 `510 你已超过2分钟未抢包，重新为你分配房间`，且房间已被改掉 |

---

## 2. 参考实现的架构（CG红包接龙通用版）

```
CG红包接龙通用版.exe            49KB  .NET WinForms 控制器：UI + 角色分配 + 判定 + 日志
└─ engine\node.exe            85MB  Node 运行时
   └─ engine\engine.js        27KB  单窗口协议引擎（每个账号一个进程）
      ├─ ok_combined.83bbb.js  272KB 游戏客户端逻辑（含 WASM 加载器，产出 gameSdk）
      ├─ sdk.wasm              773KB 游戏 SDK 本体（Go/TinyGo）
      ├─ ok_NIM_BROWSER_SDK.js 404KB 云信 IM
      ├─ ok_CHATROOM_BROWSER_SDK.js 249KB 聊天室
      ├─ ok_CryptoJS.a87c6.js   50KB  AES 解密
      └─ undici\ + socks\      HTTP/2 客户端 + SOCKS5（proxy-agent 方式）
```

**进程模型**：URL 里 `slot` 参数决定窗口；**只有 slot=1 连聊天室**，其余窗口只跑 SDK 等指令。

---

## 3. 沙箱引导（可直接抄的部分）

```js
const vm = require('vm'), fs = require('fs'), path = require('path');

const base = {
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  TextEncoder, TextDecoder, Date, Math, JSON, Promise,
  Uint8Array, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array,
  Float32Array, Float64Array, ArrayBuffer, DataView, WebAssembly,
  performance: { now: () => Date.now() },
  crypto: require('crypto').webcrypto,
  fetch: SFetch, Request, Response, Headers, WebSocket: SWs,        // 网络层见第 4 节
  location: { href: 'https://localhost/', protocol: 'https:', host: 'localhost', hostname: 'localhost' },
  navigator: { userAgent: dev.ua, platform: dev.platform, language: dev.lang,
               languages: [dev.lang], hardwareConcurrency: 8, maxTouchPoints: 5 },
  screen: { width: dev.w, height: dev.h, availWidth: dev.w, availHeight: dev.h, colorDepth: 24 },
  devicePixelRatio: dev.dpr, innerWidth: dev.w, innerHeight: dev.h,
  localStorage: { getItem: (k) => deviceStore[k] ?? null, setItem: (k, v) => { deviceStore[k] = String(v); }, removeItem: (k) => { delete deviceStore[k]; } },
  sessionStorage: { /* 同上，内存实现 */ },
  XMLHttpRequest: class { /* open/send/setRequestHeader 用 fetch 实现，回调 onreadystatechange/onload */ },
};
const sandbox = new Proxy(base, { get(t, p) { return p in t ? t[p] : globalThis[p]; } });
sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
sandbox.addEventListener = () => {}; sandbox.removeEventListener = () => {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('ok_combined.83bbb.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync('ok_CryptoJS.a87c6.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync('ok_NIM_BROWSER_SDK.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync('ok_CHATROOM_BROWSER_SDK.js', 'utf8'), sandbox);
// 之后所有调用都是 sandbox.gameSdk.方法名(...)
```

**设备指纹**必须有：`navigator.userAgent`（安卓/iOS 机型池轮换）、`screen`、`devicePixelRatio`、`localStorage.deviceId/device_id/clientId` 等键写同一个唯一 ID。
同一 IP 下多开、且指纹完全一致 → 触发风控（页面白屏 / 抢包被拒）。参考实现准备了 500 套。

---

## 4. 网络层：undici + SOCKS5 + 本机 IP 绑定

```js
const undici = require('undici');
const { SocksClient } = require('socks');

const agent = new undici.Agent({
  connectTimeout: 10000,
  connect: (opts, cb) => {
    SocksClient.createConnection({
      proxy: { host, port, type: 5, userId, password },
      command: 'connect',
      destination: { host: opts.hostname, port: opts.port },
      timeout: 10000,
    }).then((i) => cb(null, i.socket)).catch(cb);
  },
});
const SFetch = (u, o) => undici.fetch(u, { ...o, dispatcher: agent });
const SWs = (u, p) => new undici.WebSocket(u, { dispatcher: agent });
```

两个要点：
1. **fetch 与 WebSocket 必须走同一个出口**。`undici.WebSocket` 支持 `dispatcher`，这样聊天室与 API 同一个 IP。
2. 多网卡机器可以不用代理，直接 `net.Socket.prototype.connect` 打补丁绑本地 IP：
```js
const orig = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (o, ...rest) {
  if (o && typeof o === 'object' && !o.localAddress) o = { ...o, localAddress: BIND_IP };
  return orig.call(this, o, ...rest);
};
```

---

## 5. TCP 指令通道（控制器 ↔ 引擎）

一行一条 JSON，`\n` 分隔，端口 `9100 + slot`：

| 指令 | 作用 | 回包 |
|---|---|---|
| `{"cmd":"join"}` | 登录（首次自动）+ 进房 | `{"type":"joinres","room":..,"expect":..,"netId":..,"bagMoney":..}` |
| `{"cmd":"change"}` | **先 `loginOutRoom` 再 `joinRoom`**（换桌必须显式退房） | 同上 |
| `{"cmd":"grab","id":"<包id>"}` | 抢包 | `{"type":"grabres","id":..,"res":{code,data:{money}}}` |
| `{"cmd":"money"}` | 余额 | `{"type":"money","balance":..}` |
| `{"cmd":"rooms"}` | 房间列表（`getRoomList`） | `{"type":"rooms"}` |
| `{"cmd":"info","expect":..}` | 单包详情（`getRoomRedBagInfo`） | `{"type":"info"}` |
| `{"cmd":"chat","on":1}` | 运行中开关聊天室 | `{"type":"evt"}` |
| 事件推送 | 红包事件 | `{"type":"bagid","id":..,"room":..,"btype":1\|2\|3,"grab":n,"bags":3}` |

**所有 SDK 调用必须串行**（单线程 WASM，并发会 `memory access out of bounds` 且实例报废）：

```js
let sdkQ = Promise.resolve(), lastEnd = 0;
const call = (fn, args, ms) => {
  const run = sdkQ.then(() => {
    const gap = lastEnd + 20 - Date.now();          // 20ms 间隔更稳
    if (gap > 0) return new Promise((r) => setTimeout(r, gap));
  }).then(() => sandbox.gameSdk[fn].apply(sandbox.gameSdk, args));
  run.then(() => { lastEnd = Date.now(); }, () => { lastEnd = Date.now(); });
  sdkQ = run.catch(() => {});
  return Promise.race([run, new Promise((r) => setTimeout(() => r({ __TIMEOUT: fn }), ms || 5000))]);
};
```

---

## 6. 聊天室：单实例 + roomID 过滤

```js
chatroomChat = new sandbox.Chatroom({ appkey, account, token, chatroomId: String(netId),
  chatroomAddresses: nimChat.clientSocket.linkUrls, isAnonymous: false });
chatroomChat.on('chatroomMsg', (a) => {
  const pt = sandbox.CryptoJS.AES.decrypt(a.body,
    sandbox.CryptoJS.SHA256('f36b75b67fe5b39f'),
    { iv: sandbox.CryptoJS.enc.Hex.parse('0000000000000000'),
      mode: sandbox.CryptoJS.mode.CBC, padding: sandbox.CryptoJS.pad.Pkcs7 }).toString(sandbox.CryptoJS.enc.Utf8);
  const n = JSON.parse(pt);
  if (n.roomID && Number(n.roomID) !== Number(room)) return;   // ★ 关键：只认自己房间
  onBag(n);
});
```

- 进房/换桌**必须先 `destroy()` 旧 chatroom 与 nim**，否则重复实例永远加不进新房间。
- `slot=1` 才连聊天室；其它窗口通过 TCP 收 `bagid` 事件转发的包 id，**不要**各自连聊天室。

---

## 7. 抢包判定逻辑（**已反编译控制器 exe 得到，非推测**）

反编译产物：`MainForm.cs` 2511 行（ILSpy 9.0 反编译，命令见第 12 节）。
核心三处：`HandleNewBag`(1687) 选角色 → `TryGrab`(1991) 下发 → `HandleGrabRes`(2050) 逐刀判定。

### 7.1 角色分配（每包重算）

```csharp
// 首抢
firstMode==4 : 余额最高          // "余额最高首抢"
firstMode==2 : array[circNext++] // "循环首抢"
firstMode==3 : fixedFirstIdx     // 固定；不在线则随机
default      : array[0]
// 2 抢
if (chkBalLowSecond) w2 = 除首抢外余额最低; else w2 = fixed2Idx（与首抢重复则取消）
// 尾包
if (chkBalLowLast)   w5 = 排除首抢/2抢后余额最低; else w5 = lastGrabIdx（固定抢尾）
// 剩余窗口：洗牌后依次填 w3(w4)
```

三包房要求可用窗口 ≥ 3，否则 `autoGrab=false` 直接停机。

### 7.2 下发前的双重校验（这就是「不在本房间」的防线）

```csharp
private bool TryGrab(int slot, long id, GrabRound r) {
    if (engState[slot] != "joined") return false;                 // 引擎必须已进房
    long room; long.TryParse(eng[slot].Room, out room);
    if (r.bagRoom > 0 && room > 0 && room != r.bagRoom) {         // ★ 引擎当前房号 ≠ 包所属房号 → 跳过
        MasterLog("窗口.. 桌号" + room + " ≠ 红包桌" + r.bagRoom + " → 跳过抢 " + id);
        return false;
    }
    SendTo(slot, "{\"cmd\":\"grab\",\"id\":" + id + "}");
}
```

`bagRoom` 来自**开包公告里的 `roomID`**，不是 join 回显。

### 7.3 逐刀判定（phase 状态机，三包房）

```
phase0: 首抢 → 失败=本包结束（不补刀）
              成功 m1:  if (m1 >= 逻辑金额) 结束        ← B、C 都不抢
                        else phase=1 → 下发 w2
phase1: 2 抢 → 失败=结束
              成功 m2:  剩余 = bagMoney − m1 − m2
                        if (剩余 < min(m1,m2)) 结束      ← 陌生人拿尾包当最低
                        else phase=2 → 下发 w5（尾包）
phase2: 尾包 → 拿到即结束；失败结束
```

五包房同理，但用 **剩余/剩余坑数** 与当前最小比较（`num4/(bagCount-2) < num6`）。

### 7.4 与用户规则的三处差异（重要）

| 项 | 参考实现（反编译实证） | 我们当前实现 | 结论 |
|---|---|---|---|
| a1 停手阈值 | **`m1 >= 逻辑金额(2.9)`** | 3.17（数学包赢临界） | 2.9 在 2.9~3.17 区间会让两个陌生人分掉剩余而他们都 > a1 → **我们反而成最低**。3.17 更稳 |
| 尾包阈值 | 只用 `剩余 < min(m1,m2)`，**不再看 2.9** | 同 | 一致 |
| 失败补刀 | **没有**，抢失败即放弃本包 | 有 keepalive / 全抢 | 参考实现更保守 |
| `SubDelay()`（补救延迟） | **定义了但从未被调用**（死代码） | 我们曾用它做延迟 | 可忽略 |

结论：**判定骨架与我们一致，唯一实质差异是 a1 的阈值取 2.9 还是 3.17**。建议保留 3.17（等于参考实现的阈值 + 数学保护）。

---

## 8. 六个必踩的坑（血换来的）

1. **join 回显的 `RoomId` 不可信**。服务端 2 分钟没抢包会把你挪房，而页面/引擎里的 `room` 变量还是旧值 → 之后所有抢包回 `500 您不在本房间`。**以公告里的 `roomID` 为准**，并且每 80 秒让每个号抢一刀保活。
2. **必须按 `roomID` 过滤聊天室消息**。切房瞬间会收到旧房间的包，拿它去抢就是 500。
3. **WASM SDK 并发必炸**。`grabRoomRedBag` 与 `getUserMoney` 同时调用 → `RuntimeError: memory access out of bounds`，之后该实例永久损坏（只能重启进程）。串行队列 + 20ms 间隔。
4. **页面（浏览器方案）会白屏**。Cocos 起了、`cc.director.getScene() === null`、`window.gameSdk === undefined`，重载/重开浏览器都不一定救回来——这是 headless 方案的最大动机。
5. **代理出口与登录出口必须一致**。join 走代理、抢包走直连（`--proxy-bypass-list`）→ 服务端判定"不在本房间"。要直连就让全部请求直连。
6. **单 IP 三号同房抢包会被拒**（本平台实测 500），且三号同房本身需要三个 IP；两号同 IP 可以。

---

## 9. 实测数据（本机，2026-11）

| 指标 | 数值 |
|---|---|
| headless 登录 | 236ms |
| 进房（join） | 511ms |
| 聊天室加入 | 1.4s |
| 房间抢满节奏 | 公告→第1刀 +260ms，→第2刀 +468ms，→第3刀 +1154ms |
| 浏览器方案单次调用 | 180~250ms（走代理）→ 结构上抢不到第 2、3 刀 |

**推论**：房间大约 1.1 秒抢满，只要「知道 a1 → 出手」压到 300ms 内，第 2、3 刀都能拿到。浏览器方案做不到；headless 直接调用可以。

---

## 10. PoC 复现（已在本机跑通）

```powershell
cd E:\CG_analyze\engine
.\node.exe engine.js 9100 "<游戏链接>" 1
# 另一个终端：TCP 发指令
node tcpcli.cjs 9100 join 25000
```

输出（节选）：
```
+236ms  {"type":"evt","ev":"登录成功"}
+511ms  {"type":"evt","ev":"进房成功 桌号52 期号59807550 包总额10"}
+1443ms {"type":"evt","ev":"聊天室已加入 netId=13154505524"}
+3817ms {"type":"bagid","id":59807562,"room":52,"btype":1}
+4077ms {"type":"bagid","id":59807562,"room":52,"btype":2,"grab":1}
```

---

## 11. 验收标准

1. `joinres` 里 `room/netId/bagMoney` 正常返回，聊天室 `logined`。
2. 连续 10 期里，`t=1` 消息的 `roomID` 与 `joinres.room` **完全一致**（不一致就说明被挪房）。
3. 三号同桌时，同一期结算 `t=3` 的 `list[]` 里出现三个我们的昵称。
4. 同一期 `t=2` 的 `grab` 依次为 1→2→3 且三个 uid 都是我们。
5. 无 `500 您不在本房间`、无 `510 超过2分钟未抢包`。

---

## 12. 与浏览器方案（E:\红包接龙助手\engine.cjs）的迁移对照

| 浏览器方案 | headless 方案 |
|---|---|
| Chrome + CDP + 页面注入 agent.js | `vm` 沙箱直接调 `sandbox.gameSdk` |
| 三页面各连聊天室 | 只 slot=1 连，TCP 广播 |
| `S.roomId` 判同房 | 公告 `roomID` + 每 80s 保活 |
| 页面 `grab()` + 2.5s 超时 | 串行队列 + 20ms 间隔 |
| 代理走本地 HTTP 中继 | undici dispatcher + socks |

迁移时**保留判定规则与面板**，只换传输层。


---

## 13. 反编译参考控制器（可复现）

控制器 `CG红包接龙通用版.exe` 是 **.NET Framework WinForms** 程序（PE32 + CLR header，50KB）。
用 ILSpy 命令行即可完整还原 C#：

```powershell
# 1) 下载 ILSpy 命令行（nuget 包解压即可，无需安装 SDK）
Invoke-WebRequest https://www.nuget.org/api/v2/package/ilspycmd/9.0.0.7889 -OutFile ilspycmd.zip
Expand-Archive ilspycmd.zip -DestinationPath ilspycmd
# 2) 反编译（本机已有 .NET 8 运行时）
dotnet ilspycmd\tools\net8.0\any\ilspycmd.dll -p -o src "CG红包接龙通用版.exe"
```

产物：`MainForm.cs`(62.7KB/2511 行)、`EngineClient.cs`、`J.cs`、`Program.cs`、`PromptForm.cs`。
本仓库 `reference/decompiled/` 已放入 `MainForm.cs` 与 `EngineClient.cs` 作为证据。

关键行号导航：

| 行号 | 方法 | 作用 |
|---|---|---|
| 1687 | `HandleNewBag` | 新包：止损检查 → 选首抢/2抢/尾包 → 下发首抢 |
| 1991 | `TryGrab` | 下发前校验：engine 已进房 + **当前房号 == 包房号** |
| 2050 | `HandleGrabRes` | phase 状态机：a1 判 `>= 逻辑金额` 停；a2 判 `剩余 < min(m1,m2)` 停 |
| 2014 | `SubDelay` | 补救延迟，**定义了但从未调用**（死代码） |
| 1150 | `AutoChangeRoom` | 换房（匹配目标桌号，5 次不中则停机） |
| 1193 | `HeartbeatCheck` / `CheckOffline` | 心跳与掉线判定 |

---

## 14. 实测进展（headless 落地记录）

### 14.1 单号闭环（已验证）

用参考实现 `engine.js` 作传输层 + 直连，实测 55 秒 6 次抢包：

```
公告→抢到：246 / 247 / 269 / 272 / 273 ms（中位 269ms，最小 246ms）
成功 5/6，实收 2.38 / 1.99 / 1.66 / 2.85 / 6.08 元
```

拆分：`room/grab` API 本身 105ms，其余是聊天广播投递（约 120~140ms）+ 本地 TCP 派发（≤10ms）。

### 14.2 三号同桌（已验证）

headless 下 `change`（logoutRoom+join）只要 ~400ms，三个进程反复撞房间，**4 秒内即可同落一桌**（浏览器方案要 60~180 秒）。

### 14.3 三个硬坑（踩到了，附成因）

| 坑 | 现象 | 成因 |
|---|---|---|
| 聊天走代理必挂 | NIM 登录 15s 超时，chatroom 拿不到 `chatroomAddresses` | NIM 的 WebSocket/fetch 经 undici+socks 隧道不稳；**聊天必须直连**，只有游戏 API 走代理 |
| 进房后立刻抢 → SDK panic | `RuntimeError: stack overflow`，之后所有抢包 500 | wasm 单线程，进房/聊天回调未完全落稳就进 Go；**进房后 1.5s 内的包要跳过**，panic 后必须重启该窗口进程 |
| undici 8 + socks 连不上 | `An invalid destination host was provided` / 「网络链接失败」 | undici 8 的 connector 传的是 `{origin,port}` 而非 `hostname`；需要用 origin 解析出 host:port（本仓库 SKILL 第 4 节已给修正写法） |

### 14.4 工具

- `tools/engine2.js` —— 自建沙箱宿主（vm + Go/WASM + 串行队列 + TCP 指令 + roomID 过滤）
- `tools/ctrl.js` —— 控制器（多引擎编排 + 同桌 + 判定规则 + 崩溃自愈）
- `tools/probe_grab.cjs` —— 单号闭环测速（公告→出手→结果）
