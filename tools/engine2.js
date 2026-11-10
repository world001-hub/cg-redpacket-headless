// engine2.js —— 红包接龙 headless 引擎（单窗口）
// 设计依据：reference/decompiled/MainForm.cs（参考实现判定）+ engine.reference.js（沙箱宿主）
// 用法: engine2.js <port> "<游戏链接>" <slot> [proxy] [gameId]
//    proxy 形如  ip|port|user|pass   或  socks5://user:pass@ip:port
// 指令通道: TCP 一行一条 JSON，见 README
const fs = require('fs');
const path = require('path');
const net = require('net');
const vm = require('vm');

const DIR = __dirname;
const RT = process.env.HBJ_RUNTIME || 'E:\\CG_analyze\\engine';   // 复用参考实现的运行时（sdk.wasm / ok_*.js / undici / socks）
const PORT = parseInt(process.argv[2], 10) || 9100;
const LINK = process.argv[3] || '';
const SLOT = process.argv[4] || '1';
const PROXY_RAW = ((process.argv[5] || '').trim() === '-' ? '' : (process.argv[5] || '').trim());
const GAME_ID = parseInt(process.argv[6], 10) || 8;
const AUTO = process.argv.indexOf('--auto') >= 0;                 // 单号自测：收到开包就抢，打印往返毫秒

const T0 = Date.now();
const ts = () => '+ ' + String(Date.now() - T0).padStart(6) + 'ms';
const log = (...a) => console.log('[引擎' + SLOT + ']', ts(), ...a);

/* ---------------- 代理 ---------------- */
function parseProxy(s) {
  if (!s) return null;
  if (s.startsWith('socks5://')) {
    const u = new URL(s);
    return { host: u.hostname, port: Number(u.port) || 1080, type: 5,
             userId: decodeURIComponent(u.username || '') || undefined,
             password: decodeURIComponent(u.password || '') || undefined };
  }
  const p = s.split('|');
  if (p.length < 2) return null;
  return { host: p[0].trim(), port: parseInt(p[1], 10), type: 5,
           userId: (p[2] || '').trim() || undefined, password: (p[3] || '').trim() || undefined };
}
const PROXY = parseProxy(PROXY_RAW);

let SFetch = globalThis.fetch;
let SWs = globalThis.WebSocket;
if (PROXY) {
  const undici = require(path.join(RT, 'undici'));
  const { SocksClient } = require(path.join(RT, 'socks'));
  const agent = new undici.Agent({
    connectTimeout: 10000,
    connect: (opts, cb) => {
      SocksClient.createConnection({
        proxy: PROXY, command: 'connect',
        destination: { host: opts.hostname || opts.host, port: opts.port }, timeout: 10000,
      }).then((i) => cb(null, i.socket)).catch(cb);
    },
  });
  SFetch = (u, o) => undici.fetch(u, Object.assign({}, o || {}, { dispatcher: agent }));
  SWs = class { constructor(u, p) { const o = { dispatcher: agent }; if (p && p.length) o.protocols = p; return new undici.WebSocket(u, o); } };
  log('SOCKS5 通道: ' + PROXY.host + ':' + PROXY.port);
}

/* ---------------- 链接解析 ---------------- */
const param = (LINK.match(/[?&]param=([^&]+)/) || [])[1] || '';
const sk = decodeURIComponent((LINK.match(/[?&]sk=([^&]+)/) || [])[1] || 'https://h5-api.nwitkey.com');
if (!param) { console.error('缺少 param'); process.exit(2); }

/* ---------------- 设备指纹 ---------------- */
const FPMODEL = [
  { ua: 'Mozilla/5.0 (Linux; Android 13; 2211133C Build/TKQ1.221114.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36', platform: 'Linux armv8l', w: 1080, h: 2400, dpr: 3 },
  { ua: 'Mozilla/5.0 (Linux; Android 13; ALN-AL00 Build/HUAWEIALN-AL00; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.0.0 Mobile Safari/537.36', platform: 'Linux armv8l', w: 1220, h: 2700, dpr: 3 },
  { ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', platform: 'iPhone', w: 393, h: 852, dpr: 3 },
];
const SLOTN = Math.max(0, (parseInt(SLOT, 10) || 1) - 1);
const dev = FPMODEL[SLOTN % FPMODEL.length];
const devId = 'hb' + String(SLOTN + 1).padStart(3, '0') + '-' + ((SLOTN * 2654435761) >>> 0).toString(16);

/* ---------------- 沙箱 ---------------- */
const base = {
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  TextEncoder, TextDecoder, Date, Math, JSON, Promise,
  Uint8Array, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array,
  Float32Array, Float64Array, ArrayBuffer, DataView, WebAssembly,
  performance: { now: () => Date.now() },
  crypto: require('crypto').webcrypto,
  fetch: SFetch, Request: globalThis.Request, Response: globalThis.Response, Headers: globalThis.Headers,
  WebSocket: (process.env.HBJ_CHAT_DIRECT === '0' ? SWs : globalThis.WebSocket),
  location: { href: 'https://localhost/', protocol: 'https:', host: 'localhost', hostname: 'localhost', search: '', hash: '', pathname: '/' },
  navigator: { userAgent: dev.ua, platform: dev.platform, language: 'zh-CN', languages: ['zh-CN'], appName: 'Netscape', appVersion: dev.ua, appCodeName: 'Mozilla', cookieEnabled: true, onLine: true, hardwareConcurrency: 8, maxTouchPoints: 5 },
  screen: { width: dev.w, height: dev.h, availWidth: dev.w, availHeight: dev.h, colorDepth: 24, pixelDepth: 24 },
  devicePixelRatio: dev.dpr, innerWidth: dev.w, innerHeight: dev.h, outerWidth: dev.w, outerHeight: dev.h,
  localStorage: (() => {
    const s = { deviceId: devId, device_id: devId, clientId: devId, client_id: devId, uuid: devId };
    return { getItem: (k) => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: (k) => { delete s[k]; }, clear: () => { for (const k in s) delete s[k]; } };
  })(),
  sessionStorage: (() => { const s = {}; return { getItem: (k) => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: (k) => { delete s[k]; }, clear: () => { for (const k in s) delete s[k]; } }; })(),
  XMLHttpRequest: class {
    constructor() { this.readyState = 0; this.status = 0; this.responseText = ''; this.response = ''; this.headers = {}; }
    open(m, u) { this.method = m; this.url = u; this.readyState = 1; }
    setRequestHeader(k, v) { this.headers[k] = v; }
    send(body) {
      const self = this;
      const o = { method: this.method || 'GET', headers: this.headers };
      if (body != null) o.body = body;
      SFetch(this.url, o).then((r) => { self.status = r.status; return r.text(); }).then((t) => {
        self.responseText = t; self.response = t; self.readyState = 4;
        try { self.onreadystatechange && self.onreadystatechange(); } catch (e) {}
        try { self.onload && self.onload(); } catch (e) {}
      }).catch(() => { self.readyState = 4; self.status = 0; try { self.onerror && self.onerror(); } catch (e) {} });
    }
    abort() {} getAllResponseHeaders() { return ''; } getResponseHeader() { return null; }
  },
};
const sandbox = new Proxy(base, { get(t, p) { return p in t ? t[p] : globalThis[p]; } });
sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
sandbox.addEventListener = () => {}; sandbox.removeEventListener = () => {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(RT, 'ok_combined.83bbb.js'), 'utf8'), sandbox, { filename: 'ok_combined.js' });
for (const f of ['ok_CryptoJS.a87c6.js', 'ok_NIM_BROWSER_SDK.20374.js', 'ok_CHATROOM_BROWSER_SDK.67fa0.js']) {
  try { vm.runInContext(fs.readFileSync(path.join(RT, f), 'utf8'), sandbox, { filename: f }); } catch (e) { log('加载失败 ' + f + ': ' + e.message); }
}

/* ---------------- 启动 Go/WASM（gameSdk 由 Go 侧注册到 window 上） ---------------- */
if (typeof sandbox.Go !== 'function') { log('缺少 Go 运行时（ok_combined 未生效）'); process.exit(3); }
const wasmBytes = fs.readFileSync(path.join(RT, 'sdk.wasm'));
const go = new sandbox.Go();
WebAssembly.instantiate(wasmBytes, go.importObject).then(({ instance }) => {
  go.run(instance);
  const t0 = Date.now();
  const wait = setInterval(() => {
    if (typeof sandbox.gameSdk === 'object' && sandbox.gameSdk && typeof sandbox.gameSdk.init === 'function') {
      clearInterval(wait);
      log('gameSdk 就绪（' + (Date.now() - t0) + 'ms）');
      send({ type: 'ready', fn: Object.keys(sandbox.gameSdk).length });
    } else if (Date.now() - t0 > 8000) {
      clearInterval(wait);
      log('gameSdk 未就绪');
    }
  }, 100);
}).catch((e) => { log('wasm 加载失败: ' + e); process.exit(3); });

/* ---------------- 串行调用队列（单线程 wasm，绝不并发） ---------------- */
let sdkQ = Promise.resolve();
let lastEnd = 0;
function call(fn, args, ms) {
  const run = sdkQ.then(() => {
    const gap = lastEnd + 15 - Date.now();
    if (gap > 0) return new Promise((r) => setTimeout(r, gap));
  }).then(() => sandbox.gameSdk[fn].apply(sandbox.gameSdk, args));
  run.then(() => { lastEnd = Date.now(); }, () => { lastEnd = Date.now(); });
  sdkQ = run.then(() => {}, () => {});
  return new Promise((res) => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; res({ __TIMEOUT: fn }); } }, ms || 8000);
    run.then((v) => { if (!done) { done = true; clearTimeout(t); res(v); } },
             (e) => { if (!done) { done = true; clearTimeout(t); res({ __ERR: String(e) }); } });
  });
}

/* ---------------- 状态 ---------------- */
const st = { state: 'idle', room: null, expect: null, netId: null, bagMoney: 0, balance: null };
let nimChat = null, chatroomChat = null, td = null;

/* ---------------- TCP 指令通道 ---------------- */
let clients = [];
const server = net.createServer((sock) => {
  sock.setNoDelay(true);
  clients.push(sock);
  let q = Promise.resolve();
  sock.on('data', (d) => {
    for (const line of d.toString().split('\n')) {
      const t = line.trim();
      if (!t) continue;
      let m; try { m = JSON.parse(t); } catch (e) { send({ type: 'err', msg: 'bad json' }); continue; }
      q = q.then(() => handle(m)).catch((e) => send({ type: 'err', cmd: m.cmd, msg: String(e) }));
    }
  });
  sock.on('close', () => { clients = clients.filter((c) => c !== sock); });
  sock.on('error', () => {});
});
server.listen(PORT, () => log('TCP ' + PORT + ' 就绪'));

function send(o) { const s = JSON.stringify(o) + '\n'; for (const c of clients) { try { c.write(s); } catch (e) {} } }

/* ---------------- 业务 ---------------- */
async function doLogin() {
  if (st.state !== 'idle') return;
  const r = await call('init', [param, sk], 15000);
  if (!r || r.__ERR || r.__TIMEOUT) throw new Error('登录失败 ' + JSON.stringify(r));
  st.state = 'inited';
  send({ type: 'evt', ev: '登录成功' });
}

async function doJoin() {
  if (st.state === 'idle') await doLogin();
  try { chatroomChat && chatroomChat.destroy(); chatroomChat = null; } catch (e) {}
  try { nimChat && nimChat.destroy(); nimChat = null; } catch (e) {}
  const r = await call('joinRoom', [GAME_ID, 0], 15000);
  if (!r || r.__ERR || r.__TIMEOUT) throw new Error('进房失败 ' + JSON.stringify(r));
  const o = JSON.parse(JSON.stringify(r));
  st.room = o.data.RoomId; st.expect = o.data.expect; st.netId = o.data.netId;
  if (o.data.bagMoney) st.bagMoney = parseFloat(o.data.bagMoney) || st.bagMoney;
  st.state = 'joined';
  send({ type: 'evt', ev: '进房成功 桌号' + st.room + ' 期号' + st.expect + ' 包总额' + st.bagMoney });
  send({ type: 'joinres', ok: true, room: st.room, expect: st.expect, netId: st.netId, bagMoney: st.bagMoney });
  if (SLOT === '1') { try { await openChat(); } catch (e) { send({ type: 'evt', ev: '聊天室失败 ' + String(e).slice(0, 120) }); } }
}

async function openChat() {
  if (!td) { const tk = await call('getImToken', [], 10000); td = JSON.parse(JSON.stringify(tk)).data || {}; }
  log('IM token: appkey=' + String(td.appKey || '').slice(0, 8) + '… account=' + td.imAccount);

  // 1) NIM 登录（必须等 logined 真正触发，再去取 linkUrls）
  await new Promise((res) => {
    let done = false;
    try { nimChat && nimChat.destroy(); } catch (e) {}
    nimChat = sandbox.NIM.getInstance({ appkey: td.appKey, account: td.imAccount, token: td.imToken, db: false, syncSessionUnread: false });
    nimChat.on('logined', () => { log('NIM 登录成功'); done = true; res(); });
    nimChat.on('error', (e) => log('NIM error: ' + JSON.stringify(e).slice(0, 120)));
    nimChat.on('disconnect', () => log('NIM disconnect'));
    try { nimChat.connect(); } catch (e) { log('NIM connect 异常: ' + e.message); }
    setTimeout(() => { if (!done) { log('NIM 超时未登录'); res(); } }, 15000);
  });

  // 2) 取聊天室地址（没有它 Chatroom 连不上，只能收到空会话）
  let urls = [];
  for (let k = 0; k < 25; k++) {
    urls = (nimChat && nimChat.clientSocket && nimChat.clientSocket.linkUrls) || [];
    if (Array.isArray(urls) && urls.length) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  log('chatroomAddresses=' + JSON.stringify(urls).slice(0, 120));

  // 3) 进聊天室
  await new Promise((res) => {
    let done = false;
    try { chatroomChat && chatroomChat.destroy(); } catch (e) {}
    const opt = { appkey: td.appKey, account: td.imAccount, token: td.imToken,
      chatroomId: String(st.netId), isAnonymous: false };
    if (urls.length) opt.chatroomAddresses = urls;
    chatroomChat = new sandbox.Chatroom(opt);
    // 把所有事件名打出来，定位到底卡在哪一步
    const origOn = chatroomChat.on.bind(chatroomChat);
    chatroomChat.on = (ev, fn) => { if (ev !== 'chatroomMsg') log('chatroom 事件订阅: ' + ev); return origOn(ev, fn); };
    ['connect','connectFailed','willConnect','loginFailed','kicked','syncDone','msgs'].forEach((ev) => {
      try { origOn(ev, (x) => log('chatroom 事件: ' + ev + (x ? ' ' + JSON.stringify(x).slice(0, 100) : ''))); } catch (e) {}
    });
    chatroomChat.on('logined', () => { log('聊天室已加入 ' + st.netId); done = true; res(); });
    chatroomChat.on('chatroomMsg', onChatMsg);
    chatroomChat.on('error', (e) => log('聊天室 error: ' + JSON.stringify(e).slice(0, 140)));
    chatroomChat.on('disconnect', () => log('聊天室 disconnect'));
    setTimeout(() => { if (!done) { log('聊天室加入超时'); res(); } }, 15000);
  });
  send({ type: 'evt', ev: '聊天室已加入 netId=' + st.netId });
}

const AES_KEY = 'f36b75b67fe5b39f';
function onChatMsg(a) {
  let n;
  try {
    const pt = sandbox.CryptoJS.AES.decrypt(a.body, sandbox.CryptoJS.SHA256(AES_KEY),
      { iv: sandbox.CryptoJS.enc.Hex.parse('0000000000000000'), mode: sandbox.CryptoJS.mode.CBC, padding: sandbox.CryptoJS.pad.Pkcs7 })
      .toString(sandbox.CryptoJS.enc.Utf8);
    n = JSON.parse(pt);
  } catch (e) { if (!global.__decErrs) global.__decErrs = 0; if (global.__decErrs++ < 3) log('解密失败: ' + String(e && e.message || e).slice(0,80) + ' body=' + String(a && a.body || '').slice(0,40)); return; }
  if (!global.__msgs) global.__msgs = 0;
  if (global.__msgs++ < 5) log('收到消息 type=' + n.type + ' room=' + n.roomID + ' id=' + n.id);
  if (!n || !n.type) return;
  if (n.roomID && Number(n.roomID) !== Number(st.room)) return;    // ★ 只认自己房间
  send({ type: 'bagid', id: n.id, room: n.roomID, btype: n.type, grab: n.grab, bags: n.bags });
  if (AUTO && n.type === 1 && n.id) autoGrab(n.id, Date.now());
}

/* 单号自测：公告一到立刻抢，记录「公告→回包」毫秒 */
const autoState = { busy: false, rows: [] };
async function autoGrab(id, annT) {
  if (autoState.busy) return;
  autoState.busy = true;
  const t1 = Date.now();
  const r = await call('grabRoomRedBag', [String(st.room), String(id)], 5000);
  const t2 = Date.now();
  const o = r && !r.__ERR && !r.__TIMEOUT ? JSON.parse(JSON.stringify(r)) : r;
  const code = o && o.code; const money = o && o.data && (o.data.money || o.data.realMoney);
  const row = { id, send: t1 - annT, rtt: t2 - t1, code, money };
  autoState.rows.push(row);
  log('AUTO 抢包 id=' + id + ' 公告→发出 ' + row.send + 'ms  往返 ' + row.rtt + 'ms  code=' + code + ' money=' + money);
  send({ type: 'auto', row });
  autoState.busy = false;
}

async function handle(m) {
  if (m.cmd === 'join') { await doJoin(); return; }
  if (m.cmd === 'change') {
    if (st.state === 'joined' && st.room) await call('loginOutRoom', [String(st.room)], 8000);
    await doJoin(); return;
  }
  if (m.cmd === 'grab') {
    const t = Date.now();
    const r = await call('grabRoomRedBag', [String(m.room || st.room), String(m.id)], 5000);
    send({ type: 'grabres', id: m.id, rtt: Date.now() - t, res: JSON.parse(JSON.stringify(r || {})) });
    return;
  }
  if (m.cmd === 'money') {
    const r = await call('getUserMoney', [], 8000);
    const v = r && !r.__ERR && !r.__TIMEOUT ? (JSON.parse(JSON.stringify(r)).data) : null;
    st.balance = v;
    send({ type: 'money', balance: v, err: v == null ? 1 : 0 });
    return;
  }
  if (m.cmd === 'rooms') { send({ type: 'rooms', res: JSON.parse(JSON.stringify(await call('getRoomList', [], 8000))) }); return; }
  if (m.cmd === 'status') { send({ type: 'status', st, auto: autoState.rows.slice(-20) }); return; }
  if (m.cmd === 'quit') { send({ type: 'evt', ev: 'bye' }); setTimeout(() => process.exit(0), 100); return; }
  send({ type: 'unknown', cmd: m.cmd });
}

process.on('uncaughtException', (e) => log('未捕获: ' + (e && e.message)));
process.on('unhandledRejection', (e) => log('未处理: ' + ((e && e.message) || e)));
log('设备指纹 ' + devId + ' 运行时 ' + RT);
