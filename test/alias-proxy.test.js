const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { requireProxy, loadProxies } = require('../src/services/required-proxy');
const { MailComAliasClient, HOME } = require('../src/services/mailcom-alias');

async function run() {
  for (const value of [null, undefined, '', ' ', 'socks5://localhost:1080', 'http://localhost:99999', 'http://localhost:8080/path']) {
    assert.throws(() => requireProxy(value));
  }
  assert.equal(requireProxy('localhost:8080:user:p:a:ss'), 'http://user:p%3Aa%3Ass@localhost:8080/');
  assert.equal(requireProxy('https://user:pass@localhost:8443'), 'https://user:pass@localhost:8443/');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'required-proxy-'));
  try {
    const file = path.join(root, 'proxy.txt');
    fs.writeFileSync(file, '\n'); assert.throws(() => loadProxies(file), /rỗng/);
    fs.writeFileSync(file, 'localhost:8080\nhttps://secret:private@localhost:99999');
    assert.throws(() => loadProxies(file), error => error.message.includes('dòng 2') && !error.message.includes('private'));
    fs.writeFileSync(file, '\uFEFFlocalhost:8080\nlocalhost:8080\n');
    assert.equal(loadProxies(file).length, 1);
    fs.writeFileSync(file, '  localhost:8080:user:p:a:ss  \r\nhttp://user:p%3Aa%3Ass@localhost:8080/\r\nhttps://user:pass@localhost:8443\n');
    assert.deepEqual(loadProxies(file, { raw: true }), ['localhost:8080:user:p:a:ss', 'https://user:pass@localhost:8443']);
    assert.deepEqual(loadProxies(file), ['http://user:p%3Aa%3Ass@localhost:8080/', 'https://user:pass@localhost:8443/']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }

  // Exercise real Axios + CONNECT agent against a local rejecting proxy only.
  // No connection is made to mail.com, even with NO_PROXY=*.
  const server = http.createServer();
  const requests = [];
  server.on('connect', (req, socket) => {
    requests.push({ target: req.url, auth: req.headers['proxy-authorization'] });
    socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  const originalConnect = net.connect, originalNoProxy = process.env.NO_PROXY;
  const destinations = [];
  net.connect = function (options, ...args) {
    destinations.push([options.host, Number(options.port)]);
    assert.equal(options.host, '127.0.0.1'); assert.equal(Number(options.port), port);
    return originalConnect.call(this, options, ...args);
  };
  process.env.NO_PROXY = '*';
  let client;
  try {
    client = new MailComAliasClient(() => {}, { proxy: `http://user:pass@127.0.0.1:${port}` });
    await assert.rejects(client.http(HOME), error => error.safeMessage.includes('407'));
    assert.deepEqual(requests, [{ target: 'www.mail.com:443', auth: 'Basic ' + Buffer.from('user:pass').toString('base64') }]);
    assert.equal(destinations.length, 1);
    await client.close();
    await new Promise(resolve => server.close(resolve));
    client = new MailComAliasClient(() => {}, { proxy: `http://127.0.0.1:${port}` });
    await assert.rejects(client.http(HOME, { timeout: 1000 }), error => error.safeMessage.includes('Không chuyển sang kết nối trực tiếp'));
    assert.equal(destinations.length, 2, 'No fallback or direct retry after proxy connection refused');
  } finally {
    await client?.close();
    net.connect = originalConnect;
    if (originalNoProxy === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = originalNoProxy;
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }
  console.log('Mandatory proxy tests passed: validation, CONNECT, auth, NO_PROXY override, no direct fallback');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
