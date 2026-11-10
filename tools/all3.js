// all3.js —— 三号占座 + 逐个追房 + 三刀
// 规则（实测）：join 不占座，必须 change 一次；change 一次只动一个号，能落到别的号所在房间。
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

const RT = 'E:\\CG_analyze\\engine';
const NODE = path.join(RT, 'node.exe');
const ENGINE = path.join(RT, 'engine.js');
const cfg = JSON.parse(fs.readFileSync('E:\\红包接龙助手\\config.json', 'utf8'));

const NODES = [
  { name: '窗口1', link: cfg.accounts[0].url, port: 9330, slot: '1', dev: 13, proxy: '' },
  { name: '窗口2', link: cfg.accounts[1].url, port: 9331, slot: '2', dev: 145, proxy: '123.126.74.197|18081|110677i314C|518716' },
  { name: '窗口3', link: cfg.accounts[2].url, port: 9332, slot: '2', dev: 257, proxy: '183.192.164.249|18081|792328o314C|622528' },
];
const T0 = Date.now();
const ts = () => '+' + String(Date.now() - T0).padStart(6) + 'ms';
const log = (...a) => console.log(ts(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let lastBag = null;
const send = (o, x) => { try { o.sock.write(JSON.stringify(x) + '\n'); } catch (e) {} };
const waitRoom = async (o, ms) => { const t = Date.now(); while (!o.room && Date.now() - t < ms) await sleep(150); };

for (const o of NODES) {
  o.proc = spawn(NODE, [ENGINE, String(o.port), o.link, o.slot, '', o.proxy || '', '8', '0', String(o.dev)],
    { cwd: RT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  o.proc.stdout.on('data', () => {}); o.proc.stderr.on('data', () => {});
  o.buf = ''; o.room = null;
}

(async () => {
  await sleep(4000);
  for (const o of NODES) {
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
  for (let i = 0; i < 50 && NODES.some((o) => !o.room); i++) await sleep(300);
  log('join：' + NODES.map((o) => o.name + '=' + o.room).join(' '));

  // 步骤1：每个号 change 一次（占座）
  for (const o of NODES) { o.room = null; send(o, { cmd: 'change' }); await waitRoom(o, 6000); }
  log('占座后：' + NODES.map((o) => o.name + '=' + o.room).join(' '));

  // 步骤2：逐个追房（一次只动一个）
  for (let r = 1; r <= 30; r++) {
    const cnt = {};
    NODES.forEach((o) => { if (o.room) cnt[o.room] = (cnt[o.room] || 0) + 1; });
    const anchor = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0];
    const bad = NODES.filter((o) => o.room !== anchor);
    if (!bad.length) { log('★三号同房 桌' + anchor + '（第' + r + '轮）'); break; }
    const one = bad[0];
    one.room = null;
    send(one, { cmd: 'change' });
    await waitRoom(one, 6000);
    if (r % 5 === 0) log('  追房 ' + r + '：' + NODES.map((o) => o.name + '=' + o.room).join(' '));
  }
  const rooms = NODES.map((o) => o.room);
  const same = rooms[0] && rooms.every((x) => x === rooms[0]);
  log((same ? '★同房 ' + rooms[0] : '⚠没同房 ' + rooms.join('/')) + '，等 6 秒后开抢');
  if (!same) { NODES.forEach((o) => o.proc.kill()); process.exit(0); }
  await sleep(6000);

  let wins = 0, rounds = 0, triple = 0;
  for (let k = 0; k < 12; k++) {
    lastBag = null;
    for (let w = 0; w < 120 && !lastBag; w++) await sleep(150);
    if (!lastBag) { log('等包超时'); break; }
    const b = lastBag;
    rounds++;
    NODES.forEach((o) => { o.res = null; });
    NODES.forEach((o, i) => setTimeout(() => send(o, { cmd: 'grab', id: Number(b.id) }), i * 80));
    await sleep(1800);
    let got = 0;
    const d = NODES.map((o) => {
      const r = o.res || {};
      const money = r.data && (r.data.money || r.data.reward);
      const ok = String(r.code) === '200' && Number(money) > 0;
      if (ok) { got++; wins++; }
      return o.name + (ok ? '✅' + money : '✗' + (r.code || '?') + '(' + (r.msg || '').slice(0, 10) + ')');
    }).join('  ');
    if (got >= 3) triple++;
    log('包 ' + b.id + '  ' + d + '   命中 ' + got + '/3');
  }
  log('==== ' + rounds + ' 期，命中 ' + wins + ' 刀，三刀全占 ' + triple + ' 期 ====');
  NODES.forEach((o) => { try { o.proc.kill(); } catch (e) {} });
  process.exit(0);
})().catch((e) => { log('异常 ' + e.message); process.exit(1); });
