// seat3.js —— 结论验证：房间不重要，座位才重要。三号各 change 一次占座，然后同时抢同一包
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

const RT = 'E:\\CG_analyze\\engine';
const NODE = path.join(RT, 'node.exe');
const ENGINE = path.join(RT, 'engine.js');
const cfg = JSON.parse(fs.readFileSync('E:\\红包接龙助手\\config.json', 'utf8'));
const px = (cfg.proxies || []).map((p) => p.split(':').join('|'));

const N = [
  { name: '窗口1', link: cfg.accounts[0].url, port: 9511, slot: '1', dev: 13, proxy: '' },
  { name: '窗口2', link: cfg.accounts[1].url, port: 9512, slot: '2', dev: 145, proxy: px[1] },
  { name: '窗口3', link: cfg.accounts[2].url, port: 9513, slot: '2', dev: 257, proxy: px[2] },
];
const T0 = Date.now();
const ts = () => '+' + String(Date.now() - T0).padStart(6) + 'ms';
const log = (...a) => console.log(ts(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastBag = null, chat = null;
const send = (o, x) => { try { o.sock.write(JSON.stringify(x) + '\n'); } catch (e) {} };
const waitRoom = async (o, ms) => { const t = Date.now(); while (!o.room && Date.now() - t < ms) await sleep(100); };

(async () => {
  for (const o of N) {
    o.proc = spawn(NODE, [ENGINE, String(o.port), o.link, o.slot, '', o.proxy || '', '8', '0', String(o.dev)],
      { cwd: RT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    o.proc.stdout.on('data', () => {}); o.proc.stderr.on('data', () => {});
    o.buf = ''; o.room = null;
  }
  await sleep(4200);
  for (const o of N) {
    const s = net.connect(o.port, '127.0.0.1', () => s.write(JSON.stringify({ cmd: 'join' }) + '\n'));
    s.setNoDelay(true); o.sock = s; s.on('error', () => {});
    s.on('data', (d) => {
      o.buf += d.toString();
      let i;
      while ((i = o.buf.indexOf('\n')) >= 0) {
        const l = o.buf.slice(0, i).trim(); o.buf = o.buf.slice(i + 1);
        if (!l) continue;
        let m; try { m = JSON.parse(l); } catch (e) { continue; }
        if (m.type === 'joinres') o.room = String(m.room);
        else if (m.type === 'evt' && /聊天室已加入/.test(m.ev)) { chat = m.ev; }
        else if (m.type === 'bagid' && m.btype === 1) lastBag = m;
        else if (m.type === 'grabres') o.res = m.res;
      }
    });
  }
  for (let i = 0; i < 60 && N.some((o) => !o.room); i++) await sleep(300);
  log('进房：' + N.map((o) => o.name + '=' + o.room).join(' ') + '（房间不同也没关系）');

  // 每个号 change 一次占座
  for (const o of N) {
    o.room = null; send(o, { cmd: 'change' });
    await waitRoom(o, 8000);
    log('  ' + o.name + ' 占座 → 桌' + o.room);
  }
  for (let i = 0; i < 80 && !chat; i++) await sleep(300);
  log('聊天室：' + (chat || '未就绪') + '，等 8 秒');
  await sleep(8000);

  let wins = 0, rounds = 0, multi = 0;
  for (let k = 0; k < 10; k++) {
    lastBag = null;
    for (let w = 0; w < 140 && !lastBag; w++) await sleep(150);
    if (!lastBag) { log('等包超时'); break; }
    const b = lastBag;
    rounds++;
    N.forEach((o) => { o.res = null; });
    N.forEach((o, i) => setTimeout(() => send(o, { cmd: 'grab', id: Number(b.id) }), i * 30));
    await sleep(1800);
    for (const o of N) {
      const r = o.res || {};
      if (String(r.code) === '510') { o.room = null; send(o, { cmd: 'change' }); }
    }
    let got = 0;
    const d = N.map((o) => {
      const r = o.res || {};
      const money = r.data && (r.data.money || r.data.reward);
      const good = String(r.code) === '200' && Number(money) > 0;
      if (good) { got++; wins++; }
      return o.name + (good ? '✅' + money : '✗' + (r.code || '?') + '(' + (r.msg || '').slice(0, 8) + ')');
    }).join('  ');
    if (got >= 2) multi++;
    log('包 ' + b.id + '  ' + d + '   命中 ' + got + '/3');
  }
  log('==== ' + rounds + ' 期，命中 ' + wins + ' 刀，多刀同中 ' + multi + ' 期 ====');
  N.forEach((o) => { try { o.proc.kill(); } catch (e) {} });
  process.exit(0);
})().catch((e) => { log('异常 ' + e.message); process.exit(1); });
