const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const electron = require('electron');
const LineByLineReader = require('line-by-line');
const fs = require('fs-extra');
const { sampleSize } = require('lodash');
const { checkLoginHotmailWithRetry } = require('./action');
const ipc = electron.ipcMain;

let win;
let lr;
let pause = false;
let currentIndex = 0;
let startTime = 0;
let interval;

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
    return;
  }

  if (incompleteFile2) {
    win.webContents.send('checkfiles', incompleteFile2);
    return;
  }

  win.webContents.send('disable', true);

  let listProxy = fs.readFileSync(pathFileProxy, 'utf8');
  listProxy = listProxy
    .split(/\r?\n/)
    .filter(Boolean);

  const outvalid =
    `${__dirname}\\..\\extraResources\\CheckLoginHotmail\\valid.txt`;

  const outinvalid =
    `${__dirname}\\..\\extraResources\\CheckLoginHotmail\\invalid.txt`;

  let running = 0;
  let fileEnded = false;

  lr = new LineByLineReader(pathFileMail, {
    start: currentIndex
  });

  const checkDone = () => {
    if (fileEnded && running === 0) {
      if (interval) {
        clearInterval(interval);
      }

      isDone = true;
      win.webContents.send('disable', false);
    }
  };

  const processLine = async (info) => {
    const [mail, pass] = info.split("|");

    try {
      const proxiesApple = sampleSize(listProxy, 5);

      const {
        status,
        email,
        password
      } = await checkLoginHotmailWithRetry(
        mail,
        pass,
        proxiesApple
      );

      if (status === "valid") {
        const result =
          `${email}|${password}|${status}\n`;

        fs.appendFileSync(outvalid, result);

        win.webContents.send(
          'valid',
          1,
          pause
        );
      } else if (status === "invalid") {
        const result =
          `${email}|${password}|${status}\n`;

        fs.appendFileSync(outinvalid, result);

        win.webContents.send(
          'invalid',
          1,
          pause
        );
      } else {
        win.webContents.send(
          'unchecked',
          1,
          pause
        );
      }
    } catch (error) {
      console.log(error);

      win.webContents.send(
        'unchecked',
        1,
        pause
      );
    } finally {
      running--;

      if (pause) {
        isDone = false;

        if (lr) {
          lr.close();
        }

        return;
      }

      if (!fileEnded) {
        lr.resume();
      }

      checkDone();
    }
  };

  lr.on('error', function (err) {
    win.webContents.send('loi', err);
    win.webContents.send('disable', false);
  });

  lr.on('line', function (info) {
    if (pause) {
      isDone = false;
      lr.close();
      return;
    }

    running++;

    currentIndex++;

    win.webContents.send(
      'total',
      currentIndex
    );

    processLine(info);

    if (running >= thread) {
      lr.pause();
    }
  });

  lr.on('end', function () {
    fileEnded = true;

    checkDone();
  });
};

function isFileExists(pathFile) {
  const check = fs.pathExistsSync(pathFile);
  if (!check) return pathFile;
  return false;
}

ipc.on('start', async function (event, pathFileMail, pathFileProxy, thread) {
  let pathFolder = `${__dirname}\\..\\extraResources\\CheckLoginHotmail`;
  let incompleteFolder = isFileExists(pathFolder);
  if (incompleteFolder) {
    fs.mkdirSync(pathFolder);
  }
  pause = false;
  interval = setInterval(() => {
    startTime++;
    win.webContents.send('time', startTime);
  }, 1000);
  run(pathFileMail, pathFileProxy, thread);
})

ipc.on('pause', async function (event) {
  if (lr) {
    pause = true;
    if (interval) {
      clearInterval(interval)
    }
    win.webContents.send('info', "Đang tạm dừng...Vui lòng chờ...", true);
  }
})

const xuatKetQua = (pathFileMail) => {
  let outvalid = `${__dirname}\\..\\extraResources\\CheckLoginHotmail\\valid.txt`;
  let outinvalid = `${__dirname}\\..\\extraResources\\CheckLoginHotmail\\invalid.txt`;
  let incompleteFile1 = isFileExists(pathFileMail);
  if (incompleteFile1) {
    win.webContents.send('checkfiles', incompleteFile1);
    return;
  }
  let listMail = fs.readFileSync(pathFileMail, 'utf8');
  listMail = listMail.split(/\r?\n/);
  let listMailValid = fs.readFileSync(outvalid, 'utf8');
  listMailValid = listMailValid.split(/\r?\n/);
  let listMailInvalid = fs.readFileSync(outinvalid, 'utf8');
  listMailInvalid = listMailInvalid.split(/\r?\n/);
  // remove all mail valid
  for (const maildata of listMailValid) {
    let mail = maildata.split('|')?.[0];
    let indexMail = listMail.findIndex(m => m.includes(mail));
    if (indexMail >= 0) {
      listMail = [...listMail.slice(0, indexMail), ...listMail.slice(indexMail + 1)];
    }
  }
  // remove all mail invalid
  for (const maildata of listMailInvalid) {
    let mail = maildata.split('|')?.[0];
    let indexMail = listMail.findIndex(m => m.includes(mail));
    if (indexMail >= 0) {
      listMail = [...listMail.slice(0, indexMail), ...listMail.slice(indexMail + 1)];
    }
  }
  fs.writeFileSync(pathFileMail, listMail.join('\n'), 'utf8');
}

ipc.on('result', function (event, pathFileMail) {
  xuatKetQua(pathFileMail);
  win.webContents.send('result', true);
})