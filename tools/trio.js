// trio.js —— 三号闭环：起三个引擎 → 对齐同房 → 同一包三刀 → 打印每刀结果
// 用法: node trio.js
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

const RT = 'E:\\CG_analyze\\engine';
const NODE = path.join(RT, 'node.exe');
const ENGINE = path.join(RT, 'engine.js');

const cfg = JSON.parse(fs.readFileSync('E:\\红包接龙助手\\config.json', 'utf8'));
const ACC = [
  { name: '窗口1', link: cfg.accounts[0].url, proxy: '183.192.164.249|18081|792328o314C|622528', port: 9201 },
  { name: '窗口2', link: cfg.accounts[1].url, proxy: '', port: 9202 },
  { name: '窗口3', link: cfg.accounts[2].url, proxy: '123.126.74.197|18081|110677i314C|518716', port: 9203 },
];

const T0 = Date.now();
const ts = () => '+ ' + String(Date.now() - T0).padStart(6) + 'ms';
const log = (...a) => console.log(ts(), ...a);

for (const a of ACC) {
  a.room = null; a.sock = null; a.buf = ''; a.joinAt = 0;
  const argv = [ENGINE, String(a.port), a.link, a.proxy ? '2' : '1', '', a.proxy || '', '8', '0', String(ACC.indexOf(a))];
  a.proc = spawn(NODE, argv, { cwd: RT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  a.out = '';
  a.proc.stdout.on('data', (d) => { a.out += d.toString(); });
  a.proc.stderr.on('data', (d) => { a.out += d.toString(); });
  a.proc.on('exit', (c) => log(a.name + ' 引擎退出 ' + c));
}

function conn(a) {
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
    }
  });
  s.on('error', () => {});
}

let bagWaiters = [];
function onMsg(a, o) {
  if (o.type === 'joinres') {
    a.room = String(o.room); a.netId = o.netId; a.joinAt = Date.now();
    log(a.name + ' 进房 桌' + o.room + ' net' + o.netId);
    return;
  }
  if (o.type === 'bagid' && o.btype === 1) {
    if (global.__aligning) {
      for (const x of ACC) {
        if (x.room === global.__target && x.sock) {
          try { x.sock.write(JSON.stringify({ cmd: 'grab', id: Number(o.id), room: String(o.room) }) + '\n'); } catch (e) {}
        }
      }
    }
    for (const w of bagWaiters) w(o);
    return;
  }
  if (o.type === 'grabres') {
    const code = String((o.res && o.res.code) || '');
    const money = o.res && o.res.data && (o.res.data.money || o.res.data.reward);
    const r = a.pending && a.pending[o.id];
    if (r) {
      r.done = true;
      r.code = code; r.money = money; r.msg = (o.res && o.res.msg) || '';
      r.ms = Date.now() - r.sentAt;
    }
    return;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await sleep(4000);
  for (const a of ACC) conn(a);

  // 等三个都进房
  for (let i = 0; i < 60 && ACC.some((a) => !a.room); i++) await sleep(500);
  log('首次进房：' + ACC.map((a) => a.name + '=' + a.room).join(' '));

  // 对齐（最多 12 轮）
  // 单拉 3 轮不中就三个人一起换（同时换房才可能撞上同一间）
  global.__aligning = true;
  let pairTries = 0;
  for (let round = 0; round < 60; round++) {
    const rooms = ACC.map((a) => a.room);
    if (rooms[0] && rooms.every((r) => r === rooms[0])) break;
    const cnt = {};
    rooms.forEach((r) => { if (r) cnt[r] = (cnt[r] || 0) + 1; });
    const pairRoom = Object.keys(cnt).filter((r) => cnt[r] >= 2)[0];
    if (pairRoom) {
      global.__target = pairRoom;                     // 已有一对 → 只拉剩下的那个
      const third = ACC.find((a) => a.room !== pairRoom);
      if (third) {
        pairTries++;
        third.room = null;
        third.sock.write(JSON.stringify({ cmd: 'change' }) + '\n');
        if (pairTries % 8 === 0) log('已拉 ' + pairTries + ' 次 ' + third.name + ' → ' + pairRoom);
      }
    } else {
      // 没有一对 → 三个人一起换，争取先凑出一对
      global.__target = null;
      log('第' + (round + 1) + '次全体换房（当前 ' + rooms.join('/') + '）');
      for (const a of ACC) { a.room = null; a.sock.write(JSON.stringify({ cmd: 'change' }) + '\n'); }
    }
    await sleep(1500);
  }
  global.__aligning = false;
  const room = ACC[0].room;
  const same = ACC.every((a) => a.room === room);
  log((same ? '★同桌成功 桌' : '⚠未同桌 ') + ACC.map((a) => a.name + '=' + a.room).join(' '));
  if (!same) { log('放弃'); process.exit(1); }

  // 同一包三刀，做 4 期
  for (let round = 1; round <= 4; round++) {
    const bag = await new Promise((res) => {
      const w = (o) => { const i = bagWaiters.indexOf(w); if (i >= 0) bagWaiters.splice(i, 1); res(o); };
      bagWaiters.push(w);
      setTimeout(() => { const i = bagWaiters.indexOf(w); if (i >= 0) bagWaiters.splice(i, 1); res(null); }, 25000);
    });
    if (!bag) { log('等包超时，结束'); break; }
    const annT = Date.now();
    log('★第' + round + '期 包 ' + bag.id + ' 桌' + bag.room);
    const rows = ACC.map((a) => ({ a, done: false, sentAt: Date.now(), code: '', money: '', msg: '', ms: 0 }));
    ACC.forEach((a, i) => {
      a.pending = a.pending || {};
      a.pending[bag.id] = rows[i];
      const fire = () => a.sock.write(JSON.stringify({ cmd: 'grab', id: Number(bag.id), room: String(bag.room) }) + '\n');
      if (a.port === 9201) setTimeout(fire, 120); else fire();
    });
    await sleep(1800);
    for (const r of rows) {
      const got = r.code === '200' && Number(r.money) > 0;
      log('  ' + r.a.name + ' ' + (got ? '✅ 抢到 ' + r.money : '❌ ' + r.code + ' ' + r.msg) + '  ' + r.ms + 'ms  (公告→发出 ' + (r.sentAt - annT) + 'ms)');
    }
  }
  process.exit(0);
})().catch((e) => { log('异常 ' + e.message); process.exit(1); });
