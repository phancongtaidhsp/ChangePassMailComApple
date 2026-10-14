const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const { Batch } = require('./batch');

if (require('electron-squirrel-startup')) app.quit();
app.setName('Proton Email Checker');
let win;
let batch;
let activeRun;
let closing = false;
let quitting = false;
const outputRoot = () => path.join(app.getPath('documents'), 'ProtonEmailChecker', 'results');
const busy = () => !!activeRun;

function createWindow() {
  win = new BrowserWindow({
    width: 1160, height: 840, minWidth: 860, minHeight: 680,
    title: 'Proton Email Checker', backgroundColor: '#f6f5fb',
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
  // run() xử lý lỗi từng email và lỗi ghi file; lỗi bất ngờ vẫn được đưa lên giao diện.
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

handle('app:config', () => ({ outputRoot: outputRoot(), ...(batch ? { snapshot: batch.snapshot() } : {}) }));
handle('file:choose', async kind => {
  if (busy()) throw new Error('Chờ lượt đang chạy hoàn tất hoặc tạm dừng.');
  if (!['email', 'proxy', 'output'].includes(kind)) throw new Error('Loại file không hợp lệ.');
  const result = await dialog.showOpenDialog(win, kind === 'output'
    ? { title: 'Chọn thư mục lưu kết quả', properties: ['openDirectory', 'createDirectory'] }
    : { title: kind === 'email' ? 'Chọn danh sách email Proton' : 'Chọn danh sách proxy (tùy chọn)', properties: ['openFile'], filters: [{ name: 'Danh sách văn bản', extensions: ['txt'] }] });
  return result.canceled ? null : result.filePaths[0];
});
handle('batch:start', options => {
  if (busy()) throw new Error('Một lượt kiểm tra đang chạy.');
  if (!options || typeof options.emailFile !== 'string' || typeof options.outputRoot !== 'string' ||
      (options.proxyFile && typeof options.proxyFile !== 'string')) throw new Error('Cấu hình không hợp lệ.');
  if (!options.outputRoot.trim()) throw new Error('Hãy chọn thư mục kết quả.');
  batch = new Batch(options, { onUpdate: update => {
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

app.whenReady().then(createWindow);
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on('before-quit', event => {
  if (busy()) { event.preventDefault(); quitting = true; win?.close(); }
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
