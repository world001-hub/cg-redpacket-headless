// trio2.js —— 三号闭环 v2：整组重新登录撞同房 → 同一包三刀齐发
// 关键：房间是按账号分配的，靠 change 拉不动；必须整组重开（新 WASM 实例 + 新 token）去碰撞。
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

const RT = 'E:\\CG_analyze\\engine';
const NODE = path.join(RT, 'node.exe');
const ENGINE = path.join(RT, 'engine.js');

const cfg = JSON.parse(fs.readFileSync('E:\\红包接龙助手\\config.json', 'utf8'));
const ONLY = Number(process.env.ONLY || 0);
const ALL = [
  { name: '窗口1', link: cfg.accounts[0].url, proxy: '', port: 9211 },
  { name: '窗口2', link: cfg.accounts[1].url, proxy: '123.126.74.197|18081|110677i314C|518716', port: 9212 },
  { name: '窗口3', link: cfg.accounts[2].url, proxy: '183.192.164.249|18081|792328o314C|622528', port: 9213 },
];
const N = Number(process.env.N || 0);
const ACC = ONLY > 0 ? [ALL[ONLY - 1]] : (N > 0 ? ALL.slice(0, N) : ALL);

const T0 = Date.now();
const ts = () => '+ ' + String(Date.now() - T0).padStart(6) + 'ms';
const log = (...a) => console.log(ts(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let bagWaiters = [];
function onBag(o) { for (const w of bagWaiters.slice()) w(o); }

function onMsg(a, o) {
  if (o.type === 'joinres') { a.room = String(o.room); a.netId = o.netId; a.joinAt = Date.now(); a.joined = true; return; }
  if (o.type === 'info') { a.info = o.res; return; }
  if (o.type === 'bagid' && o.btype === 1) { a.lastBag = o; onBag(o); return; }
  if (o.type === 'grabres') {
    const r = a.pending && a.pending[o.id];
    if (!r) return;
    r.code = String((o.res && o.res.code) || '');
    r.money = o.res && o.res.data && (o.res.data.money || o.res.data.reward);
    r.msg = (o.res && o.res.msg) || '';
    r.ms = Date.now() - r.sentAt;
    return;
  }
}

function startOne(a, idx) {
  a.room = null; a.joined = false; a.buf = '';
  const argv = [ENGINE, String(a.port), a.link, idx === 0 ? '1' : '2', '', a.proxy || '', '8', '0', String(idx)];
  a.proc = spawn(NODE, argv, { cwd: RT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  a.proc.stdout.on('data', () => {});
  a.proc.stderr.on('data', () => {});
  a.proc.on('exit', () => { a.joined = false; });
}

function connOne(a) {
  return new Promise((resolve) => {
    let done = false;
    const s = net.connect(a.port, '127.0.0.1', () => {
      a.sock = s;
      s.write(JSON.stringify({ cmd: 'join' }) + '\n');
    });
    s.setNoDelay(true);
    s.on('data', (d) => {
      a.buf += d.toString();
      let i;
      while ((i = a.buf.indexOf('\n')) >= 0) {
        const line = a.buf.slice(0, i).trim(); a.buf = a.buf.slice(i + 1);
        if (!line) continue;
        let o; try { o = JSON.parse(line); } catch (e) { continue; }
        onMsg(a, o);
        if (o.type === 'joinres' && !done) { done = true; resolve(true); }
      }
    });
    s.on('error', () => { if (!done) { done = true; resolve(false); } });
    setTimeout(() => { if (!done) { done = true; resolve(false); } }, 25000);
  });
}

async function restartAll(round) {
  for (const a of ACC) {
    try { a.sock && a.sock.destroy(); } catch (e) {}
    a.sock = null;
    try { a.proc && a.proc.kill(); } catch (e) {}
  }
  await sleep(700);
  ACC.forEach((a, i) => startOne(a, i));
  await sleep(2200);
  const res = await Promise.all(ACC.map((a) => connOne(a)));
  log('第' + round + '轮登录：' + ACC.map((a, i) => a.name + '=' + (a.room || (res[i] ? '?' : '失败'))).join(' '));
}

(async () => {
  let aligned = false;
  for (let round = 1; round <= 12 && !aligned; round++) {
    await restartAll(round);
    const rooms = ACC.map((a) => a.room);
    if (rooms[0] && rooms.every((r) => r === rooms[0])) { aligned = true; log('★同桌成功 桌' + rooms[0]); }
    else await sleep(300);
  }
  if (!aligned) { log('12 轮未同桌，退出'); process.exit(1); }

  // 服务端权威查询：每个号问一次「我在不在这一间」
  for (const a of ACC) {
    a.info = null;
    try { a.sock.write(JSON.stringify({ cmd: 'info', expect: a.expect }) + '\n'); } catch (e) {}
  }
  await sleep(2500);
  for (const a of ACC) log('　' + a.name + ' probeRoom → ' + JSON.stringify(a.info).slice(0, 160));

  for (let round = 1; round <= 5; round++) {
    const bag = await new Promise((res) => {
      const w = (o) => { const i = bagWaiters.indexOf(w); if (i >= 0) bagWaiters.splice(i, 1); res(o); };
      bagWaiters.push(w);
      setTimeout(() => { const i = bagWaiters.indexOf(w); if (i >= 0) bagWaiters.splice(i, 1); res(null); }, 25000);
    });
    if (!bag) { log('等包超时'); break; }
    const annT = Date.now();
    const rows = ACC.map((a) => ({ a, sentAt: Date.now(), code: '', money: '', msg: '', ms: 0 }));
    ACC.forEach((a, i) => {
      a.pending = a.pending || {};
      a.pending[bag.id] = rows[i];
      const fire = () => { try { a.sock.write(JSON.stringify({ cmd: 'grab', id: Number(bag.id), room: String(bag.room) }) + '\n'); } catch (e) {} };
      if (i === 0) setTimeout(fire, 120); else fire();      // 聊天窗口让 120ms 栈
    });
    log('★第' + round + '期 包 ' + bag.id + ' 桌' + bag.room);
    await sleep(1800);
    for (const r of rows) {
      const got = r.code === '200' && Number(r.money) > 0;
      log('   ' + r.a.name + ' ' + (got ? '✅ ' + r.money : '❌ ' + r.code + ' ' + r.msg) + '  ' + r.ms + 'ms');
    }
  }
  process.exit(0);
})().catch((e) => { log('异常 ' + e.message); process.exit(1); });
