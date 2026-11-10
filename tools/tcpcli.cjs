/* 给参考引擎的 TCP 指令通道发一条命令并打印回包（JSON lines）
 * 用法：node tcpcli.cjs <port> "<json>" [waitMs]
 */
const net = require('net');
const port = Number(process.argv[2]);
let msg = process.argv[3] || 'status';
if (msg[0] !== '{') msg = JSON.stringify({ cmd: msg });
const waitMs = Number(process.argv[4] || 8000);

const s = net.connect(port, '127.0.0.1', () => {
  s.setNoDelay(true);
  const t0 = Date.now();
  s.write(msg + '\n');
  global.__t0 = t0;
});
let buf = '';
const lines = [];
s.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    lines.push('+' + (Date.now() - global.__t0) + 'ms ' + line.slice(0, 400));
  }
});
s.on('error', (e) => { console.log('ERR ' + e.message); process.exit(1); });
setTimeout(() => {
  console.log(lines.join('\n') || '(no data)');
  s.end();
  process.exit(0);
}, waitMs);
