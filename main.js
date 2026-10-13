const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const readline = require('node:readline');
const electron = require('electron');
const fs = require('fs-extra');
const { sampleSize } = require('lodash');
const { changePassHotmailWithRetry } = require('./action');
const { enumerateRemainingLines, runWithConcurrency } = require('./run-concurrency');
const ipc = electron.ipcMain;

let win;
let lr;
let pause = false;
let currentIndex = 0;
let startTime = 0;
let interval;
let isRunning = false;
let currentInputPath = null;

const outputFolder = path.join(__dirname, '..', 'extraResources', 'DoiPassHotmail');
const outputFiles = {
  changedPass: path.join(outputFolder, 'doipass.txt'),
  loginOk: path.join(outputFolder, 'loginok.txt'),
  failed: path.join(outputFolder, 'fail.txt'),
};

function createWindow() {
  // Create the browser window.
  win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js')
    }
  })

  // and load the index.html of the app.
  win.loadFile('index.html')
}

app.whenReady().then(createWindow)

// Quit when all windows are closed.
app.on('window-all-closed', () => {
  // On macOS it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

const run = async function (pathFileMail, pathFileProxy, thread) {
  let incompleteFile1 = isFileExists(pathFileMail);
  let incompleteFile2 = isFileExists(pathFileProxy);
  if (incompleteFile1) {
    win.webContents.send('checkfiles', incompleteFile1);
    return false;
  }
  if (incompleteFile2) {
    win.webContents.send('checkfiles', incompleteFile2);
    return false;
  }

  let listProxy = fs.readFileSync(pathFileProxy, 'utf8');
  listProxy = listProxy.split(/\r?\n/);
  const outdoipass = outputFiles.changedPass;
  const outloginok = outputFiles.loginOk;
  const outfail = outputFiles.failed;
  const input = fs.createReadStream(pathFileMail, { encoding: 'utf8' });
  lr = readline.createInterface({ input, crlfDelay: Infinity });
  const lines = enumerateRemainingLines(lr, currentIndex);

  await runWithConcurrency(lines, async ({ line, lineNumber }) => {
    currentIndex = lineNumber + 1;
    win.webContents.send('total', currentIndex);

    const [mail, pass, recoveryEmail] = line.split('|');
    if (!mail || pass === undefined) {
      win.webContents.send('failed', 1, pause);
      return;
    }

    try {
      const proxiesHotmail = sampleSize(listProxy, 5);
      const { status, message, newPass } = await changePassHotmailWithRetry(
        mail,
        pass,
        recoveryEmail,
        proxiesHotmail
      );

      if (status === 'success') {
        if (message === 'Đổi pass thành công!') {
          fs.appendFileSync(outdoipass, `${mail}|${newPass || pass}|${recoveryEmail}\n`);
          win.webContents.send('changed-pass', 1, pause);
        } else {
          fs.appendFileSync(outloginok, `${mail}|${pass}|${recoveryEmail}\n`);
          win.webContents.send('login-ok', 1, pause);
        }
      } else {
        fs.appendFileSync(outfail, `${mail}|${pass}|${recoveryEmail}|${message || status || 'Unknown error'}\n`);
        win.webContents.send('failed', 1, pause);
      }
    } catch (error) {
      fs.appendFileSync(outfail, `${mail}|${pass}|${recoveryEmail}|${error.message || String(error)}\n`);
      win.webContents.send('failed', 1, pause);
      console.log(error);
    }
  }, {
    concurrency: thread,
    shouldStop: () => pause
  });

  return true;
}

function isFileExists(pathFile) {
  const check = fs.pathExistsSync(pathFile);
  if (!check) return pathFile;
  return false;
}

ipc.on('start', async function (event, pathFileMail, pathFileProxy, thread) {
  if (isRunning) return;

  const shouldResume = pause && currentInputPath === pathFileMail && currentIndex > 0;
  if (!shouldResume) {
    currentIndex = 0;
    startTime = 0;
    win.webContents.send('reset-progress');
  }

  isRunning = true;
  pause = false;
  currentInputPath = pathFileMail;
  win.webContents.send('disable', true);

  try {
    fs.ensureDirSync(outputFolder);

    interval = setInterval(() => {
      startTime++;
      win.webContents.send('time', startTime);
    }, 1000);

    const completed = await run(pathFileMail, pathFileProxy, thread);
    if (completed && !pause) {
      win.webContents.send('done', true);
    }
  } catch (error) {
    win.webContents.send('loi', error.message || String(error));
  } finally {
    if (lr) {
      lr.close();
      if (lr.input && !lr.input.destroyed) {
        lr.input.destroy();
      }
      lr = null;
    }
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
    isRunning = false;
    win.webContents.send('disable', false);
  }
})

ipc.on('pause', async function (event) {
  if (lr) {
    pause = true;
    if (interval) {
      clearInterval(interval)
      interval = null;
    }
    lr.close();
    if (lr.input && !lr.input.destroyed) {
      lr.input.destroy();
    }
    win.webContents.send('info', "Đang tạm dừng...Vui lòng chờ...", true);
  }
})

const xuatKetQua = (pathFileMail) => {
  const incompleteFile1 = isFileExists(pathFileMail);
  if (incompleteFile1) {
    win.webContents.send('checkfiles', incompleteFile1);
    return false;
  }

  let listMail = fs.readFileSync(pathFileMail, 'utf8');
  listMail = listMail.split(/\r?\n/);

  const readOutputLines = filePath => fs.pathExistsSync(filePath)
    ? fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
    : [];
  const completedEmails = new Set(
    [...readOutputLines(outputFiles.changedPass), ...readOutputLines(outputFiles.loginOk)]
      .map(line => line.split('|')[0]?.trim().toLowerCase())
      .filter(Boolean)
  );

  listMail = listMail.filter(line => {
    const email = line.split('|')[0]?.trim().toLowerCase();
    return !email || !completedEmails.has(email);
  });

  fs.writeFileSync(pathFileMail, listMail.join('\n'), 'utf8');
  return true;
}

ipc.on('result', function (event, pathFileMail) {
  try {
    const isSuccess = xuatKetQua(pathFileMail);
    win.webContents.send('result', isSuccess);
  } catch (error) {
    console.log(error);
    win.webContents.send('result', false);
  }
})
