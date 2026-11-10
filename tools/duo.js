// duo.js —— 全程都抢（不空等，避免 510），逐包记录「我们吃了几刀」+ 该包被抢满的用时
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

const RT = 'E:\\CG_analyze\\engine';
const NODE = path.join(RT, 'node.exe');
const ENGINE = path.join(RT, 'engine.js');
const cfg = JSON.parse(fs.readFileSync('E:\\红包接龙助手\\config.json', 'utf8'));

const NODES = (process.env.THREE === '1' ? [
  { name: '监听', link: cfg.accounts[0].url, port: 9280, slot: '1', dev: 0, proxy: '', mon: true },
  { name: '窗口2', link: cfg.accounts[1].url, port: 9281, slot: '2', dev: 250, proxy: '123.126.74.197|18081|110677i314C|518716' },
  { name: '窗口3', link: cfg.accounts[2].url, port: 9282, slot: '2', dev: 500, proxy: '183.192.164.249|18081|792328o314C|622528' },
] : [
  { name: '监听', link: cfg.accounts[0].url, port: 9280, slot: '1', dev: 0, proxy: '', mon: true },
  { name: '窗口2', link: cfg.accounts[1].url, port: 9281, slot: '2', dev: 250, proxy: '123.126.74.197|18081|110677i314C|518716' },
]);
const DELAYS = NODES.map((_, i) => i * 90);

const T0 = Date.now();
const ts = () => '+ ' + String(Date.now() - T0).padStart(6) + 'ms';
const log = (...a) => console.log(ts(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const openT = {}, seq = {}, rows = [];
function onBag(m) {
  if (m.btype === 1) { openT[m.id] = Date.now(); seq[m.id] = 0; return; }
  if (m.btype === 2 && openT[m.id]) {
    seq[m.id] = (seq[m.id] || 0) + 1;
    if (seq[m.id] === 3 && !rows.find((r) => r.id === m.id)) {
      rows.push({ id: m.id, fill: Date.now() - openT[m.id], ours: 0 });
      delete openT[m.id];
    }
  }
}

function launch(o) {
  o.proc = spawn(NODE, [ENGINE, String(o.port), o.link, o.slot, '', o.proxy || '', '8', '0', String(o.dev)],
    { cwd: RT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  o.proc.stdout.on('data', () => {}); o.proc.stderr.on('data', () => {});
  o.buf = ''; o.room = null;
}
function attach(o) {
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
      else if (m.type === 'bagid') onBag(m);
      else if (m.type === 'grabres') { o.res = m.res; o.resId = m.id; }
    }
  });
}
const send = (o, x) => { try { o.sock.write(JSON.stringify(x) + '\n'); } catch (e) {} };

(async () => {
  for (let attempt = 1; attempt <= 8; attempt++) {
    NODES.forEach(launch);
    await sleep(3200);
    NODES.forEach(attach);
    for (let i = 0; i < 40 && NODES.some((o) => !o.room); i++) await sleep(300);
    const rooms = NODES.map((o) => o.room);
    const same = rooms[0] && rooms.every((r) => r === rooms[0]);
    log('第' + attempt + '次启动：' + NODES.map((o) => o.name + '=' + o.room).join(' ') + (same ? '  ✅同房' : ''));
    if (same) break;
    NODES.forEach((o) => { try { o.sock && o.sock.destroy(); } catch (e) {} try { o.proc.kill(); } catch (e) {} o.sock = null; o.room = null; });
    await sleep(1200);
    if (attempt === 8) { log('8 次都没同房，退出'); process.exit(1); }
  }
  await sleep(3000);
  // 只让「非监听」的号 change 一次占座（监听不动，房间不变）
  NODES.filter((o) => !o.mon).forEach((o) => { o.room = null; send(o, { cmd: 'change' }); });
  for (let i = 0; i < 40 && NODES.filter((o) => !o.mon).some((o) => !o.room); i++) await sleep(300);
  log('占座后：' + NODES.map((o) => o.name + '=' + o.room).join(' '));
  await sleep(6000);

  const seen = {};
  const stop = Date.now() + 150000;
  while (Date.now() < stop && rows.length < 6) {
    await sleep(30);
    for (const id of Object.keys(openT)) {
      if (seen[id]) continue;
      seen[id] = 1;
      NODES.forEach((o, i) => { o.res = null; o.resId = null; });
      const only2 = process.env.ONLY2 === '1';
      NODES.forEach((o, i) => { if (only2 && o.mon) return; setTimeout(() => send(o, { cmd: 'grab', id: Number(id) }), DELAYS[i] || 0); });
      await sleep(1200);
      let ours = 0;
      const detail = NODES.map((o) => {
        const r = o.res || {};
        const money = r.data && (r.data.money || r.data.reward);
        const ok = String(r.code) === '200' && Number(money) > 0;
        if (ok) ours++;
        return o.name + (ok ? '✅' + money : '✗' + (r.code || '?'));
      }).join(' ');
      const row = rows.find((r) => r.id === Number(id));
      if (row) row.ours = ours;
      log('包 ' + id + '  ' + detail + '   命中 ' + ours + '/' + NODES.length);
      break;
    }
  }

  log('---- 汇总 ----');
  const byFill = rows.filter((r) => r.fill > 0);
  for (const r of byFill) log('  包' + r.id + ' 抢满用时 ' + r.fill + 'ms  我们命中 ' + r.ours);
  const avg = byFill.length ? Math.round(byFill.reduce((s, r) => s + r.fill, 0) / byFill.length) : 0;
  const multi = byFill.filter((r) => r.ours >= 2).length;
  log('样本 ' + byFill.length + ' 包，平均抢满 ' + avg + 'ms，我们命中≥2刀的有 ' + multi + ' 包');
  NODES.forEach((o) => { try { o.proc.kill(); } catch (e) {} });
  process.exit(0);
})().catch((e) => { log('异常 ' + e.message); process.exit(1); });
