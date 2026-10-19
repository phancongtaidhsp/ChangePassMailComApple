// Local fault injection only: never connect to an external server/account.
const assert = require('node:assert/strict');
const http = require('node:http');
const { legacyRequest, withDeadline } = require('../src/services/request-deadline');
const { MailComAliasClient, HOME } = require('../src/services/mailcom-alias');

async function run() {
  const sockets = new Set(), responses = [];
  const server = http.createServer((req, res) => {
    responses.push(req.url);
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.flushHeaders();
    res.write(req.url === '/oversized' ? 'x'.repeat(8192) : 'partial body');
    // Deliberately leave the body incomplete.
  });
  let connects = 0;
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.on('connect', () => { connects++; /* Deliberately never answer CONNECT. */ });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  let client;
  try {
    const legacy = require('axios-https-proxy-fix').create({ timeout: 40 });
    const url = `http://127.0.0.1:${port}`;
    await assert.rejects(legacyRequest(legacy, { url: `${url}/incomplete`, proxy: false, maxRedirects: 0, timeout: 40 }), error => error.code === 'ECONNABORTED');
    await assert.rejects(legacyRequest(legacy, { url: `${url}/oversized`, proxy: false,
      maxRedirects: 0, timeout: 500, maxContentLength: 1024 }), /maxContentLength/);
    const controller = new AbortController();
    await assert.rejects(withDeadline(() => require('axios').request({ url: `${url}/modern`,
      proxy: false, signal: controller.signal, timeout: 40 }), { timeout: 40, cancel: () => controller.abort() }));
    assert.equal(controller.signal.aborted, true);
    assert.deepEqual(responses, ['/incomplete', '/oversized', '/modern']);
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(sockets.size, 0, 'Requests must close unfinished body streams');

    client = new MailComAliasClient(() => {}, { proxy: `127.0.0.1:${port}` });
    await assert.rejects(client.http(HOME, { timeout: 40 }), error => error.retryable === true);
    assert.equal(connects, 1);
    await client.close();
  } finally {
    await client?.close();
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  }
  console.log('Local transport deadline tests passed: headers without body, oversized streaming body and stalled proxy CONNECT');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
