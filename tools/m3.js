// m3.js —— 监听只 join（不改房，作为锚点）；抢包号 change 一次占座，再逐个追到监听房间；然后两刀
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

const RT = 'E:\\CG_analyze\\engine';
const NODE = path.join(RT, 'node.exe');
const ENGINE = path.join(RT, 'engine.js');
const cfg = JSON.parse(fs.readFileSync('E:\\红包接龙助手\\config.json', 'utf8'));

const MON = { name: '监听', link: cfg.accounts[0].url, port: 9340, slot: '1', dev: 13, proxy: '' };
const G = [
  { name: '窗口2', link: cfg.accounts[1].url, port: 9341, slot: '2', dev: 145, proxy: '123.126.74.197|18081|110677i314C|518716' },
  { name: '窗口3', link: cfg.accounts[2].url, port: 9342, slot: '2', dev: 257, proxy: '183.192.164.249|18081|792328o314C|622528' },
];
const ALL = [MON, ...G];
const T0 = Date.now();
const ts = () => '+' + String(Date.now() - T0).padStart(6) + 'ms';
const log = (...a) => console.log(ts(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastBag = null;
const send = (o, x) => { try { o.sock.write(JSON.stringify(x) + '\n'); } catch (e) {} };

for (const o of ALL) {
  o.proc = spawn(NODE, [ENGINE, String(o.port), o.link, o.slot, '', o.proxy || '', '8', '0', String(o.dev)],
    { cwd: RT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  o.proc.stdout.on('data', () => {}); o.proc.stderr.on('data', () => {});
  o.buf = ''; o.room = null;
}
const waitRoom = async (o, ms) => { const t = Date.now(); while (!o.room && Date.now() - t < ms) await sleep(120); };

(async () => {
  await sleep(4000);
  for (const o of ALL) {
    const s = net.connect(o.port, '127.0.0.1', () => s.write(JSON.stringify({ cmd: 'join' }) + '\n'));
    s.setNoDelay(true); o.sock = s;
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
  for (let i = 0; i < 50 && ALL.some((o) => !o.room); i++) await sleep(300);
  log('join：' + ALL.map((o) => o.name + '=' + o.room).join(' '));

  // 抢包号各 change 一次占座
  for (const o of G) { o.room = null; send(o, { cmd: 'change' }); await waitRoom(o, 6000); }
  log('占座后：' + ALL.map((o) => o.name + '=' + o.room).join(' ') + '   (监听不动，锚点桌 ' + MON.room + ')');

  // 逐个追到监听桌
  for (let r = 1; r <= 24; r++) {
    const bad = G.filter((o) => o.room !== MON.room);
    if (!bad.length) break;
    const one = bad[0];
    one.room = null; send(one, { cmd: 'change' });
    await waitRoom(one, 6000);
    if (r % 4 === 0) log('  追房 ' + r + '：' + ALL.map((o) => o.name + '=' + o.room).join(' '));
  }
  const ok = G.filter((o) => o.room === MON.room);
  log('★与监听同房的抢包号：' + (ok.length ? ok.map((o) => o.name).join('、') : '无') + '（' + ok.length + '/2）');
  if (!ok.length) { ALL.forEach((o) => o.proc.kill()); process.exit(0); }

  await sleep(6000);
  let wins = 0, rounds = 0;
  for (let k = 0; k < 12; k++) {
    lastBag = null;
    for (let w = 0; w < 120 && !lastBag; w++) await sleep(150);
    if (!lastBag) break;
    const b = lastBag;
    rounds++;
    ok.forEach((o) => { o.res = null; });
    ok.forEach((o, i) => setTimeout(() => send(o, { cmd: 'grab', id: Number(b.id) }), i * 80));
    await sleep(1800);
    let got = 0;
    const d = ok.map((o) => {
      const r = o.res || {};
      const money = r.data && (r.data.money || r.data.reward);
      const good = String(r.code) === '200' && Number(money) > 0;
      if (good) { got++; wins++; }
      return o.name + (good ? '✅' + money : '✗' + (r.code || '?') + '(' + (r.msg || '').slice(0, 10) + ')');
    }).join('  ');
    log('包 ' + b.id + '  ' + d + '   命中 ' + got + '/' + ok.length);
  }
  log('==== ' + rounds + ' 期，命中 ' + wins + ' 刀 ====');
  ALL.forEach((o) => { try { o.proc.kill(); } catch (e) {} });
  process.exit(0);
})().catch((e) => { log('异常 ' + e.message); process.exit(1); });
