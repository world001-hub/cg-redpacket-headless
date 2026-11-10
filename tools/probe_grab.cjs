// probe_grab.cjs —— 单号闭环实测：join → 等开包公告 → 抢 → 打印各段耗时
// 用法: node probe_grab.cjs <port> [timeoutSec]
const net = require('net');
const port = Number(process.argv[2] || 9105);
const secs = Number(process.argv[3] || 60);

const T0 = Date.now();
const ts = () => '+ ' + String(Date.now() - T0).padStart(7) + 'ms';
const log = (...a) => console.log(ts(), ...a);

const s = net.connect(port, '127.0.0.1', () => {
  s.setNoDelay(true);
  log('connected, join');
  s.write(JSON.stringify({ cmd: 'join' }) + '\n');
});
let buf = '';
let grabbed = 0;
const stat = [];

s.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    let o; try { o = JSON.parse(line); } catch (e) { continue; }
    if (o.type === 'evt' && /进房|登录/.test(o.ev || '')) log(o.ev);
    if (o.type === 'joinres') log('joinres 桌' + o.room + ' net' + o.netId + ' 期号' + o.expect);
    if (o.type === 'bagid' && o.btype === 1) {
      const annT = Date.now();
      const id = o.id;
      if (grabbed >= 6) continue;
      grabbed++;
      log('公告 ' + id + ' 桌' + o.room + ' → 立即出手');
      s.write(JSON.stringify({ cmd: 'grab', id: Number(id) }) + '\n');
      global.__last = { id, annT };
      continue;
    }
    if (o.type === 'grabres') {
      const r = global.__last || {};
      const code = String((o.res && o.res.code) || '');
      const money = o.res && o.res.data && (o.res.data.money || o.res.data.realMoney);
      const total = Date.now() - (r.annT || Date.now());
      log(`结果 id=${o.id} code=${code} money=${money} msg=${(o.res && o.res.msg) || ''} 公告→回包 ${total}ms 引擎内往返 ${o.rtt}ms`);
      stat.push({ id: o.id, code, money, total });
      continue;
    }
    if (o.type === 'err') log('ERR ' + o.msg);
  }
});

setTimeout(() => {
  log('---- 汇总 ----');
  const ok = stat.filter((x) => x.code === '200' && Number(x.money) > 0);
  log('尝试=' + stat.length + ' 成功=' + ok.length);
  for (const x of stat) log(JSON.stringify(x));
  if (ok.length) {
    const tot = ok.map((x) => x.total).sort((a, b) => a - b);
    log('公告→回包 中位=' + tot[Math.floor(tot.length / 2)] + 'ms  最小=' + tot[0] + 'ms');
  }
  s.end();
  process.exit(0);
}, secs * 1000);
