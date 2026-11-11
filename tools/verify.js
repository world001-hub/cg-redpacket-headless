// verify.js —— 直接验证「房间号到底管不管用」
// A=监听（聊天室所在房间），B=抢包号（change 占座后所在的房间）
// 分两组：①B 与 A 不同房 ②B 与 A 同房。各自抢 6 包，看回包代码。
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

const RT = 'E:\\CG_analyze\\engine';
const NODE = path.join(RT, 'node.exe');
const ENGINE = path.join(RT, 'engine.js');
const cfg = JSON.parse(fs.readFileSync('E:\\红包接龙助手\\config.json', 'utf8'));
const px = (cfg.proxies || []).map((p) => p.split(':').join('|'));

const MON = { name: '监听', link: cfg.accounts[0].url, port: 9521, slot: '1', dev: 13, proxy: '' };
const GBR = { name: '抢包号', link: cfg.accounts[1].url, port: 9522, slot: '2', dev: 145, proxy: px[1] };
const T0 = Date.now();
const ts = () => '+' + String(Date.now() - T0).padStart(6) + 'ms';
const log = (...a) => console.log(ts(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastBag = null, chatNet = null;
const send = (o, x) => { try { o.sock.write(JSON.stringify(x) + '\n'); } catch (e) {} };
const waitRoom = async (o, ms) => { const t = Date.now(); while (!o.room && Date.now() - t < ms) await sleep(100); };

function launch(o, dev) {
  o.proc = spawn(NODE, [ENGINE, String(o.port), o.link, o.slot, '', o.proxy || '', '8', '0', String(dev)],
    { cwd: RT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  o.proc.stdout.on('data', () => {}); o.proc.stderr.on('data', () => {});
  o.buf = ''; o.room = null; o.net = null;
}
function attach(o) {
  return new Promise((res) => {
    const s = net.connect(o.port, '127.0.0.1', () => { s.write(JSON.stringify({ cmd: 'join' }) + '\n'); res(); });
    s.setNoDelay(true); o.sock = s;
    s.on('error', () => {});
    s.on('data', (d) => {
      o.buf += d.toString();
      let i;
      while ((i = o.buf.indexOf('\n')) >= 0) {
        const l = o.buf.slice(0, i).trim(); o.buf = o.buf.slice(i + 1);
        if (!l) continue;
        let m; try { m = JSON.parse(l); } catch (e) { continue; }
        if (m.type === 'joinres') { o.room = String(m.room); o.net = m.netId; }
        else if (m.type === 'evt' && /聊天室已加入/.test(m.ev)) { chatNet = m.ev; }
        else if (m.type === 'bagid' && m.btype === 1) lastBag = m;
        else if (m.type === 'grabres') o.res = m.res;
      }
    });
  });
}

async function grabRound(g, n, tag) {
  const rows = [];
  for (let k = 0; k < n; k++) {
    lastBag = null;
    for (let w = 0; w < 140 && !lastBag; w++) await sleep(150);
    if (!lastBag) { log('  等包超时'); break; }
    const b = lastBag;
    g.res = null;
    send(g, { cmd: 'grab', id: Number(b.id) });
    await sleep(1600);
    const r = g.res || {};
    const money = r.data && (r.data.money || r.data.reward);
    const ok = String(r.code) === '200' && Number(money) > 0;
    rows.push({ ok, code: r.code || '?', money, msg: (r.msg || '').slice(0, 12), bagRoom: b.room });
    log('  [' + tag + '] 包' + b.id + '(房' + b.room + ') → ' + (ok ? '✅' + money : '✗' + (r.code || '?') + ' ' + (r.msg || '').slice(0, 14)));
    if (String(r.code) === '510') { g.room = null; send(g, { cmd: 'change' }); await waitRoom(g, 8000); }
  }
  return rows;
}

(async () => {
  launch(MON, 13); await sleep(2200);
  launch(GBR, 145);
  await sleep(2600);
  await attach(MON); await attach(GBR);
  for (let i = 0; i < 60 && (!MON.room || !GBR.room); i++) await sleep(300);
  log('join：监听=桌' + MON.room + '  抢包号=桌' + GBR.room);

  // 监听占座（它的聊天室会跟到新房间）
  MON.room = null; send(MON, { cmd: 'change' }); await waitRoom(MON, 8000);
  for (let i = 0; i < 60 && !chatNet; i++) await sleep(300);
  log('监听占座后 桌' + MON.room + '，聊天室 ' + chatNet);
  const A = MON.room;

  // 抢包号占座，并刻意落到与 A 不同的房间
  GBR.room = null; send(GBR, { cmd: 'change' }); await waitRoom(GBR, 8000);
  log('抢包号占座后 桌' + GBR.room + (GBR.room === A ? '（与监听同房）' : '（与监听不同房）'));

  await sleep(6000);
  log('---- 第一组：抢包号在桌' + GBR.room + '（监听桌' + A + '）----');
  await grabRound(GBR, 6, GBR.room === A ? '同房' : '不同房');

  // 第二组：把抢包号换到与 A 相同的房间（如果可能）
  log('---- 第二组：把抢包号换到监听所在桌' + A + ' ----');
  for (let k = 0; k < 15 && GBR.room !== A; k++) { GBR.room = null; send(GBR, { cmd: 'change' }); await waitRoom(GBR, 8000); }
  log('抢包号现在 桌' + GBR.room + (GBR.room === A ? ' ✅同房' : ' ✗没换到'));
  await sleep(4000);
  await grabRound(GBR, 6, '同房');

  [MON, GBR].forEach((o) => { try { o.proc.kill(); } catch (e) {} });
  process.exit(0);
})().catch((e) => { log('异常 ' + e.message); process.exit(1); });
