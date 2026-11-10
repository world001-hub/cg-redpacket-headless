// pick.js —— 交替单换房直到同房 → 等座位 → 两刀齐抢
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

const RT = 'E:\\CG_analyze\\engine';
const NODE = path.join(RT, 'node.exe');
const ENGINE = path.join(RT, 'engine.js');
const cfg = JSON.parse(fs.readFileSync('E:\\红包接龙助手\\config.json', 'utf8'));

const P = [
  { n: 'A', l: cfg.accounts[0].url, p: 9295, slot: '1' },
  { n: 'B', l: cfg.accounts[1].url, p: 9296, slot: '2' },
];
const T0 = Date.now();
const ts = () => '+' + String(Date.now() - T0).padStart(6) + 'ms';
const log = (...a) => console.log(ts(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let lastBag = null;

function start(o, dev) {
  o.proc = spawn(NODE, [ENGINE, String(o.p), o.l, o.slot, '', '', '8', '0', String(dev)],
    { cwd: RT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  o.proc.stdout.on('data', () => {});
  o.proc.stderr.on('data', () => {});
  o.buf = ''; o.room = null;
}

function link(o) {
  const s = net.connect(o.p, '127.0.0.1', () => s.write(JSON.stringify({ cmd: 'join' }) + '\n'));
  s.setNoDelay(true);
  o.sock = s;
  s.on('error', () => {});
  s.on('data', (d) => {
    o.buf += d.toString();
    let i;
    while ((i = o.buf.indexOf('\n')) >= 0) {
      const l = o.buf.slice(0, i).trim(); o.buf = o.buf.slice(i + 1);
      if (!l) continue;
      let m; try { m = JSON.parse(l); } catch (e) { continue; }
      if (m.type === 'joinres') o.room = String(m.room);
      else if (m.type === 'bagid' && m.btype === 1) lastBag = m;
      else if (m.type === 'grabres') o.res = m.res;
    }
  });
}

(async () => {
  P.forEach((o, i) => start(o, i * 250));
  await sleep(4000);
  P.forEach(link);
  for (let i = 0; i < 40 && P.some((o) => !o.room); i++) await sleep(300);
  log('join 后：' + P.map((o) => o.n + '=' + o.room).join(' '));

  // 先各 change 一次（占座），再交替对齐
  for (const o of P) {
    o.room = null;
    o.sock.write(JSON.stringify({ cmd: 'change' }) + '\n');
    for (let i = 0; i < 25 && !o.room; i++) await sleep(200);
  }
  log('两边各 change 一次后：' + P.map((o) => o.n + '=' + o.room).join(' '));

  for (let r = 1; r <= 24; r++) {
    if (P[0].room && P[0].room === P[1].room) break;
    const t = P[r % 2];
    t.room = null;
    t.sock.write(JSON.stringify({ cmd: 'change' }) + '\n');
    for (let i = 0; i < 25 && !t.room; i++) await sleep(200);
    log('第' + r + '次换 ' + t.n + ' → ' + t.room + '   现在 ' + P.map((o) => o.n + '=' + o.room).join(' ') + (P[0].room === P[1].room ? '  ✅同房' : ''));
    if (P[0].room === P[1].room) break;
    await sleep(400);
  }
  if (P[0].room !== P[1].room) { log('没同房，退出'); P.forEach((o) => o.proc.kill()); process.exit(0); }

  log('★同房 ' + P[0].room + '，等 12 秒座位落地');
  await sleep(12000);

  let got = 0;
  for (let k = 0; k < 5; k++) {
    lastBag = null;
    for (let w = 0; w < 100 && !lastBag; w++) await sleep(150);
    if (!lastBag) { log('等包超时'); break; }
    const b = lastBag;
    P.forEach((o) => { o.res = null; });
    P[0].sock.write(JSON.stringify({ cmd: 'grab', id: Number(b.id) }) + '\n');
    setTimeout(() => { try { P[1].sock.write(JSON.stringify({ cmd: 'grab', id: Number(b.id) }) + '\n'); } catch (e) {} }, 90);
    await sleep(1800);
    const d = P.map((o) => {
      const r = o.res || {};
      const money = r.data && (r.data.money || r.data.reward);
      const ok = String(r.code) === '200' && Number(money) > 0;
      if (ok) got++;
      return o.n + (ok ? '✅' + money : '✗' + (r.code || '?') + '(' + (r.msg || '').slice(0, 12) + ')');
    }).join('  ');
    log('包 ' + b.id + '  ' + d);
  }
  log('命中合计 ' + got);
  P.forEach((o) => { try { o.proc.kill(); } catch (e) {} });
  process.exit(0);
})().catch((e) => { log('异常 ' + e.message); process.exit(1); });
