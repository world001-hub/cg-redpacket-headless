// farm.js —— 选房 + 三刀：按「抢满时长」挑房间，进慢房间后 0/200/400ms 错开出刀
// 进程：MON(slot1 连聊天室) + G1/G2(slot2 只抢)；三个号都 change 一次占座
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

const RT = 'E:\\CG_analyze\\engine';
const NODE = path.join(RT, 'node.exe');
const ENGINE = path.join(RT, 'engine.js');
const cfg = JSON.parse(fs.readFileSync('E:\\红包接龙助手\\config.json', 'utf8'));

const SLOW_MS = Number(process.env.SLOW_MS || 800);   // 房间抢满时长门槛
const OBSERVE_MS = Number(process.env.OBSERVE_MS || 90000);

const NODES = [
  { name: '监听', link: cfg.accounts[0].url, port: 9250, slot: '1', dev: 0, mon: true, proxy: '' },
  { name: '窗口2', link: cfg.accounts[1].url, port: 9252, slot: '2', dev: 250, proxy: process.env.P2 || '' },
];

const T0 = Date.now();
const ts = () => '+ ' + String(Date.now() - T0).padStart(6) + 'ms';
const log = (...a) => console.log(ts(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 房间节奏统计 ---------- */
const roomStat = {};   // room -> { fills: [], open: {id: t} }
function onBagEvent(n) {
  const room = String(n.room || '');
  if (!room) return;
  const st = (roomStat[room] = roomStat[room] || { fills: [], open: {}, lastOpen: 0 });
  if (n.btype === 1) { st.open[n.id] = Date.now(); st.lastOpen = Date.now(); }
  if (n.btype === 2 && n.grab >= 3 && st.open[n.id]) { st.fills.push(Date.now() - st.open[n.id]); delete st.open[n.id]; }
  if (n.btype === 3 && st.open[n.id]) { st.fills.push(Date.now() - st.open[n.id]); delete st.open[n.id]; }
}
const med = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
function bestRoom() {
  let best = null, bestMs = -1;
  for (const [r, st] of Object.entries(roomStat)) {
    if (st.fills.length < 2) continue;
    const m = med(st.fills);
    if (m > bestMs) { bestMs = m; best = r; }
  }
  return best ? { room: best, ms: bestMs } : null;
}

/* ---------- 引擎 ---------- */
function launch(o) {
  o.proc = spawn(NODE, [ENGINE, String(o.port), o.link, o.slot, '', o.proxy || '', '8', '0', String(o.dev)],
    { cwd: RT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  o.proc.stdout.on('data', () => {});
  o.proc.stderr.on('data', () => {});
  o.buf = ''; o.room = null;
}
function attach(o) {
  const s = net.connect(o.port, '127.0.0.1', () => s.write(JSON.stringify({ cmd: 'join' }) + '\n'));
  s.setNoDelay(true); o.sock = s;
  s.on('data', (d) => {
    o.buf += d.toString();
    let i;
    while ((i = o.buf.indexOf('\n')) >= 0) {
      const l = o.buf.slice(0, i).trim(); o.buf = o.buf.slice(i + 1);
      if (!l) continue;
      let m; try { m = JSON.parse(l); } catch (e) { continue; }
      if (m.type === 'joinres') { o.room = String(m.room); o.netId = m.netId; o.expect = m.expect; }
      else if (m.type === 'bagid') onBagEvent(m);
      else if (m.type === 'grabres') { o.res = m.res; }
    }
  });
}
const send = (o, obj) => { try { o.sock.write(JSON.stringify(obj) + '\n'); } catch (e) {} };

(async () => {
  NODES.forEach(launch);
  await sleep(3500);
  NODES.forEach(attach);
  for (let i = 0; i < 50 && NODES.some((o) => !o.room); i++) await sleep(300);
  log('进房：' + NODES.map((o) => o.name + '=' + o.room).join(' '));

  const mon0 = NODES.find((o) => o.mon);
  const cnt00 = {};
  NODES.forEach((o) => { if (o.room) cnt00[o.room] = (cnt00[o.room] || 0) + 1; });
  if (cnt00[mon0.room] >= 2) {
    log('初始就是同房 ' + mon0.room + '，不 change（change 会把房间打散），等座位落地');
  } else {
    log('初始不同房，整组 change 一次重摇');
    NODES.forEach((o) => { o.room = null; send(o, { cmd: 'change' }); });
    for (let i = 0; i < 50 && NODES.some((o) => !o.room); i++) await sleep(300);
    log('change 后：' + NODES.map((o) => o.name + '=' + o.room).join(' '));
  }
  await sleep(12000);

  // 观察期：统计各房间抢满时长
  log('观察 ' + Math.round(OBSERVE_MS / 1000) + ' 秒，统计房间节奏…');
  const endObs = Date.now() + OBSERVE_MS;
  while (Date.now() < endObs) {
    await sleep(3000);
    const rows = Object.entries(roomStat).filter(([, s]) => s.fills.length >= 2)
      .map(([r, s]) => r + ':' + med(s.fills) + 'ms(' + s.fills.length + ')');
    if (rows.length) log('  房间节奏 ' + rows.join('  '));
  }
  let pick = null;
  for (let round = 1; round <= 20; round++) {
    const cnt0 = {};
    NODES.forEach((o) => { if (o.room) cnt0[o.room] = (cnt0[o.room] || 0) + 1; });
    const monRoom = NODES.find((o) => o.mon) && NODES.find((o) => o.mon).room;
    const pair = monRoom && cnt0[monRoom] >= 2 ? [monRoom, cnt0[monRoom]] : null;
    log('第' + round + '轮对齐：' + NODES.map((o) => o.name + '=' + o.room).join(' ') + (pair ? '  ← 有' + pair[1] + '个在' + pair[0] : ''));
    if (pair) {
      const st = roomStat[pair[0]];
      const m = st && st.fills.length ? med(st.fills) : 0;
      pick = { room: pair[0], ms: m };
      log('★采用房间 桌' + pick.room + '（房速中位 ' + m + 'ms）');
      break;
    }
    NODES.forEach((o) => { o.room = null; send(o, { cmd: 'change' }); });
    await sleep(1500);
  }
  if (!pick) { log('20 轮没能凑出两个号同房，退出'); NODES.forEach((o) => o.proc.kill()); process.exit(1); }
  const cnt = {};
  NODES.forEach((o) => { if (o.room) cnt[o.room] = (cnt[o.room] || 0) + 1; });


  // 进慢房间：所有号 change 直到都落在 pick.room
  for (let round = 0; round < 3; round++) {
    const bad = NODES.filter((o) => o.room !== pick.room);
    if (!bad.length) break;
    bad.forEach((o) => { o.room = null; send(o, { cmd: 'change' }); });
    await sleep(1600);
  }
  const inRoom = NODES.filter((o) => o.room === pick.room);
  log('★在房间内的号：' + inRoom.map((o) => o.name).join('、') + '（' + inRoom.length + '/3）');
  if (inRoom.length < 2) { log('房间内不足两个号，退出'); NODES.forEach((o) => o.proc.kill()); process.exit(1); }

  // 三刀：0 / 200 / 400ms
  const DELAYS = [0, 0];   // 两刀同一瞬间发出
  let wins = 0, rounds = 0, triple = 0;
  for (let k = 0; k < 12; k++) {
    const bag = await new Promise((res) => {
      const t = setInterval(() => {
        for (const o of NODES) if (o.mon && o.room === pick.room) {
          const st = roomStat[pick.room] || (roomStat[pick.room] = { fills: [], open: {}, lastOpen: 0 });
          const ids = Object.keys(st.open).map(Number).filter((id) => !st.seen || !st.seen[id]);
          if (ids.length) {
            const id = Math.max(...ids);
            st.seen = st.seen || {}; st.seen[id] = 1;
            clearInterval(t); res({ id, room: pick.room }); return;
          }
        }
      }, 50);
      setTimeout(() => { clearInterval(t); res(null); }, 20000);
    });
    if (!bag) { log('等包超时'); break; }
    rounds++;
    log('★第' + rounds + '期 包 ' + bag.id + '（房速中位 ' + pick.ms + 'ms）');
    NODES.forEach((o) => { o.res = null; });
    inRoom.forEach((o, i) => {
      setTimeout(() => send(o, { cmd: 'grab', id: Number(bag.id) }), DELAYS[i] || 0);
    });
    await sleep(2200);
    let got = 0;
    for (const o of inRoom) {
      const r = o.res || {};
      const money = r.data && (r.data.money || r.data.reward);
      const ok = String(r.code) === '200' && Number(money) > 0;
      if (ok) { got++; wins++; }
      log('   ' + o.name + ' ' + (ok ? '✅ ' + money : '❌ ' + (r.code || '?') + ' ' + (r.msg || '')));
    }
    if (got === inRoom.length) triple++;
    log('   本期命中 ' + got + '/3');
  }
  log('==== 汇总：' + rounds + ' 期，抢到 ' + wins + ' 刀，三刀全占 ' + triple + ' 期 ====');
  NODES.forEach((o) => o.proc.kill());
  process.exit(0);
})().catch((e) => { log('异常 ' + e.message); process.exit(1); });
