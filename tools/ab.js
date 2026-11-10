// ab.js —— 最小对照：只做「起两个引擎 → join 一次 → 等 15 秒 → 抢 6 包」，不做任何重开/换房
// 用法: node ab.js [P2]
//   P2 为空 → 第二个号直连；P2 为代理串 → 第二个号走代理
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

const RT = 'E:\\CG_analyze\\engine';
const NODE = path.join(RT, 'node.exe');
const ENGINE = path.join(RT, 'engine.js');
const cfg = JSON.parse(fs.readFileSync('E:\\红包接龙助手\\config.json', 'utf8'));
const P2 = process.argv[2] || '';

const NODES = [
  { name: '监听', link: cfg.accounts[0].url, port: 9290, slot: '1', dev: 0, proxy: '' },
  { name: '窗口2', link: cfg.accounts[1].url, port: 9291, slot: '2', dev: 250, proxy: P2 },
];
const T0 = Date.now();
const ts = () => '+ ' + String(Date.now() - T0).padStart(6) + 'ms';
const log = (...a) => console.log(ts(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const bags = [];
function onBag(m) { if (m.btype === 1) bags.push(m); }

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
        if (m.type === 'evt') { log('   [' + o.name + '] ' + m.ev); return; }
        if (m.type === 'joinres') { o.room = String(m.room); o.netId = m.netId; log('   [' + o.name + '] joinres 桌' + m.room + ' net' + m.netId); return; }
        else if (m.type === 'bagid') onBag(m);
        else if (m.type === 'grabres') { o.res = m.res; }
      }
    });
  }
  for (let i = 0; i < 40 && NODES.some((o) => !o.room); i++) await sleep(300);
  log('进房：' + NODES.map((o) => o.name + '=' + o.room).join(' ') + (P2 ? '  (窗口2 走代理)' : '  (两号都直连)'));

  // 不同房就整组重开，直到同房
  for (let attempt = 1; attempt <= 6; attempt++) {
    if (NODES[0].room && NODES[0].room === NODES[1].room) break;
    log('不同房，整组重开（第' + attempt + '次）');
    for (const o of NODES) { try { o.sock && o.sock.destroy(); } catch (e) {} try { o.proc.kill(); } catch (e) {} }
    await sleep(1500);
    for (const o of NODES) {
      o.proc = spawn(NODE, [ENGINE, String(o.port), o.link, o.slot, '', o.proxy || '', '8', '0', String(o.dev)],
        { cwd: RT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      o.proc.stdout.on('data', () => {}); o.proc.stderr.on('data', () => {});
      o.buf = ''; o.room = null; bags.length = 0;
    }
    await sleep(3500);
    for (const o of NODES) {
      const sk = net.connect(o.port, '127.0.0.1', () => sk.write(JSON.stringify({ cmd: 'join' }) + '\n'));
      sk.setNoDelay(true); o.sock = sk; sk.on('error', () => {});
      sk.on('data', (d) => {
        o.buf += d.toString();
        let i;
        while ((i = o.buf.indexOf('\n')) >= 0) {
          const l = o.buf.slice(0, i).trim(); o.buf = o.buf.slice(i + 1);
          if (!l) continue;
          let m; try { m = JSON.parse(l); } catch (e) { continue; }
          if (m.type === 'joinres') o.room = String(m.room);
          else if (m.type === 'bagid') onBag(m);
          else if (m.type === 'grabres') { o.res = m.res; }
        }
      });
    }
    for (let i = 0; i < 40 && NODES.some((o) => !o.room); i++) await sleep(300);
    log('  重开后：' + NODES.map((o) => o.name + '=' + o.room).join(' '));
  }
  log('★最终：' + NODES.map((o) => o.name + '=' + o.room).join(' ') + (NODES[0].room === NODES[1].room ? '  同房' : '  ⚠不同房'));

  log('等 20 秒让座位落地…');
  await sleep(20000);

  let rows = 0;
  for (let k = 0; k < 6; k++) {
    bags.length = 0;
    for (let w = 0; w < 100 && !bags.length; w++) await sleep(150);
    if (!bags.length) { log('等包超时'); break; }
    const b = bags[0];
    rows++;
    NODES.forEach((o) => { o.res = null; });
    const ONLY = process.env.ONLY || '12';   // "1"=只监听出手 "2"=只窗口2出手 "12"=都出手
    if (ONLY.includes('1')) NODES[0].sock.write(JSON.stringify({ cmd: 'grab', id: Number(b.id) }) + '\n');
    if (ONLY.includes('2')) setTimeout(() => { try { NODES[1].sock.write(JSON.stringify({ cmd: 'grab', id: Number(b.id) }) + '\n'); } catch (e) {} }, ONLY === '2' ? 0 : 90);
    await sleep(1800);
    const detail = NODES.map((o) => {
      const r = o.res || {};
      const money = r.data && (r.data.money || r.data.reward);
      const ok = String(r.code) === '200' && Number(money) > 0;
      return o.name + (ok ? '✅' + money : '✗' + (r.code || '?') + '(' + (r.msg || '').slice(0, 14) + ')');
    }).join('  ');
    log('包 ' + b.id + '  ' + detail);
  }
  log('共 ' + rows + ' 包');
  NODES.forEach((o) => { try { o.proc.kill(); } catch (e) {} });
  process.exit(0);
})().catch((e) => { log('异常 ' + e.message); process.exit(1); });
