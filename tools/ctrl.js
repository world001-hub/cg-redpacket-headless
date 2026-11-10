// ctrl.js —— 控制器：驱动一个或多个 headless 引擎（复用参考实现 engine.js 作为传输层），
// 实现红包接龙判定：余额最高首抢 → a1 ≥ 包赢线停 / a1 ≤ 必输线全抢 / 否则 B 抢 → 尾包 ≥ 我们最小才抢。
// 用法: node ctrl.js <config.json> [--single]
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');
const path = require('path');

const RUNDIR = process.env.HBJ_RUNTIME || 'E:\\CG_analyze\\engine';
const NODE = path.join(RUNDIR, 'node.exe');
const ENGINE = path.join(RUNDIR, 'engine.js');

const cfgPath = process.argv[2] || path.join(__dirname, 'ctrl.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const RULE = Object.assign({
  winSkipA1: 3.17,     // a1 ≥ 这个值 → B、C 都不抢（数学包赢临界）
  doomA1: 2.9,         // a1 ≤ 这个值 → 两刀全抢（注定最低，能收多少收多少）
  tailMin: 0,          // 尾包额外门槛（0 = 不额外要求）
  budgetMs: 30000,     // 单包最长等待
}, cfg.rule || {});

const T0 = Date.now();
const ts = () => '+ ' + String(Date.now() - T0).padStart(7) + 'ms';
const log = (...a) => console.log(ts(), ...a);

const accs = cfg.accounts.map((a, i) => ({
  i, name: a.name || ('窗口' + (i + 1)), link: a.link, proxy: a.proxy || '',
  port: 9100 + i + 1, slot: String(i + 1),
  sock: null, buf: '', state: 'new', room: null, netId: null, balance: 0,
  proc: null, joinAt: 0,
}));

/* ---------- 启动引擎 ---------- */
function startEngine(a) {
  const argv = [ENGINE, String(a.port), a.link, a.slot, '', a.proxy || ''];
  a.proc = spawn(NODE, argv, { cwd: RUNDIR, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let out = '';
  a.proc.stdout.on('data', (d) => {
    const s = d.toString(); out += s;
    for (const line of s.split('\n')) {
      if (!line.trim()) continue;
      if (/out of bounds/i.test(line)) {
        log(a.name + ' 引擎异常（' + line.slice(0, 60) + '）→ 重启该窗口');
        a.state = 'dead'; a.room = null;
        try { a.proc.kill(); } catch (e) {}
        try { a.sock && a.sock.destroy(); } catch (e) {}
        setTimeout(() => { startEngine(a); setTimeout(() => connect(a), 2600); }, 900);
      }
    }
    if (out.length > 20000) out = out.slice(-10000);
  });
  a.proc.stderr.on('data', () => {});
  a.proc.on('exit', (c) => { log(a.name + ' 引擎退出 code=' + c); a.state = 'dead'; });
  log(a.name + ' 引擎启动 port=' + a.port + (a.proxy ? ' proxy=' + a.proxy.split('|')[0] : ' 直连'));
}

/* ---------- TCP 连接 ---------- */
function connect(a, attempt) {
  attempt = attempt || 0;
  if (a.sock && !a.sock.destroyed) return;
  const s = net.connect(a.port, '127.0.0.1', () => {
    a.sock = s; a.state = 'connected';
    log(a.name + ' TCP 已连接');
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
      onEvent(a, o);
    }
  });
  s.on('error', () => {});
  s.on('close', () => {
    a.sock = null;
    if (a.state === 'dead') return;
    a.state = 'closed';
    if (attempt < 20) setTimeout(() => connect(a, attempt + 1), 1500);
  });
}

/* ---------- 规则状态机 ---------- */
const rounds = new Map();   // id -> { id, room, annT, phase, m1, m2, w1, w2, w3, done, sentAt }

function pickRoles(room) {
  const pool = accs.filter((a) => (a.state === 'connected' || a.state === 'joined') && String(a.room) === String(room));
  if (pool.length < 2) return null;
  const rot = (global.__rot = ((global.__rot || 0) + 1) % pool.length);
  const order = pool.slice(rot).concat(pool.slice(0, rot));
  return { first: order[0], second: order[1] || null, tail: order[pool.length - 1] !== order[0] ? order[pool.length - 1] : (order[1] || null) };
}

function sendGrab(a, id, why) {
  const r = rounds.get(String(id));
  if (r) { r.sentAt = Date.now(); r.lastWho = a.name; }
  const fire = () => { try { a.sock.write(JSON.stringify({ cmd: 'grab', id: Number(id) }) + '\n'); } catch (e) {} };
  if (a.slot === '1') setTimeout(fire, 120); else fire();
  const dt = r ? (Date.now() - r.annT) : -1;
  log(`${a.name} 出手抢 ${id}（${why}）公告→发出 ${dt}ms`);
}

function onEvent(a, o) {
  if (o.type === 'joinres') {
    a.room = o.room; a.netId = o.netId; a.joinAt = Date.now(); a.state = 'joined';
    log(`${a.name} 进房 桌${o.room} net${o.netId} 期号${o.expect}`);
    return;
  }
  if (o.type === 'money') { if (typeof o.balance === 'number') a.balance = o.balance; return; }
  if (o.type === 'evt') { if (/抢到|进房|登录/.test(o.ev || '')) log(a.name + ' ' + o.ev); return; }

  if (o.type === 'bagid' && o.btype === 1) {
    if (Date.now() - (a.joinAt || 0) < 1500) { log('跳过进房后首个包 ' + o.id + '（SDK 稳定期）'); return; }          // 新包公告
    const id = String(o.id);
    if (rounds.has(id) && rounds.get(id).done) return;
    const annT = Date.now();
    const roles = pickRoles(o.room);
    if (!roles) { log('新包 ' + id + ' 但同房窗口不足，跳过'); return; }
    rounds.set(id, { id, room: o.room, annT, phase: 0, m1: 0, m2: 0, done: false, first: roles.first, second: roles.second, tail: roles.tail, sentAt: 0, lastWho: '' });
    log(`★新包 ${id} 桌${o.room}  {首抢=${roles.first.name}(${roles.first.balance.toFixed(2)})  2抢=${roles.second ? roles.second.name : '-'}  尾包=${roles.tail ? roles.tail.name : '-'}}`);
    sendGrab(roles.first, id, '首抢');
    return;
  }

  if (o.type === 'grabres') {
    const r = rounds.get(String(o.id));
    if (!r || r.done) return;
    const res = o.res || {};
    const code = String(res.code || '');
    const money = parseFloat((res.data && (res.data.money || res.data.realMoney)) || 0);
    const rtt = Date.now() - (r.sentAt || Date.now());
    if (code !== '200' || !money) {
      log(`${a.name} 抢 ${o.id} 失败 code=${code} ${res.msg || ''}（${rtt}ms） → 本包结束`);
      r.done = true;
      if (code === '500' || code === '510') { a.state = 'closed'; log(a.name + ' 座位失效，重新进房'); try { a.sock.write(JSON.stringify({ cmd: 'change' }) + '\n'); a.state = 'joined'; } catch (e) {} }
      return;
    }
    log(`${a.name} 抢到 ${o.id} = ${money.toFixed(2)}（${rtt}ms）`);
    if (r.phase === 0) {
      r.m1 = money; r.phase = 1;
      if (r.m1 >= RULE.winSkipA1) { log(`  a1=${money.toFixed(2)} ≥ 包赢线 ${RULE.winSkipA1} → B、C 都不抢`); r.done = true; return; }
      if (!r.second) { r.done = true; return; }
      sendGrab(r.second, o.id, 'a1<' + RULE.winSkipA1 + ' → 2抢');
      return;
    }
    if (r.phase === 1) {
      r.m2 = money; r.phase = 2;
      const bag = 9.5, left = +(bag - r.m1 - r.m2).toFixed(2), min = Math.min(r.m1, r.m2);
      if (r.m1 <= RULE.doomA1) {                 // 必输线：尾包直接抢
        if (!r.tail) { r.done = true; return; }
        sendGrab(r.tail, o.id, `a1≤${RULE.doomA1} 必输 → 全抢`);
        return;
      }
      if (left < min || left < RULE.tailMin) { log(`  尾包 ${left} < 我们最小 ${min} → C 不抢`); r.done = true; return; }
      if (!r.tail) { r.done = true; return; }
      sendGrab(r.tail, o.id, `尾包 ${left} ≥ 我们最小 ${min}`);
      return;
    }
    r.done = true;
    return;
  }
}

/* ---------- 同桌：headless 下 change 只要 ~400ms，直接撞 ---------- */
let aligning = false;
async function tryAlign() {
  if (aligning) return;
  const live = accs.filter((a) => a.state === 'joined' && a.sock);
  if (live.length < 2) return;
  const cnt = {};
  live.forEach((a) => { cnt[a.room] = (cnt[a.room] || 0) + 1; });
  const rooms = Object.keys(cnt);
  if (rooms.length === 1 && live.length === accs.length) {
    if (!global.__aligned) { global.__aligned = true; log('★三号同桌完成 桌' + rooms[0]); }
    return;
  }
  global.__aligned = false;
  // 目标 = 人最多的房间（平票取窗口1 的房间，再取数字大的）
  const target = rooms.sort((x, y) => (cnt[y] - cnt[x]) || (String(accs[0].room) === x ? -1 : String(accs[0].room) === y ? 1 : Number(y) - Number(x)))[0];
  if (global.__tgt !== target) { global.__tgt = target; global.__tries = {}; }
  global.__tries = global.__tries || {};
  aligning = true;
  const out = live.filter((a) => String(a.room) !== String(target));
  const cand = out.filter((a) => (global.__tries[a.name] || 0) < 8);
  if (!cand.length) { log('对齐放弃：目标桌 ' + target + ' 连拉 8 次不中，换目标'); global.__tgt = null; global.__tries = {}; setTimeout(() => { aligning = false; }, 800); return; }
  const one = cand[0];
  global.__tries[one.name] = (global.__tries[one.name] || 0) + 1;
  log('同桌中：' + live.map((a) => a.name + '=' + a.room).join(' ') + ' → 拉 ' + one.name + ' 到 ' + target + '（第' + global.__tries[one.name] + '次）');
  one.sock.write(JSON.stringify({ cmd: 'change' }) + '\n');
  setTimeout(() => { aligning = false; }, 1000);
}
setInterval(() => { tryAlign().catch(() => {}); }, 2000);

/* ---------- 启动 ---------- */
accs.forEach((a, i) => setTimeout(() => { startEngine(a); setTimeout(() => connect(a), 2500); }, i * 300));

setInterval(() => {
  const n = [...rounds.values()];
  if (n.length > 200) for (const r of n) if (r.done && Date.now() - r.annT > 120000) rounds.delete(r.id);
}, 20000);

process.on('SIGINT', () => { accs.forEach((a) => { try { a.proc.kill(); } catch (e) {} }); process.exit(0); });
log('控制器启动，窗口数=' + accs.length + ' 规则=' + JSON.stringify(RULE));
