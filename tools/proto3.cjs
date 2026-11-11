// proto3.cjs —— 按新协议执行：
//   第1步 四个号里选三个进同一房间
//   第2步 三个号轮流各抢一次，确认都不再报「不在本房间」
//   第3步 三个号按逻辑同时抢（0/0/0 同瞬间）
// 用法: node proto3.cjs
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

const RT = 'E:\\CG_analyze\\engine';
const NODE = path.join(RT, 'node.exe');
const ENGINE = path.join(RT, 'engine.js');
const cfg = JSON.parse(fs.readFileSync('E:\\红包接龙助手\\config.json', 'utf8'));
const px = (cfg.proxies || []).map((p) => p.split(':').join('|'));
const ACC = cfg.accounts;

const T0 = Date.now();
const ts = () => '+' + String(Date.now() - T0).padStart(6) + 'ms';
const log = (...a) => console.log(ts(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bag = null;

// 四个号：1 号直连（带聊天室），2/3/4 各走一条代理
function makeNodes() {
  return ACC.slice(0, 4).map((a, i) => ({
    idx: i,
    n: '号' + (i + 1),
    l: a.url,
    p: 9600 + i,
    slot: i === 0 ? '1' : '2',
    dev: 13 + i * 125,
    px: (i === 1 ? px[1] : (i === 2 ? px[2] : '')),   // 号1/号4 直连，号2/号3 各走一条代理
    room: null, res: null, sock: null, proc: null, buf: '', dry: false,
  }));
}

function launch(N) {
  for (const o of N) {
    o.proc = spawn(NODE, [ENGINE, String(o.p), o.l, o.slot, '', o.px || '', '8', '0', String(o.dev)],
      { cwd: RT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    o.proc.stdout.on('data', () => {}); o.proc.stderr.on('data', () => {});
    o.buf = ''; o.room = null;
  }
}
function attach(N) {
  for (const o of N) {
    const s = net.connect(o.p, '127.0.0.1', () => s.write(JSON.stringify({ cmd: 'join' }) + '\n'));
    s.setNoDelay(true); o.sock = s;
    s.on('error', () => {});
    s.on('data', (d) => {
      o.buf += d.toString();
      let i;
      while ((i = o.buf.indexOf('\n')) >= 0) {
        const l = o.buf.slice(0, i).trim(); o.buf = o.buf.slice(i + 1);
        try {
          const m = JSON.parse(l);
          if (m.type === 'joinres') o.room = String(m.room);
          else if (m.type === 'bagid' && m.btype === 1) bag = m;
          else if (m.type === 'grabres') o.res = m.res;
        } catch (e) {}
      }
    });
  }
}
const killAll = (N) => N.forEach((o) => { try { o.sock && o.sock.destroy(); } catch (e) {} try { o.proc && o.proc.kill(); } catch (e) {} });
const waitBags = async (n, ms) => { const out = []; const t = Date.now(); while (out.length < n && Date.now() - t < ms) { bag = null; for (let w = 0; w < 100 && !bag; w++) await sleep(100); if (bag) out.push(bag); } return out; };

(async () => {
  // ---------- 第 1 步：四个号里选三个进同一间 ----------
  let N = null, trio = null, room = null;
  for (let attempt = 1; attempt <= 6 && !trio; attempt++) {
    N = makeNodes();
    launch(N);
    await sleep(4200);
    attach(N);
    for (let i = 0; i < 60 && N.some((o) => !o.room); i++) await sleep(300);
    const cnt = {};
    N.forEach((o) => { if (o.room && o.room !== '0') cnt[o.room] = (cnt[o.room] || 0) + 1; });
    const best = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0];
    log('第' + attempt + '次启动：' + N.map((o) => o.n + '=' + o.room).join(' ') + '  最多人桌=' + best + '(' + (cnt[best] || 0) + ')');
    if (best && cnt[best] >= 3) { room = best; trio = N.filter((o) => o.room === room).slice(0, 3); break; }
    killAll(N);
    await sleep(1500);
  }
  if (!trio) { log('6 次都没凑到三个号同房，停止'); if (N) killAll(N); process.exit(0); }
  const rest = N.filter((o) => !trio.includes(o));
  // 保留其余号（聊天室在号1 上，关掉就收不到包）；它们只当监听，不出手
  log('  监听保留：' + (rest.length ? rest.map((o) => o.n).join('、') : '无'));
  log('★第1步完成：' + trio.map((o) => o.n).join('、') + ' 在桌' + room);

  // ---------- 第 2 步：轮流各抢一次 ----------
  log('第2步：三个号轮流各抢 1 个包，确认没有「不在本房间」');
  const bad = [];
  for (let i = 0; i < trio.length; i++) {
    const o = trio[i];
    const [b] = await waitBags(1, 25000);
    if (!b) { log('  等包超时'); continue; }
    o.res = null;
    try { o.sock.write(JSON.stringify({ cmd: 'grab', id: Number(b.id) }) + '\n'); } catch (e) {}
    await sleep(1800);
    const r = o.res || {};
    const m = r.data && (r.data.money || r.data.reward);
    const ok = String(r.code) === '200' && Number(m) > 0;
    log('  ' + o.n + ' 单独抢 包' + b.id + ' → ' + (ok ? '✅' + m : '✗' + (r.code || '?') + ' ' + (r.msg || '')));
    if (!ok) bad.push(o);   // 任何非成功都重测（含 panic 空 code）
  }
  if (bad.length) {
    log('第2步：' + bad.map((o) => o.n).join('、') + ' 座位没生效，各 change 一次后重测');
    for (const o of bad) {
      o.room = null;
      try { o.sock.write(JSON.stringify({ cmd: 'change' }) + '\n'); } catch (e) {}
      await sleep(2500);
      if (!o.room) {                       // change 没回应 → 重启这个引擎，重新 join + change
        log('  ' + o.n + ' change 无响应，重启引擎');
        try { o.sock && o.sock.destroy(); } catch (e) {}
        try { o.proc && o.proc.kill(); } catch (e) {}
        o.sock = null; o.room = null;
        await sleep(1200);
        launch([o]);
        await sleep(2600);
        attach([o]);
        for (let i = 0; i < 40 && !o.room; i++) await sleep(300);
        o.room = null;
        try { o.sock.write(JSON.stringify({ cmd: 'change' }) + '\n'); } catch (e) {}
        await sleep(3000);
      }
    }
    for (const o of bad) {
      const [b] = await waitBags(1, 25000);
      if (!b) continue;
      o.res = null;
      try { o.sock.write(JSON.stringify({ cmd: 'grab', id: Number(b.id) }) + '\n'); } catch (e) {}
      await sleep(1800);
      const r = o.res || {};
      const m = r.data && (r.data.money || r.data.reward);
      const ok = String(r.code) === '200' && Number(m) > 0;
      log('  ' + o.n + ' 重测 → ' + (ok ? '✅' + m : '✗' + (r.code || '?') + ' ' + (r.msg || '')));
    }
  } else log('★第2步完成：三个号都能单独抢到，没有「不在本房间」');

  // ---------- 第 3 步：三个号同时抢 ----------
  log('第3步：三个号同一瞬间出手（0/0/0）');
  let b1 = 0, b2 = 0, b3 = 0, total = 0;
  for (let k = 0; k < 5; k++) {
    const [b] = await waitBags(1, 25000);
    if (!b) { log('等包超时'); break; }
    total++;
    trio.forEach((o) => { o.res = null; });
    trio.forEach((o) => { try { o.sock.write(JSON.stringify({ cmd: 'grab', id: Number(b.id) }) + '\n'); } catch (e) {} });
    await sleep(1800);
    let got = 0;
    const d = trio.map((o) => {
      const r = o.res || {};
      const m = r.data && (r.data.money || r.data.reward);
      const ok = String(r.code) === '200' && Number(m) > 0;
      if (ok) got++;
      if (String(r.code) === '511') o.dry = true;
      return o.n + (ok ? '✅' + m : '✗' + (r.code || '?') + '(' + (r.msg || '').slice(0, 8) + ')');
    }).join('  ');
    if (got >= 3) b3++; else if (got === 2) b2++; else if (got === 1) b1++;
    log('包 ' + b.id + '  ' + d + '   命中 ' + got + '/3');
  }
  log('==== 第3步结果：' + total + ' 期中，3刀 ' + b3 + ' 次 / 2刀 ' + b2 + ' 次 / 1刀 ' + b1 + ' 次 ====');
  killAll(N);
  process.exit(0);
})().catch((e) => { log('异常 ' + e.message); process.exit(1); });
