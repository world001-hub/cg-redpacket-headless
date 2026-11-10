// bench.js —— 实测线路延迟：直连 vs 代理1 vs 代理2
// 1) SOCKS5 握手耗时
// 2) TLS + 一次真实 API 请求的往返（取 10 次的最小值/中位数）
const path = require('path');
const tls = require('tls');
const net = require('net');
const RT = 'E:\\CG_analyze\\engine';
const { SocksClient } = require(path.join(RT, 'socks'));

const HOST = 'h5-api.chicsom.com';           // 第一条链接的 API 主机
const PORT = 443;
const PROXIES = [
  { name: '直连', sock: null },
  { name: '代理1', sock: { host: '123.126.74.197', port: 18081, type: 5, userId: '110677i314C', password: '518716' } },
  { name: '代理2', sock: { host: '183.192.164.249', port: 18081, type: 5, userId: '792328o314C', password: '622528' } },
];

function connect(proxy) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    if (!proxy.sock) {
      const s = net.connect(PORT, HOST, () => resolve({ socket: s, tcp: Date.now() - t0 }));
      s.on('error', reject);
      return;
    }
    SocksClient.createConnection({
      proxy: proxy.sock, command: 'connect',
      destination: { host: HOST, port: PORT }, timeout: 8000,
    }).then((i) => resolve({ socket: i.socket, tcp: Date.now() - t0 })).catch(reject);
  });
}

function tlsHandshake(socket) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const s = tls.connect({ socket, servername: HOST, rejectUnauthorized: false }, () => {
      resolve({ tls: Date.now() - t0, socket: s });
    });
    s.on('error', reject);
  });
}

function httpGet(socket, host) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    let buf = '';
    const onData = (d) => {
      buf += d.toString();
      if (buf.includes('\r\n\r\n')) {
        socket.removeListener('data', onData);
        resolve({ ttfb: Date.now() - t0, status: (buf.match(/^HTTP\/[\d.]+\s+(\d+)/) || [])[1] });
      }
    };
    socket.on('data', onData);
    socket.write('GET /games/redbag/chain/v1/room/grab/list?params=x HTTP/1.1\r\n' +
      'Host: ' + host + '\r\nConnection: keep-alive\r\nAccept: */*\r\n\r\n');
    setTimeout(() => { socket.removeListener('data', onData); reject(new Error('timeout')); }, 8000);
  });
}

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

(async () => {
  for (const p of PROXIES) {
    const tcp = [], tlsT = [], ttfb = [];
    try {
      for (let i = 0; i < 5; i++) {
        const c = await connect(p);
        const t = await tlsHandshake(c.socket);
        tcp.push(c.tcp); tlsT.push(t.tls);
        for (let k = 0; k < 3; k++) {
          const r = await httpGet(t.socket, HOST);
          ttfb.push(r.ttfb);
        }
        t.socket.destroy();
      }
      console.log(p.name.padEnd(6),
        ' TCP/握手 min=' + Math.min(...tcp) + 'ms med=' + med(tcp) + 'ms',
        ' TLS min=' + Math.min(...tlsT) + 'ms',
        ' 请求TTFB min=' + Math.min(...ttfb) + 'ms med=' + med(ttfb) + 'ms',
        ' (样本 ' + ttfb.length + ')');
    } catch (e) {
      console.log(p.name.padEnd(6), ' 失败: ' + e.message);
    }
  }
  process.exit(0);
})();
