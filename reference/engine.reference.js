// 红包协议引擎(单窗口)
// 用法: node engine.js <port> <gameLink> <slot>
// 原生 WebSocket + 云信实时推送 + TCP 指令通道
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const net = require('net');

const DIR = __dirname;
const PORT = parseInt(process.argv[2], 10) || 9100 + (parseInt(process.argv[4], 10) || 0);
const LINK = process.argv[3] || '';
const SLOT = process.argv[4] || '1';
const BIND_IP = (process.argv[5] || '').trim();
const PROXY_RAW = (process.argv[6] || '').trim();
// 第7参数: 房间 GameId(默认8=三包房); 第8参数: 总金额(默认0=以进房返回bagMoney为准)
const GAME_ID = parseInt(process.argv[7], 10) || 8;
const TOTAL_MONEY = parseFloat(process.argv[8]) || 0;
// 第9参数: 设备指纹编号(0-499), 每窗口从500套池中取一套, 机型可重复但设备ID唯一
const DEVICE_NO = parseInt(process.argv[9], 10) || 0;

// 绑定本机出口IP(patch net.Socket.connect, 对 fetch/WebSocket 全部生效)
if (BIND_IP) {
  const netMod = require('net');
  const origSockConnect = netMod.Socket.prototype.connect;
  netMod.Socket.prototype.connect = function (opts, ...rest) {
    if (opts && typeof opts === 'object' && !opts.localAddress) {
      opts = { ...opts, localAddress: BIND_IP };
    }
    return origSockConnect.call(this, opts, ...rest);
  };
  console.log('[引擎' + SLOT + '] 绑定本机IP: ' + BIND_IP);
}

// 解析代理: 支持 ip|port|user|pass 与 ip:port
function parseProxy(str) {
  if (!str) return null;
  const parts = str.indexOf('|') >= 0 ? str.split('|') : str.split(':');
  const ph = (parts[0] || '').trim();
  const pp = parseInt(parts[1], 10);
  if (!ph || !pp) return null;
  return {
    host: ph, port: pp, type: 5,
    userId: (parts[2] || '').trim() || undefined,
    password: (parts[3] || '').trim() || undefined
  };
}
const PROXY = parseProxy(PROXY_RAW);
if (PROXY) console.log('[引擎' + SLOT + '] 代理: ' + PROXY.host + ':' + PROXY.port + (PROXY.userId ? ' (认证)' : ''));

// 网络层: 代理时 fetch/WebSocket 全部走 SOCKS5
let SFetch = globalThis.fetch;
let SWs = globalThis.WebSocket;
if (PROXY) {
  try {
    const undici = require('undici');
    const { SocksClient } = require('socks');
    const agent = new undici.Agent({
      connectTimeout: 10000,
      connect: (opts, cb) => {
        SocksClient.createConnection({
          proxy: PROXY,
          command: 'connect',
          destination: { host: opts.hostname || opts.host, port: opts.port },
          timeout: 10000
        }).then(info => cb(null, info.socket)).catch(err => cb(err));
      }
    });
    SFetch = (url, opts) => undici.fetch(url, Object.assign({}, opts || {}, { dispatcher: agent }));
    SWs = class {
      constructor(url, protocols) {
        const o = { dispatcher: agent };
        if (protocols && protocols.length) o.protocols = protocols;
        return new undici.WebSocket(url, o);
      }
    };
    console.log('[引擎' + SLOT + '] 已启用SOCKS5代理通道');
  } catch (e) {
    console.log('[引擎' + SLOT + '] 代理初始化失败: ' + e.message);
  }
}

function parseLink(link) {
  const param = (link.match(/[?&]param=([^&]+)/) || [])[1] || '';
  const sk2 = decodeURIComponent((link.match(/[?&]sk=([^&]+)/) || [])[1] || '');
  return { link, param, sk: sk2 };
}
const cfg = parseLink(LINK);

// ===== 设备指纹(500套: 机型池20种轮换可重复, 每套唯一设备ID保证指纹不同) =====
const FPMODEL = [
  { name: '小米13/Android13', ua: 'Mozilla/5.0 (Linux; Android 13; 2211133C Build/TKQ1.221114.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36', platform: 'Linux armv8l', w: 1080, h: 2400, dpr: 3 },
  { name: '华为P60/Android13', ua: 'Mozilla/5.0 (Linux; Android 13; ALN-AL00 Build/HUAWEIALN-AL00; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.0.0 Mobile Safari/537.36', platform: 'Linux armv8l', w: 1220, h: 2700, dpr: 3 },
  { name: 'OPPO Reno10/Android13', ua: 'Mozilla/5.0 (Linux; Android 13; PGT110 Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/118.0.0.0 Mobile Safari/537.36', platform: 'Linux armv8l', w: 1080, h: 2340, dpr: 3 },
  { name: 'vivo X90/Android13', ua: 'Mozilla/5.0 (Linux; Android 13; V2241A Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/117.0.0.0 Mobile Safari/537.36', platform: 'Linux armv8l', w: 1260, h: 2800, dpr: 3 },
  { name: '荣耀80/Android12', ua: 'Mozilla/5.0 (Linux; Android 12; ELZ-AN00 Build/HONORELZ-AN00; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0.0.0 Mobile Safari/537.36', platform: 'Linux armv8l', w: 1080, h: 2400, dpr: 3 },
  { name: '红米K60/Android13', ua: 'Mozilla/5.0 (Linux; Android 13; 23013RK75C Build/TKQ1.221114.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/115.0.0.0 Mobile Safari/537.36', platform: 'Linux armv8l', w: 1080, h: 2400, dpr: 3 },
  { name: '三星S23/Android14', ua: 'Mozilla/5.0 (Linux; Android 14; SM-S9110 Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/121.0.0.0 Mobile Safari/537.36', platform: 'Linux armv8l', w: 1440, h: 3200, dpr: 3 },
  { name: '一加11/Android13', ua: 'Mozilla/5.0 (Linux; Android 13; PHB110 Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/114.0.0.0 Mobile Safari/537.36', platform: 'Linux armv8l', w: 1440, h: 3216, dpr: 3 },
  { name: '小米10/Android11', ua: 'Mozilla/5.0 (Linux; Android 11; M2001J2E Build/RKQ1.200826.002; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/96.0.4664.45 Mobile Safari/537.36', platform: 'Linux armv8l', w: 1080, h: 2340, dpr: 3 },
  { name: '华为Mate40/Android10', ua: 'Mozilla/5.0 (Linux; Android 10; TAS-AL00 Build/HUAWEITAS-AL00; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/90.0.4430.61 Mobile Safari/537.36', platform: 'Linux armv8l', w: 1080, h: 2340, dpr: 3 },
  { name: 'iPhone15Pro/iOS17', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', platform: 'iPhone', w: 393, h: 852, dpr: 3 },
  { name: 'iPhone14/iOS16.6', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1', platform: 'iPhone', w: 390, h: 844, dpr: 3 },
  { name: 'iPhone13/iOS15.7', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.7 Mobile/15E148 Safari/604.1', platform: 'iPhone', w: 390, h: 844, dpr: 3 },
  { name: 'iPhone12/iOS14.8', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.8 Mobile/15E148 Safari/604.1', platform: 'iPhone', w: 390, h: 844, dpr: 3 },
  { name: 'iPhone16Pro/iOS18', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', platform: 'iPhone', w: 402, h: 874, dpr: 3 },
  { name: 'iPhone15/iOS17.4', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1', platform: 'iPhone', w: 393, h: 852, dpr: 3 },
  { name: 'iPhone11/iOS13.6', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.6 Mobile/15E148 Safari/604.1', platform: 'iPhone', w: 375, h: 812, dpr: 3 },
  { name: 'iPhoneXS/iOS12.4', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 12_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.4 Mobile/15E148 Safari/604.1', platform: 'iPhone', w: 375, h: 812, dpr: 3 },
  { name: 'iPhone14Pro/iOS16.1', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.1 Mobile/15E148 Safari/604.1', platform: 'iPhone', w: 393, h: 852, dpr: 3 },
  { name: 'iPhone13Pro/iOS15.4', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.4 Mobile/15E148 Safari/604.1', platform: 'iPhone', w: 390, h: 844, dpr: 3 }
];
const FPLANGS = ['zh-CN', 'zh-Hans-CN', 'zh-CN', 'zh'];
const FPLIST = [];
for (let fi = 0; fi < 500; fi++) {
  const m = FPMODEL[fi % FPMODEL.length];
  // 唯一设备ID: 编号+哈希, 500套互不相同
  const uid = 'fp' + (fi + 1).toString().padStart(3, '0') + '-' + ((fi * 2654435761) >>> 0).toString(16).padStart(8, '0');
  FPLIST.push({ name: m.name, ua: m.ua, platform: m.platform, w: m.w, h: m.h, dpr: m.dpr, lang: FPLANGS[fi % FPLANGS.length], id: uid });
}
const dev = FPLIST[DEVICE_NO % 500];
console.log('[引擎' + SLOT + '] 设备指纹#' + (DEVICE_NO % 500) + ' ' + dev.name + ' id=' + dev.id);

const code = fs.readFileSync(path.join(DIR, 'ok_combined.83bbb.js'), 'utf8');
const base = {
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  TextEncoder, TextDecoder, Date, Math, JSON, Promise,
  Uint8Array, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array,
  Float32Array, Float64Array, ArrayBuffer, DataView, WebAssembly,
  performance: { now: () => Date.now() },
  crypto: require('crypto').webcrypto,
  fetch: SFetch,
  Request: globalThis.Request, Response: globalThis.Response, Headers: globalThis.Headers,
  WebSocket: SWs,
  location: { href: 'https://localhost/', protocol: 'https:', host: 'localhost', search: '', hash: '', hostname: 'localhost', pathname: '/' },
  navigator: { userAgent: dev.ua, platform: dev.platform, language: dev.lang, languages: [dev.lang], appName: 'Netscape', appVersion: dev.ua, appCodeName: 'Mozilla', cookieEnabled: true, onLine: true, hardwareConcurrency: 8, maxTouchPoints: 5 },
  screen: { width: dev.w, height: dev.h, availWidth: dev.w, availHeight: dev.h, colorDepth: 24, pixelDepth: 24, orientation: { type: 'portrait-primary', angle: 0 } },
  devicePixelRatio: dev.dpr,
  innerWidth: dev.w, innerHeight: dev.h, outerWidth: dev.w, outerHeight: dev.h,
  localStorage: (() => {
    const s = { deviceId: dev.id, device_id: dev.id, deviceToken: dev.id, device_token: dev.id, clientId: dev.id, client_id: dev.id, uuid: dev.id, appDeviceId: dev.id, imei: dev.id, oaid: dev.id, fingerprint: dev.id, device_fingerprint: dev.id, deviceNo: dev.id };
    return { getItem: (k) => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: (k) => { delete s[k]; }, clear: () => { for (const k in s) delete s[k]; } };
  })(),
  sessionStorage: (() => { const s = {}; return { getItem: (k) => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: (k) => { delete s[k]; }, clear: () => { for (const k in s) delete s[k]; } }; })(),
  XMLHttpRequest: class {
    constructor() { this.readyState = 0; this.status = 0; this.responseText = ''; this.response = ''; this.headers = {}; }
    open(m, u) { this.method = m; this.url = u; this.readyState = 1; }
    setRequestHeader(k, v) { this.headers[k] = v; }
    send(body) {
      const self = this;
      const opts = { method: this.method || 'GET', headers: this.headers };
      if (body !== undefined && body !== null) opts.body = body;
      fetch(this.url, opts).then(r => { self.status = r.status; return r.text(); }).then(t => {
        self.responseText = t; self.response = t; self.readyState = 4;
        try { if (self.onreadystatechange) self.onreadystatechange(); } catch (e) {}
        try { if (self.onload) self.onload(); } catch (e) {}
      }).catch(() => { self.readyState = 4; self.status = 0; try { if (self.onerror) self.onerror(); } catch (e2) {} });
    }
    abort() {}
    getAllResponseHeaders() { return ''; }
    getResponseHeader(k) { return null; }
  },
};
const sandbox = new Proxy(base, {
  get(t, prop) {
    if (!(prop in t)) { if (typeof prop === 'string' && prop in globalThis) return globalThis[prop]; return undefined; }
    return t[prop];
  },
});
sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
sandbox.addEventListener = () => {};
sandbox.removeEventListener = () => {};
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'ok_combined.js' });
try { vm.runInContext(fs.readFileSync(path.join(DIR, 'ok_NIM_BROWSER_SDK.20374.js'), 'utf8'), sandbox, { filename: 'nim.js' }); } catch (e) {}
try { vm.runInContext(fs.readFileSync(path.join(DIR, 'ok_CHATROOM_BROWSER_SDK.67fa0.js'), 'utf8'), sandbox, { filename: 'chat.js' }); } catch (e) {}
try { vm.runInContext(fs.readFileSync(path.join(DIR, 'ok_CryptoJS.a87c6.js'), 'utf8'), sandbox, { filename: 'crypto.js' }); } catch (e) {}

// ===== TCP 指令通道 =====
let clients = [];
const server = net.createServer((sock) => {
  sock.setNoDelay(true);
  clients.push(sock);
  // 指令串行队列: SDK 为单线程 wasm, 并发调用会引发内部状态竞争
  // (偶发 RuntimeError: memory access out of bounds, 一次越界后 SDK 即损坏)
  let q = Promise.resolve();
  const push = (m) => {
    const p = q.then(() => handleCmd(m)).catch((e) => { send({ type: 'err', cmd: (m && m.cmd) || '', msg: String(e) }); });
    q = p.catch(() => {});
  };
  sock.on('data', (d) => {
    const lines = d.toString().split('\n');
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      try { push(JSON.parse(t)); } catch (e) { send({ type: 'err', msg: String(e) }); }
    }
  });
  sock.on('close', () => { clients = clients.filter(c => c !== sock); });
  sock.on('error', () => {});
});
server.listen(PORT, () => console.log('[引擎' + SLOT + '] TCP ' + PORT + ' 就绪'));

function send(o) {
  const s = JSON.stringify(o) + '\n';
  for (const c of clients) { try { c.write(s); } catch (e) {} }
}

// ===== 崩溃保护: wasm SDK 偶发 panic 不再杀死进程 =====
// Go wasm 运行时会把 panic 类型打印到 stderr("panic: runtime error: xxx"),
// 据此精确区分: stack overflow = 偶发(引擎仍可用, 仅记录);
// nil pointer dereference / memory access out of bounds = 实例abort(永久损坏, 需重启)。
let panicKind = '';
const origStderr = process.stderr.write.bind(process.stderr);
process.stderr.write = (c, ...a) => {
  const s = String(c);
  if (/memory access out of bounds/.test(s)) panicKind = 'bounds';
  else if (/nil pointer/.test(s)) panicKind = 'nil';
  else if (/stack overflow/.test(s)) panicKind = 'stack';
  return origStderr(c, ...a);
};
const sdkBroken = () => panicKind === 'bounds';

let sdkCrashed = false;
process.on('uncaughtException', (e) => {
  const msg = String((e && e.message) || e);
  console.log('[引擎' + SLOT + '] 引擎异常已捕获, 进程保持运行: ' + msg.slice(0, 140));
  // 逃逸到进程级的异常: 依 stderr panic 类型判定损坏; stack overflow/未知 → 偶发, 仅记录不重启
  if (sdkBroken()) { sdkCrashed = true; console.log('[引擎' + SLOT + '] SDK已损坏(' + panicKind + '), 请重启引擎'); }
});
process.on('unhandledRejection', (e) => {
  const msg = String((e && e.message) || e);
  console.log('[引擎' + SLOT + '] 异步异常已捕获: ' + msg.slice(0, 120));
  // 异步路径逃逸同理: 只有 nil pointer / out of bounds 才算实例abort
  if (sdkBroken()) { sdkCrashed = true; console.log('[引擎' + SLOT + '] SDK已损坏(异步abort ' + panicKind + '), 请重启引擎'); }
});
const log = (s) => console.log('[' + new Date().toLocaleTimeString() + '][引擎' + SLOT + '] ' + s);

// ===== SDK 全局串行调度 =====
// 同一时刻只允许一个对 wasm SDK 的"活动调用"(未settle的Promise)。
// 超时(软超时)只通知调用方, 队列仍被真实调用占用, 直到它真正结束,
// 彻底避免"超时假释放"导致两个调用并发进入 wasm → memory access out of bounds。
let sdkQ = Promise.resolve();
let lastCallEnd = 0;   // 上一个SDK调用结束时刻: 背靠背调用之间补足间隔, 让Go调度器完全收尾, 避免带残留状态进入下一次调用
let engineStartTime = Date.now();  // 引擎启动时间
const call = (fn, args, ms) => {
  const t = ms || 8000;
  // 前5分钟用200ms间隔预热, 后面降到50ms, 避免刚开始SDK内存不稳定
  const elapsed = Date.now() - engineStartTime;
  const gapMs = elapsed < 5 * 60 * 1000 ? 200 : 50;
  const run = sdkQ.then(() => {
    const gap = lastCallEnd + gapMs - Date.now();
    if (gap > 0) return new Promise(r => setTimeout(r, gap));
  }).then(() => sandbox.gameSdk[fn].apply(sandbox.gameSdk, args));
  // 队列必须等真实调用 settle(成功或失败)才释放; SDK调用未结束前不放行下一条
  run.then(() => { lastCallEnd = Date.now(); }, () => { lastCallEnd = Date.now(); });
  sdkQ = run.then(() => { }, () => { });
  return new Promise((res) => {
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; res({ __TIMEOUT: fn }); } }, t);
    run.then((v) => { if (!done) { done = true; clearTimeout(timer); res(v); } },
             (e) => {
               if (!done) {
                 done = true; clearTimeout(timer);
                 const s = String(e);
                 // 依据 stderr panic 类型精确判定: out of bounds / nil pointer = 永久损坏(实测);
                 // stack overflow/unreachable = 偶发, 引擎仍可用
                 if (/out of bounds/i.test(s) || sdkBroken()) { sdkCrashed = true; console.log('[引擎' + SLOT + '] SDK已损坏: ' + s.slice(0, 80) + ', 请重启引擎'); }
                 res({ __ERR: s });
               }
             });
  });
};
const origErr = console.error;
console.error = (...a) => { const s = String(a[0] || ''); if (!s.includes('finalizeRef')) origErr(...a); };

function extractBagId(n) {
  try {
    const keys = ['id', 'redbagId', 'period', 'expect', 'issue', 'num', 'bagId', 'redId', 'moneyId', 'no'];
    for (const k of keys) { if (n && typeof n === 'object' && k in n) { const x = String(n[k]); if (/^\d{8,10}$/.test(x)) return parseInt(x, 10); } }
    function deep(o, depth) {
      if (depth > 3 || !o || typeof o !== 'object') return 0;
      for (const k2 in o) { const v2 = o[k2]; if (typeof v2 === 'string' && /^\d{8,10}$/.test(v2)) return parseInt(v2, 10); const r = deep(v2, depth + 1); if (r) return r; }
      return 0;
    }
    return deep(n, 0);
  } catch (e) { return 0; }
}

let room = 0, expect = 0, netId = 0, td = null, nimChat = null, chatroomChat = null;
let st = { state: 'idle', balance: null };
let bagMoney = TOTAL_MONEY;   // 当前房间红包总金额

// ===== 指令处理 =====
async function handleCmd(m) {
  try {
    if (sdkCrashed) { send({ type: 'err', cmd: m.cmd || '', msg: 'SDK已崩溃, 请重启引擎' }); return; }
    if (m.cmd === 'login' || m.cmd === 'init') { await doLogin(); send({ type: 'loginres', ok: true }); }
    else if (m.cmd === 'money') {
      const r = await call('getUserMoney', [], 4000);
      let v = null;
      try { const obj = JSON.parse(JSON.stringify(r)); if (obj && !obj.__ERR && !obj.__TIMEOUT && obj.data !== undefined && obj.data !== null) v = obj.data; } catch (e) {}
      if (v !== null) st.balance = v;
      // 查询失败/超时: 保留旧余额 + err标记, 主控会自动重查
      send({ type: 'money', balance: st.balance, err: v === null ? 1 : 0 });
    }
    else if (m.cmd === 'join') { await doJoin(m.monitor || 0); send({ type: 'joinres', ok: true, room, expect, netId, bagMoney }); }
    else if (m.cmd === 'change' || m.cmd === 'rejoin') {
      // 专门换桌: 先退出当前房间, 再进新桌(与重新进房不同)
      if (st.state === 'joined' && room) {
        try { const lo = await call('loginOutRoom', [room], 8000); log('退出房间: ' + JSON.stringify(lo).slice(0, 160)); } catch (e) { log('退出房间失败: ' + String(e).slice(0, 120)); }
      }
      await doJoin(m.monitor || 0);
      send({ type: 'joinres', ok: true, room, expect, netId, bagMoney });
    }
    else if (m.cmd === 'chat') {
      // 运行时开关聊天室连接(用于切换监控窗口)
      if (m.on === 1) {
        if (!td) { const tk = await call('getImToken', [], 8000); td = (JSON.parse(JSON.stringify(tk))).data || {}; }
        try { await yxLogin(); await yxRoom(netId); send({ type: 'evt', ev: '聊天室已开启 netId=' + netId }); } catch (e) { send({ type: 'evt', ev: '聊天室开启失败: ' + String(e).slice(0, 120) }); }
      } else {
        try { if (chatroomChat) { chatroomChat.destroy(); chatroomChat = null; } } catch (e) {}
        try { if (nimChat) { nimChat.destroy(); nimChat = null; } } catch (e) {}
        send({ type: 'evt', ev: '聊天室已关闭' });
      }
    }
    else if (m.cmd === 'grab') {
      const g = await call('grabRoomRedBag', [room, m.id], 4000);
      const gj = JSON.parse(JSON.stringify(g));
      console.log('[引擎' + SLOT + '] 抢包返回: ' + JSON.stringify(gj).slice(0, 300));
      send({ type: 'grabres', id: m.id, res: gj });
    }
    else if (m.cmd === 'rooms') {
      // 查询房间列表(房间名/金额/GameId), 用于识别不同游戏房间
      const r = await call('getRoomList', []);
      send({ type: 'rooms', res: JSON.parse(JSON.stringify(r)) });
    }
    else if (m.cmd === 'info') {
      const r = await call('getRoomRedBagInfo', [room, m.expect || expect]);
      send({ type: 'info', res: JSON.parse(JSON.stringify(r)) });
    }
    else if (m.cmd === 'status') { send({ type: 'status', st }); }
    else if (m.cmd === 'checkip') {
      let ip = '';
      const services = [
        { url: 'https://myip.ipip.net', parse: t => { const mm = (t || '').match(/\d+\.\d+\.\d+\.\d+/); return mm ? mm[0] : ''; } },
        { url: 'https://ip.sb', parse: t => { const mm = (t || '').match(/\d+\.\d+\.\d+\.\d+/); return mm ? mm[0] : ''; } },
        { url: 'https://api.ipify.org?format=text', parse: t => (t || '').trim() },
        { url: 'http://iframe.ip138.com/ic.asp', parse: t => { const mm = (t || '').match(/\d+\.\d+\.\d+\.\d+/); return mm ? mm[0] : ''; } }
      ];
      for (const svc of services) {
        try {
          const r = await SFetch(svc.url, { timeout: 6000 });
          const t = await r.text();
          ip = svc.parse(t);
          if (ip) break;
          console.log('[引擎' + SLOT + '] 检测服务无IP: ' + svc.url);
        } catch (e) { console.log('[引擎' + SLOT + '] 检测服务失败: ' + svc.url + ' ' + e.message); }
      }
      if (!ip) ip = PROXY ? 'PROXY:' + PROXY.host : '';
      console.log('[引擎' + SLOT + '] 真实IP: ' + (ip || '未知'));
      send({ type: 'ip', ip, proxy: PROXY ? PROXY.host : '' });
    }
    else send({ type: 'unknown', cmd: m.cmd });
  } catch (e) {
    const msg = String(e);
    // 依据 stderr panic 类型精确判定: out of bounds / nil pointer = 永久损坏 → 标记并要求重启;
    // 其余(stack overflow等)为偶发, 引擎仍可用
    if (/out of bounds/i.test(msg) || sdkBroken()) {
      sdkCrashed = true;
      send({ type: 'err', cmd: m.cmd, msg: 'SDK已损坏(' + msg.slice(0, 60) + '), 请重启引擎' });
    } else {
      send({ type: 'err', cmd: m.cmd, msg });
    }
  }
}

async function doLogin() {
  if (st.state === 'inited') { send({ type: 'evt', ev: '已登录, 跳过重复登录' }); return; }
  const r = await call('init', [cfg.param, cfg.sk]);
  if (r && (r.__ERR || r.__TIMEOUT)) {
    st.state = 'err';
    throw new Error('登录失败: ' + JSON.stringify(r));
  }
  log('init: ' + JSON.stringify(r));
  st.state = 'inited';
  send({ type: 'evt', ev: '登录成功' });
}

async function doJoin(monitor) {
  if (st.state === 'idle') await doLogin();   // 只有初始未登录才登录; 进房/换桌保留登录态
  // 换桌/重复进房前,先销毁旧的聊天室与NIM连接,避免重复实例导致聊天室无法重新加入
  try { if (chatroomChat) { chatroomChat.destroy(); chatroomChat = null; } } catch (e) { }
  try { if (nimChat) { nimChat.destroy(); nimChat = null; } } catch (e) { }
  const ROOM_TYPE = parseInt(process.argv[8], 10) || 0; const rj = await call('joinRoom', [GAME_ID, ROOM_TYPE]);
  if (rj && (rj.__ERR || rj.__TIMEOUT)) throw new Error('进房失败: ' + JSON.stringify(rj));
  log('进房: ' + JSON.stringify(rj).slice(0, 200));
  const o = JSON.parse(JSON.stringify(rj));
  room = o.data.RoomId; expect = o.data.expect; netId = o.data.netId;
  if (o.data.bagMoney) bagMoney = parseFloat(o.data.bagMoney) || bagMoney;
  st.state = 'joined';
  send({ type: 'evt', ev: '进房成功 桌号' + room + ' 期号' + expect + ' 包总额' + bagMoney });
  // 只有窗口1(SLOT=1)连接聊天室监听红包, 其他窗口不连(避免并发崩溃)
  if (String(SLOT) === '1') {
    try {
      if (!td) {
        const tk = await call('getImToken', [], 8000);
        td = (JSON.parse(JSON.stringify(tk))).data || {};
      }
      await yxLogin();
      await yxRoom(netId);
      send({ type: 'evt', ev: '聊天室已加入 netId=' + netId });
    } catch (e) { send({ type: 'evt', ev: '聊天室失败: ' + String(e).slice(0, 120) }); }
  }
}

function yxLogin() {
  return new Promise((resolve) => {
    let done = false;
    try { if (nimChat) { nimChat.destroy(); nimChat = null; } } catch (e) { }
    nimChat = sandbox.NIM.getInstance({ appkey: td.appKey, account: td.imAccount, token: td.imToken, db: false, syncSessionUnread: false });
    nimChat.on('logined', () => { log('NIM 登录成功'); done = true; resolve(); });
    nimChat.on('disconnect', () => {});
    nimChat.connect();
    setTimeout(() => { if (!done) resolve(); }, 15000);
  });
}

function yxRoom(chatroomId) {
  return new Promise((resolve) => {
    let done = false;
    try {
      try { if (chatroomChat) { chatroomChat.destroy(); chatroomChat = null; } } catch (e) { }
      chatroomChat = new sandbox.Chatroom({
        appkey: td.appKey, account: td.imAccount, token: td.imToken,
        chatroomId: String(chatroomId),
        chatroomAddresses: nimChat.clientSocket.linkUrls,
        isAnonymous: false
      });
      chatroomChat.on('logined', () => { log('聊天室已加入 ' + chatroomId); done = true; resolve(); });
      chatroomChat.on('chatroomMsg', (a) => {
        try {
          const pt = sandbox.CryptoJS.AES.decrypt(a.body, sandbox.CryptoJS.SHA256('f36b75b67fe5b39f'),
            { iv: sandbox.CryptoJS.enc.Hex.parse('0000000000000000'), mode: sandbox.CryptoJS.mode.CBC, padding: sandbox.CryptoJS.pad.Pkcs7 })
            .toString(sandbox.CryptoJS.enc.Utf8);
          const n = JSON.parse(pt);
          const id = extractBagId(n);
          // 只回报当前房间的消息
          if (n && n.roomID && Number(n.roomID) !== Number(room)) return;
          send({ type: 'bag', id, raw: n, pt });
          if (id) send({ type: 'bagid', id, room: n.roomID, btype: n.type, grab: n.grab, bags: n.bags });
        } catch (e) { /* 解密失败忽略 */ }
      });
      chatroomChat.on('disconnect', () => {});
      chatroomChat.connect();
      setTimeout(() => { if (!done) resolve(); }, 15000);
    } catch (e) { resolve(); }
  });
}

// ===== 启动流程 =====
const wasmBytes = fs.readFileSync(path.join(DIR, 'sdk.wasm'));
const go = new sandbox.Go();
WebAssembly.instantiate(wasmBytes, go.importObject).then(({ instance }) => {
  go.run(instance);
  setTimeout(async () => {
    try {
      send({ type: 'evt', ev: '引擎' + SLOT + ' 就绪, 等待登录/进房指令' });
    } catch (e) { console.log('启动失败: ' + String(e)); process.exit(1); }
  }, 600);
}).catch(e => { console.log('wasm加载失败: ' + e); process.exit(1); });

setInterval(() => {}, 500);
