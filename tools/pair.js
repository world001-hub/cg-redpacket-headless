// pair.js —— 双号（不重启）：起一次 → join → change 对齐 → 抢
// 用来排除「反复重启留下的僵尸会话」这一因素
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

const RT = 'E:\\CG_analyze\\engine';
const NODE = path.join(RT, 'node.exe');
const ENGINE = path.join(RT, 'engine.js');
const cfg = JSON.parse(fs.readFileSync('E:\\红包接龙助手\\config.json', 'utf8'));

const P = [
  { name: '窗口1', link: cfg.accounts[0].url, port: 9231, dev: 0 },
  { name: '窗口2', link: cfg.accounts[1].url, port: 9232, dev: 125 },
];

const T0 = Date.now();
const ts = () => '+ ' + String(Date.now() - T0).padStart(6) + 'ms';
const log = (...a) => console.log(ts(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const a of P) {
  a.proc = spawn(NODE, [ENGINE, String(a.port), a.link, '2', '', '', '8', '0', String(a.dev)],
    { cwd: RT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  a.proc.stdout.on('data', () => {});
  a.buf = ''; a.room = null;
}

const bags = [];
function onMsg(a, o) {
  if (o.type === 'joinres') { a.room = String(o.room); log(a.name + ' 进房 桌' + a.room); return; }
  if (o.type === 'bagid' && o.btype === 1) { bags.push(o); return; }
  if (o.type === 'grabres') {
    const code = String((o.res && o.res.code) || '');
    const money = o.res && o.res.data && (o.res.data.money || o.res.data.reward);
    if (a.pending === o.id) { a.result = { code, money, msg: (o.res && o.res.msg) || '', ms: Date.now() - a.sentAt }; }
  }
}

(async () => {
  await sleep(3500);
  for (const a of P) {
    const s = net.connect(a.port, '127.0.0.1', () => s.write(JSON.stringify({ cmd: 'join' }) + '\n'));
    s.setNoDelay(true);
    a.sock = s;
    s.on('data', (d) => {
      a.buf += d.toString();
      let i;
      while ((i = a.buf.indexOf('\n')) >= 0) {
        const l = a.buf.slice(0, i).trim(); a.buf = a.buf.slice(i + 1);
        if (!l) continue;
        try { onMsg(a, JSON.parse(l)); } catch (e) {}
      }
    });
  }
  for (let i = 0; i < 40 && P.some((a) => !a.room); i++) await sleep(500);
  log('初始：' + P.map((a) => a.name + '=' + a.room).join(' '));

  for (let tries = 0; tries < 10; tries++) {
    if (P[0].room && P[1].room && P[0].room === P[1].room) break;
    const target = P[0].room;
    const other = P.find((a) => a.room !== target);
    if (!other) break;
    log('拉 ' + other.name + '（' + other.room + ' → ' + target + '）第' + (tries + 1) + '次');
    other.room = null;
    other.sock.write(JSON.stringify({ cmd: 'change' }) + '\n');
    for (let i = 0; i < 30 && !other.room; i++) await sleep(200);
    await sleep(300);
  }
  log('对齐结果：' + P.map((a) => a.name + '=' + a.room).join(' '));

  for (let k = 0; k < 3; k++) {
    bags.length = 0;
    for (let w = 0; w < 60 && !bags.length; w++) await sleep(200);
    if (!bags.length) { log('等包超时'); break; }
    const b = bags[0];
    log('★包 ' + b.id + ' 桌' + b.room);
    for (const a of P) {
      a.pending = Number(b.id); a.result = null;
      setTimeout(() => { a.sentAt = Date.now(); try { a.sock.write(JSON.stringify({ cmd: 'grab', id: Number(b.id) }) + '\n'); } catch (e) {} }, 120);
    }
    await sleep(1600);
    for (const a of P) log('   ' + a.name + ' → ' + JSON.stringify(a.result));
  }
  P.forEach((a) => a.proc.kill());
  process.exit(0);
})().catch((e) => { log('异常 ' + e.message); process.exit(1); });
