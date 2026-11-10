// trio3.js —— 监听进程（只连聊天室，不抢） + 三个干净引擎（不连聊天室，只抢）
// 依据：实测「连了聊天室的进程抢包会 panic 并永久 500」，而没连聊天室的进程 3/3 正常。
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

const RT = 'E:\\CG_analyze\\engine';
const NODE = path.join(RT, 'node.exe');
const ENGINE = path.join(RT, 'engine.js');
const cfg = JSON.parse(fs.readFileSync('E:\\红包接龙助手\\config.json', 'utf8'));

const ACC = [
  { name: '窗口1', link: cfg.accounts[0].url, port: 9241 },
  { name: '窗口2', link: cfg.accounts[1].url, port: 9242 },
];
const MON = { name: '监听', link: cfg.accounts[2].url, port: 9240 };   // 监听用第三个号，避免与抢包号重复登录

const T0 = Date.now();
const ts = () => '+ ' + String(Date.now() - T0).padStart(6) + 'ms';
const log = (...a) => console.log(ts(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function launch(o, slot, dev) {
  o.proc = spawn(NODE, [ENGINE, String(o.port), o.link, slot, '', '', '8', '0', String(dev)],
    { cwd: RT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  o.proc.stdout.on('data', () => {});
  o.buf = ''; o.room = null;
}

function link(o, onBag) {
  const s = net.connect(o.port, '127.0.0.1', () => s.write(JSON.stringify({ cmd: 'join' }) + '\n'));
  s.setNoDelay(true); o.sock = s;
  s.on('data', (d) => {
    o.buf += d.toString();
    let i;
    while ((i = o.buf.indexOf('\n')) >= 0) {
      const l = o.buf.slice(0, i).trim(); o.buf = o.buf.slice(i + 1);
      if (!l) continue;
      let m; try { m = JSON.parse(l); } catch (e) { continue; }
      if (m.type === 'joinres') { o.room = String(m.room); }
      else if (m.type === 'bagid' && m.btype === 1 && onBag) onBag(m);
      else if (m.type === 'grabres') { o.res = m.res; o.resAt = Date.now(); }
    }
  });
}

let bagQ = [];
function onBag(m) { bagQ.push(m); }

(async () => {
  launch(MON, '1', 0);
  ACC.forEach((a, i) => launch(a, '2', (i + 1) * 125));
  await sleep(3500);
  link(MON, onBag);
  ACC.forEach((a) => link(a));
  function allIn() { return ACC.every((a) => a.room) && MON.room; }
  for (let i = 0; i < 50 && !allIn(); i++) await sleep(400);
  log('进房：' + [MON, ...ACC].map((a) => a.name + '=' + a.room).join(' '));

  // 关键：首次 join 只是"挂上"，实测要 logout+join 一次才真正占座
  for (const a of [MON, ...ACC]) { a.room = null; a.sock.write(JSON.stringify({ cmd: 'change' }) + '\n'); }
  for (let i = 0; i < 40 && [MON, ...ACC].some((a) => !a.room); i++) await sleep(300);
  log('重新进房：' + [MON, ...ACC].map((a) => a.name + '=' + a.room).join(' '));
  log('监听窗口桌 ' + MON.room + '；抢包窗口桌 ' + ACC.map((a) => a.room).join('/'));

  for (let k = 1; k <= 5; k++) {
    bagQ = [];
    for (let w = 0; w < 80 && !bagQ.length; w++) await sleep(150);
    if (!bagQ.length) { log('等包超时'); break; }
    const b = bagQ[0];
    log('★包 ' + b.id + ' 桌' + b.room);
    const G = [ACC[0], ACC[1], MON];
    G.forEach((a) => { a.res = null; });
    const DELAY = [0, 5, 10];   // 三刀几乎同时发出，抢在别人的第 2、3 刀之前
    G.forEach((a, i) => {
      const d = DELAY[i] != null ? DELAY[i] : 120;
      setTimeout(() => { try { a.sock.write(JSON.stringify({ cmd: 'grab', id: Number(b.id) }) + '\n'); } catch (e) {} }, d);
    });
    await sleep(1500);
    for (const a of [ACC[0], ACC[1], MON]) {
      const r = a.res || {};
      const money = r.data && (r.data.money || r.data.reward);
      log('   ' + a.name + ' ' + (String(r.code) === '200' && Number(money) > 0 ? '✅ ' + money : '❌ ' + (r.code || '?') + ' ' + (r.msg || '')));
    }
  }
  MON.proc.kill(); ACC.forEach((a) => a.proc.kill());
  process.exit(0);
})().catch((e) => { log('异常 ' + e.message); process.exit(1); });
