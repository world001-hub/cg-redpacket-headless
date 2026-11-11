// same.js —— 照原版软件的思路：三个引擎"同时"启动、立刻 join，看能不能自然落到同一间
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

const RT = 'E:\\CG_analyze\\engine';
const NODE = path.join(RT, 'node.exe');
const ENGINE = path.join(RT, 'engine.js');
const cfg = JSON.parse(fs.readFileSync('E:\\红包接龙助手\\config.json', 'utf8'));
const px = (cfg.proxies || []).map((p) => p.split(':').join('|'));

const MK = () => ([
  { name: '窗口1', link: cfg.accounts[0].url, port: 9501, slot: '1', dev: 13, proxy: '' },
  { name: '窗口2', link: cfg.accounts[1].url, port: 9502, slot: '2', dev: 145, proxy: px[1] },
  { name: '窗口3', link: cfg.accounts[2].url, port: 9503, slot: '2', dev: 257, proxy: px[2] },
]);
const T0 = Date.now();
const ts = () => '+' + String(Date.now() - T0).padStart(6) + 'ms';
const log = (...a) => console.log(ts(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let sameCount = 0;
  for (let round = 1; round <= 5; round++) {
    const N = MK();
    // 同一瞬间全部启动
    for (const o of N) {
      o.proc = spawn(NODE, [ENGINE, String(o.port), o.link, o.slot, '', o.proxy || '', '8', '0', String(o.dev)],
        { cwd: RT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      o.proc.stdout.on('data', () => {}); o.proc.stderr.on('data', () => {});
      o.buf = ''; o.room = null;
    }
    await sleep(4000);
    // 同时连、同时 join
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
        }
      });
    }
    for (let i = 0; i < 60 && N.some((o) => !o.room); i++) await sleep(300);
    const rooms = N.map((o) => o.room);
    const cnt = {};
    rooms.forEach((r) => { if (r) cnt[r] = (cnt[r] || 0) + 1; });
    const best = Math.max(0, ...Object.values(cnt));
    if (best >= 2) sameCount++;
    log('第' + round + '轮同时启动：' + N.map((o) => o.name + '=' + o.room).join(' ') + '   → 同房数 ' + best + '/3');
    N.forEach((o) => { try { o.sock && o.sock.destroy(); } catch (e) {} try { o.proc.kill(); } catch (e) {} });
    await sleep(1500);
  }
  log('==== 5 轮里有 ' + sameCount + ' 轮出现两号以上同房 ====');
  process.exit(0);
})().catch((e) => { log('异常 ' + e.message); process.exit(1); });
