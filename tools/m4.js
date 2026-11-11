// m4.js —— 先让"监听"自己 change 一次占座，再让抢包号 change 追到它的房间，然后一起出手
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

const RT = 'E:\\CG_analyze\\engine';
const NODE = path.join(RT, 'node.exe');
const ENGINE = path.join(RT, 'engine.js');
const cfg = JSON.parse(fs.readFileSync('E:\\红包接龙助手\\config.json', 'utf8'));
const px = (cfg.proxies || []).map((p) => p.split(':').join('|'));

const NODES = [
  { name: '窗口1', link: cfg.accounts[0].url, port: 9380, slot: '1', dev: 13, proxy: '' },
  { name: '窗口2', link: cfg.accounts[1].url, port: 9381, slot: '2', dev: 145, proxy: px[1] },
  { name: '窗口3', link: cfg.accounts[2].url, port: 9382, slot: '2', dev: 257, proxy: px[2] },
];
const T0 = Date.now();
const ts = () => '+' + String(Date.now() - T0).padStart(6) + 'ms';
const log = (...a) => console.log(ts(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastBag = null;
const send = (o, x) => { try { o.sock.write(JSON.stringify(x) + '\n'); } catch (e) {} };
const waitRoom = async (o, ms) => { const t = Date.now(); while (!o.room && Date.now() - t < ms) await sleep(100); };

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
        else if (m.type === 'evt') { if (o === NODES[0]) log('　[监听] ' + m.ev); }
        else if (m.type === 'bagid' && m.btype === 1) lastBag = m;
        else if (m.type === 'grabres') o.res = m.res;
      }
    });
  }
  for (let i = 0; i < 50 && NODES.some((o) => !o.room); i++) await sleep(300);
  log('join：' + NODES.map((o) => o.name + '=' + o.room).join(' '));

  // 监听先 change 一次占座
  const mon = NODES[0];
  mon.room = null; send(mon, { cmd: 'change' }); await waitRoom(mon, 6000);
  log('监听占座后 桌' + mon.room);

  // 抢包号 change 追到监听房间（一次一个，最多 15 次）
  for (const o of NODES.slice(1)) {
    const seen = [];
    for (let k = 0; k < 25 && o.room !== mon.room; k++) {
      o.room = null; send(o, { cmd: 'change' }); await waitRoom(o, 5000);
      if (o.room) seen.push(o.room);
    }
    log('  ' + o.name + ' 追房' + seen.length + '次：' + seen.join(',') + ' → ' + (o.room === mon.room ? '✅同房桌' + mon.room : '✗停在桌' + o.room));
  }
  const ok = NODES.filter((o) => o.room === mon.room);
  log('★同房号：' + (ok.map((o) => o.name).join('、') || '无') + '（' + ok.length + '/3）');
  if (ok.length < 2) { log('不足两号同房，结束'); NODES.forEach((o) => o.proc.kill()); process.exit(0); }

  send(mon, { cmd: 'chat', on: 1 });
  log('已要求监听重连聊天室，等 8 秒');
  await sleep(8000);
  let wins = 0, rounds = 0, multi = 0;
  for (let k = 0; k < 10; k++) {
    lastBag = null;
    for (let w = 0; w < 140 && !lastBag; w++) await sleep(150);
    if (k === 0 && !lastBag) log('　第一条包没等到，检查聊天室状态…');
    if (!lastBag) { log('等包超时'); break; }
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
    if (got >= 2) multi++;
    log('包 ' + b.id + '  ' + d + '   命中 ' + got + '/' + ok.length);
  }
  log('==== ' + rounds + ' 期，命中 ' + wins + ' 刀，多刀期数 ' + multi + ' ====');
  NODES.forEach((o) => { try { o.proc.kill(); } catch (e) {} });
  process.exit(0);
})().catch((e) => { log('异常 ' + e.message); process.exit(1); });
