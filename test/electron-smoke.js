// Chạy với Electron, dùng dữ liệu giả; không gọi API mail.com.
const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { MailComAliasClient } = require('../src/services/mailcom-alias');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mailcom-ui-test-'));
app.setPath('userData', path.join(root, 'userData'));
fs.writeFileSync(path.join(root, 'main.txt'), 'main@mail.com|dummy-password\nmain2@mail.com|dummy-password2\n');
fs.writeFileSync(path.join(root, 'aliases.txt'), 'first@mail.com\nsecond@mail.com\nfirst@mail.com\n');
fs.writeFileSync(path.join(root, 'proxy.txt'), '127.0.0.1:8080\n');
MailComAliasClient.prototype.login = async () => {};
MailComAliasClient.prototype.close = async () => {};
MailComAliasClient.prototype.listAddresses = async () => [{ address: 'first@mail.com' }];
MailComAliasClient.prototype.waitForAppleVerification = async function () {
  this.check();
  return { status: 'found', link: 'https://iforgot.apple.com/verify/email?key=ui-fixture', messageId: 'fixture' };
};
MailComAliasClient.prototype.addAlias = async alias => {
  await new Promise(resolve => setTimeout(resolve, 50));
  return { status: alias.startsWith('first') ? 'added' : 'existing', message: 'Verified fixture' };
};
MailComAliasClient.prototype.removeAlias = async () => ({ status: 'removed', message: 'Đã xóa alias khỏi mail chính.' });
dialog.showOpenDialog = async (_window, options) => ({ canceled: false, filePaths: [options.properties.includes('openDirectory') ? root : path.join(root, options.title.includes('credentials') ? 'main.txt' : options.title.includes('proxy.txt') ? 'proxy.txt' : 'aliases.txt')] });

async function run() {
  // Main uses the real Apple integration; substitute it before loading main.
  require.cache[require.resolve('../src/services/apple')] = { exports: {
    sendMail: async () => { await new Promise(resolve => setTimeout(resolve, 200)); return 'successfully'; },
    changePassword: async () => 'successfully'
  } };
  const created = once(app, 'browser-window-created');
  require('../src/main');
  const [, win] = await created;
  const errors = [];
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
  await once(win.webContents, 'did-finish-load');
  const evaluate = source => win.webContents.executeJavaScript(source);
  const click = id => evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
  const waitFor = async source => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (await evaluate(source)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out: ${source}`);
  };
  await waitFor('!!document.getElementById("outputRoot").value');
  assert.equal(await evaluate('document.getElementById("export-results").disabled'), true);
  await click('choose-email');
  await click('choose-alias');
  await click('choose-output');
  await click('start');
  await waitFor('document.getElementById("message").textContent.includes("proxy")');
  await click('choose-proxy');
  assert.equal(await evaluate('document.getElementById("newPassword")'), null);
  await waitFor(`document.getElementById("outputRoot").value === ${JSON.stringify(root)}`);
  assert.equal(await evaluate('document.getElementById("concurrency").value'), '1');
  await click('start');
  await waitFor('document.getElementById("inProgress").textContent === "1"');
  assert.equal(await evaluate('document.getElementById("export-results").disabled'), true);
  await click('pause');
  await waitFor('document.getElementById("status").textContent === "Đã tạm dừng"');
  assert.equal(await evaluate('document.getElementById("export-results").disabled'), true);
  assert.equal(await evaluate('document.getElementById("resume").hidden'), false);
  await click('resume');
  await waitFor('document.getElementById("status").textContent === "Hoàn tất"');
  assert.equal(await evaluate('document.querySelectorAll("#rows tr").length'), 2);
  assert.equal(await evaluate('document.getElementById("passwordChanged").textContent'), '1');
  assert.equal(await evaluate('document.getElementById("passwordFailed").textContent'), '1');
  assert.equal(await evaluate('document.getElementById("linksFound").textContent'), '1');
  assert(await evaluate('document.getElementById("rows").textContent.includes("Mật khẩu mới:")'));
  assert(await evaluate('document.getElementById("rows").textContent.includes("Đổi pass thành công")'));
  assert.equal(await evaluate('document.getElementById("open-results").disabled'), false);
  assert.equal(await evaluate('document.getElementById("duplicates").textContent'), '1 email trùng được bỏ qua');
  assert.equal(await evaluate('typeof window.require'), 'undefined');
  const records = fs.readFileSync(path.join(root, 'alias-results.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(records.filter(r => !r.event).map(r => r.status), ['added', 'existing']);
  assert(!JSON.stringify(records).includes('dummy-password'));
  assert(records.every(record => !Object.prototype.hasOwnProperty.call(record, 'newPassword')));
  assert.equal(fs.readFileSync(path.join(root, 'aliases.txt'), 'utf8'), 'first@mail.com\nsecond@mail.com\nfirst@mail.com\n');
  const successAdd = MailComAliasClient.prototype.addAlias;
  MailComAliasClient.prototype.addAlias = async () => ({ status: 'failed', httpStatus: 412, message: 'HTTP 412' });
  await click('start');
  await waitFor('document.getElementById("status").textContent === "Hoàn tất" && document.getElementById("passwordFailed").textContent === "2"');
  assert(await evaluate('document.getElementById("rows").textContent.includes("Không thể add mail phụ")'));
  assert(await evaluate('document.getElementById("message").textContent.includes("Đã hết mail phụ")'));
  MailComAliasClient.prototype.addAlias = async function () {
    this.requireSuccess({ status: 412, data: { type: 'urn:problem:mam:cats:target-response-masked' } }, 'Thêm alias');
  };
  await click('start');
  await waitFor('document.getElementById("status").textContent === "Hoàn tất" && document.getElementById("passwordFailed").textContent === "2"');
  assert.equal(await evaluate('document.querySelectorAll("#rows tr").length'), 2);
  assert(await evaluate('document.getElementById("rows").textContent.includes("HTTP 412")'));
  assert(await evaluate('document.getElementById("rows").textContent.includes("CATS")'));
  assert.equal(await evaluate('document.getElementById("resume").hidden'), true);
  const attempts = fs.readFileSync(path.join(root, 'alias-results.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(attempts[attempts.length - 1].status, 'failed');
  assert.equal(attempts[attempts.length - 1].httpStatus, 412);
  MailComAliasClient.prototype.addAlias = successAdd;
  await click('start');
  await waitFor('document.getElementById("status").textContent === "Hoàn tất"');
  assert.equal(await evaluate('document.querySelectorAll("#rows tr").length'), 2);
  assert.equal(await evaluate('document.getElementById("attention").textContent'), '0');
  assert.equal(await evaluate('document.getElementById("rows").textContent.includes("Cần xử lý")'), false);
  // Login failures use their own file, leave the alias queue intact, and show
  // the next account. A storage fault must still let this run finish.
  MailComAliasClient.prototype.login = async account => {
    if (account.email === 'main@mail.com') throw Object.assign(new Error('private login detail'), { safeMessage: 'Cần xác minh SMS.', code: 'NEEDS_ATTENTION' });
  };
  const originalOpen = fs.openSync;
  const resultNames = new Set(['success.txt', 'fail.txt', 'mailchinhfail.txt', 'alias-results.jsonl']);
  fs.openSync = function (filename, ...args) {
    if (typeof filename === 'string' && path.dirname(filename) === root && resultNames.has(path.basename(filename))) {
      throw Object.assign(new Error('private disk detail'), { code: 'ENOSPC' });
    }
    return originalOpen.call(this, filename, ...args);
  };
  try {
    await click('start');
    await waitFor('document.getElementById("status").textContent === "Hoàn tất" && document.getElementById("main-failures").textContent === "1"');
    assert.equal(await evaluate('document.getElementById("write-status").hidden'), false);
    assert.equal(await evaluate('document.getElementById("retry-writes").disabled'), false);
    assert.equal(await evaluate('document.getElementById("start").disabled'), true);
    assert.equal(await evaluate('document.getElementById("export-results").disabled'), true);
    assert(await evaluate('Array.from(document.querySelectorAll("#rows tr")).every(row => row.cells[0].textContent === "main2@mail.com")'));
  } finally { fs.openSync = originalOpen; }
  await click('retry-writes');
  await waitFor('document.getElementById("write-status").hidden && !document.getElementById("start").disabled');
  assert.equal(await evaluate('document.getElementById("retry-writes").disabled'), true);
  assert.equal(await evaluate('document.getElementById("rows").textContent.includes("Đang chờ ghi")'), false);
  assert(fs.readFileSync(path.join(root, 'mailchinhfail.txt'), 'utf8').includes('main@mail.com|main_login_failed'));
  assert.equal(await evaluate('document.getElementById("export-results").disabled'), false);
  await click('export-results');
  await waitFor('document.getElementById("export-results").textContent === "Đã xuất kết quả"');
  assert.equal(await evaluate('document.getElementById("export-results").disabled'), true);
  assert.equal(fs.readFileSync(path.join(root, 'main.txt'), 'utf8'), 'main2@mail.com|dummy-password2\n');
  assert.equal(fs.readFileSync(path.join(root, 'aliases.txt'), 'utf8'), 'second@mail.com\n');
  assert(await evaluate('document.getElementById("input-export-status").textContent.includes("xóa 2 dòng alias và 1 dòng mail chính")'));
  assert.deepEqual(errors, []);
  assert.equal(BrowserWindow.getAllWindows().length, 1, 'Request mode must not open account browser windows');
  win.setSize(1160, 1020);
  await evaluate('document.getElementById("results-title").scrollIntoView({ block: "start" })');
  await new Promise(resolve => setTimeout(resolve, 150));
  const screenshot = path.join(root, 'preview.png');
  fs.writeFileSync(screenshot, (await win.webContents.capturePage()).toPNG());
  console.log(`Electron UI tests passed. Screenshot: ${screenshot}`);
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  app.exit(0);
}

run().catch(error => { console.error(error); app.exit(1); });
