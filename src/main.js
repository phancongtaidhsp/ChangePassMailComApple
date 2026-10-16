const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const { AliasBatch } = require('./alias-batch');
const { sendMail, changePassword } = require('./services/apple');

if (require('electron-squirrel-startup')) app.quit();
app.setName('Mail.com Alias Password Tool');
let win;
let batch;
let activeRun;
let closing = false;
let quitting = false;
const busy = () => !!activeRun;

function createWindow() {
  win = new BrowserWindow({
    width: 1160, height: 840, minWidth: 860, minHeight: 680,
    title: 'Đổi mật khẩu Mail.com Alias', backgroundColor: '#f6f5fb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false, contextIsolation: true, sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'ui/index.html'));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.on('close', event => {
    if (!busy()) return;
    event.preventDefault();
    if (closing) return;
    closing = true;
    batch.pause('Đang lưu kết quả trước khi đóng…');
    const finishClose = () => { closing = false; win.destroy(); if (quitting || process.platform !== 'darwin') app.quit(); };
    activeRun.then(finishClose, finishClose);
  });
}

function launch() {
  activeRun = batch.run().finally(() => { activeRun = null; });
  // Lỗi bất ngờ vẫn được đưa lên giao diện.
  activeRun.catch(error => {
    if (win && !win.isDestroyed()) win.webContents.send('batch:update', { ...batch.snapshot(), state: 'error', message: error.message });
  });
}

function handle(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Yêu cầu không hợp lệ.');
    try { return { ok: true, value: await handler(...args) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
}

handle('app:config', () => ({ outputRoot: '', emailFile: '', aliasFile: '', proxyFile: '', ...(batch ? { snapshot: batch.snapshot() } : {}) }));
handle('file:choose', async kind => {
  if (busy()) throw new Error('Chờ lượt đang chạy hoàn tất hoặc tạm dừng.');
  if (!['email', 'alias', 'proxy', 'output'].includes(kind)) throw new Error('Loại file không hợp lệ.');
  const result = await dialog.showOpenDialog(win, kind === 'output'
    ? { title: 'Chọn thư mục lưu kết quả', properties: ['openDirectory', 'createDirectory'] }
    : { title: kind === 'email' ? 'Chọn credentials.mailchinh.txt (email|password)' : kind === 'proxy' ? 'Chọn proxy.txt (mỗi dòng một proxy HTTP/HTTPS)' : 'Chọn mailphu.txt (mỗi dòng một alias)', properties: ['openFile'], filters: [{ name: 'Danh sách văn bản', extensions: ['txt'] }] });
  return result.canceled ? null : result.filePaths[0];
});
handle('batch:start', options => {
  if (busy()) throw new Error('Một lượt đổi pass alias đang chạy.');
  if (batch?.snapshot().pendingWrites) throw new Error('Còn kết quả chưa ghi được. Khắc phục dung lượng/quyền ghi rồi bấm Thử ghi lại trước khi bắt đầu lượt mới.');
  if (!options || typeof options.emailFile !== 'string' || typeof options.outputRoot !== 'string' ||
      typeof options.aliasFile !== 'string' || typeof options.proxyFile !== 'string') throw new Error('Cấu hình không hợp lệ.');
  if (!options.outputRoot.trim()) throw new Error('Hãy chọn thư mục kết quả.');
  batch = new AliasBatch(options, { sendMail, changePassword, onUpdate: update => {
    if (win && !win.isDestroyed()) win.webContents.send('batch:update', update);
  } });
  launch();
  return batch.snapshot();
});
handle('batch:pause', () => { batch?.pause(); });
handle('batch:resume', () => {
  if (busy() || batch?.state !== 'paused') throw new Error('Không có lượt đang tạm dừng.');
  launch();
  return batch.snapshot();
});
handle('results:open', async () => {
  if (!batch) throw new Error('Chưa có kết quả.');
  const error = await shell.openPath(batch.outputDir);
  if (error) throw new Error(error);
});
handle('results:retry-write', () => batch?.flushWrites());
handle('results:export', () => {
  if (busy() || !batch) throw new Error('Chờ lượt chạy hoàn tất trước khi xuất kết quả.');
  return batch.exportInputFiles();
});


app.whenReady().then(createWindow);
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on('before-quit', event => {
  if (busy()) { event.preventDefault(); quitting = true; win?.close(); }
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
