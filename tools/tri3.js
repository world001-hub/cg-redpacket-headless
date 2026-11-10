// tri3.js —— 最贴近参考实现的最小流程：起三个引擎 → join 一次 → 等聊天室 → 见包就抢（不 change、不重开）
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

const RT = 'E:\\CG_analyze\\engine';
const NODE = path.join(RT, 'node.exe');
const ENGINE = path.join(RT, 'engine.js');
const cfg = JSON.parse(fs.readFileSync('E:\\红包接龙助手\\config.json', 'utf8'));

const NODES = [
  { name: '窗口1', link: cfg.accounts[0].url, port: 9310, slot: '1', dev: 13 },
  { name: '窗口2', link: cfg.accounts[1].url, port: 9311, slot: '2', dev: 145 },
  { name: '窗口3', link: cfg.accounts[2].url, port: 9312, slot: '2', dev: 257 },
];
const T0 = Date.now();
const ts = () => '+' + String(Date.now() - T0).padStart(6) + 'ms';
const log = (...a) => console.log(ts(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let lastBag = null, chatOk = false;

for (const o of NODES) {
  o.proc = spawn(NODE, [ENGINE, String(o.port), o.link, o.slot, '', '', '8', '0', String(o.dev)],
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
        else if (m.type === 'evt' && /聊天室已加入/.test(m.ev)) { chatOk = true; log('聊天室就绪'); }
        else if (m.type === 'bagid' && m.btype === 1) lastBag = m;
        else if (m.type === 'grabres') o.res = m.res;
      }
    });
  }
  for (let i = 0; i < 50 && NODES.some((o) => !o.room); i++) await sleep(300);
  log('进房：' + NODES.map((o) => o.name + '=' + o.room).join(' '));
  for (let i = 0; i < 60 && !chatOk; i++) await sleep(300);
  log('聊天室 ' + (chatOk ? '已就绪' : '未就绪，仍然继续') + '，开始抢');
  await sleep(2000);

  let wins = 0, rounds = 0;
  for (let k = 0; k < 10; k++) {
    lastBag = null;
    for (let w = 0; w < 120 && !lastBag; w++) await sleep(150);
    if (!lastBag) { log('等包超时'); break; }
    const b = lastBag;
    rounds++;
    NODES.forEach((o) => { o.res = null; });
    NODES.forEach((o, i) => setTimeout(() => { try { o.sock.write(JSON.stringify({ cmd: 'grab', id: Number(b.id) }) + '\n'); } catch (e) {} }, i * 90));
    await sleep(1800);
    let got = 0;
    const d = NODES.map((o) => {
      const r = o.res || {};
      const money = r.data && (r.data.money || r.data.reward);
      const ok = String(r.code) === '200' && Number(money) > 0;
      if (ok) { got++; wins++; }
      return o.name + (ok ? '✅' + money : '✗' + (r.code || '?') + '(' + (r.msg || '').slice(0, 10) + ')');
    }).join('  ');
    log('包 ' + b.id + '  ' + d + '   命中 ' + got + '/3');
  }
  log('==== ' + rounds + ' 期，共抢到 ' + wins + ' 刀 ====');
  NODES.forEach((o) => { try { o.proc.kill(); } catch (e) {} });
  process.exit(0);
})().catch((e) => { log('异常 ' + e.message); process.exit(1); });
