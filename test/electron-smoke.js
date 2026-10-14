// Chạy với Electron, dùng dữ liệu giả; không gọi API mail.com.
const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const MailCom = require('../src/services/mailcom');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mailcom-ui-test-'));
app.setPath('userData', path.join(root, 'userData'));
fs.writeFileSync(path.join(root, 'emails.txt'), 'first@mail.com\nsecond@usa.com\ninvalid@example.com\nfirst@mail.com\n');
MailCom.prototype.CheckEmail = async email => {
  await new Promise(resolve => setTimeout(resolve, 50));
  const availability = email.startsWith('first') ? 'unavailable' : email.startsWith('second') ? 'available' : 'unknown';
  return { email, availability, status: availability === 'unknown' ? 'error' : 'success', exists: null,
    message: availability === 'unavailable' ? 'Tên đã dùng hoặc bị giữ lại; chưa xác nhận hộp thư tồn tại.'
      : availability === 'available' ? 'Tên email còn khả dụng để đăng ký.' : 'Tên miền không được hỗ trợ.' };
};
dialog.showOpenDialog = async (_window, options) => ({ canceled: false, filePaths: [options.properties.includes('openDirectory') ? root : path.join(root, 'emails.txt')] });

async function run() {
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
  await click('start');
  await waitFor('document.getElementById("message").classList.contains("error")');
  await click('choose-email');
  await click('choose-output');
  await waitFor(`document.getElementById("outputRoot").value === ${JSON.stringify(root)}`);
  await click('start');
  await waitFor('document.getElementById("unavailable").textContent === "1"');
  await click('pause');
  await waitFor('document.getElementById("status").textContent === "Đã tạm dừng"');
  assert.equal(await evaluate('document.getElementById("resume").hidden'), false);
  await click('resume');
  await waitFor('document.getElementById("status").textContent === "Hoàn tất"');
  assert.equal(await evaluate('document.querySelectorAll("#rows tr").length'), 3);
  assert.equal(await evaluate('document.getElementById("available").textContent'), '1');
  assert.equal(await evaluate('document.getElementById("unknown").textContent'), '1');
  assert.equal(await evaluate('document.getElementById("open-results").disabled'), false);
  assert.equal(await evaluate('document.getElementById("duplicates").textContent'), '1 email trùng được bỏ qua');
  assert.equal(await evaluate('typeof window.require'), 'undefined');
  assert.equal(fs.readFileSync(path.join(root, 'live.txt'), 'utf8'), 'first@mail.com\n');
  assert.equal(fs.readFileSync(path.join(root, 'die.txt'), 'utf8'), 'second@usa.com\n');
  assert.equal(fs.readFileSync(path.join(root, 'unknown.txt'), 'utf8'), 'invalid@example.com\n');
  assert.equal(await evaluate('document.getElementById("export-results").disabled'), false);
  await click('export-results');
  await waitFor('document.getElementById("message").textContent.includes("Đã xuất kết quả")');
  assert.equal(fs.readFileSync(path.join(root, 'emails.txt'), 'utf8'), 'invalid@example.com\n');
  assert(!fs.readdirSync(root).some(name => /^\d{4}-/.test(name)));
  assert.deepEqual(errors, []);
  win.setSize(1160, 1020);
  await new Promise(resolve => setTimeout(resolve, 150));
  const screenshot = path.join(root, 'preview.png');
  fs.writeFileSync(screenshot, (await win.webContents.capturePage()).toPNG());
  console.log(`Electron UI tests passed. Screenshot: ${screenshot}`);
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  app.exit(0);
}

run().catch(error => { console.error(error); app.exit(1); });
