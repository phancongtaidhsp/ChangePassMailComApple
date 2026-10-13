const { contextBridge, ipcRenderer } = require('electron/renderer')

contextBridge.exposeInMainWorld('electronAPI', {
  start: (pathFileMail, pathFileProxy, thread) => ipcRenderer.send('start', pathFileMail, pathFileProxy, thread),
  pause: () => ipcRenderer.send('pause'),
  result: (pathFileMail) => ipcRenderer.send('result', pathFileMail)
})

window.addEventListener('DOMContentLoaded', () => {
  function showThongBao(type, message, isTimeout) {
    document.getElementById('thongbao').innerText = message;
    document.getElementById('thongbao').className = `alert ${type}`;
    if (!isTimeout) {
      setTimeout(() => document.getElementById('thongbao').classList.add('hidden'), 3000);
    }
  }
  ipcRenderer.on('total', function (e, total) {
    document.getElementById(`total`).innerText = total;
  })
  ipcRenderer.on('reset-progress', function () {
    document.getElementById('changed-pass').innerText = '0';
    document.getElementById('login-ok').innerText = '0';
    document.getElementById('failed').innerText = '0';
    document.getElementById('total').innerText = '0';
    document.getElementById('time').innerText = '0s';
  })
  ipcRenderer.on('login-ok', function (e, step, pause) {
    let loginOkStep = parseInt(document.getElementById('login-ok').innerText) + step;
    let changedPassStep = parseInt(document.getElementById('changed-pass').innerText);
    let failedStep = parseInt(document.getElementById('failed').innerText);
    let totalStep = parseInt(document.getElementById(`total`).innerText);
    document.getElementById('login-ok').innerText = loginOkStep;
    if (pause && loginOkStep + changedPassStep + failedStep === totalStep) {
      document.getElementById('thongbao').classList.add('hidden')
      document.getElementById('start').disabled = false;
    }
  })
  ipcRenderer.on('changed-pass', function (e, step, pause) {
    let loginOkStep = parseInt(document.getElementById('login-ok').innerText);
    let changedPassStep = parseInt(document.getElementById('changed-pass').innerText) + step;
    let failedStep = parseInt(document.getElementById('failed').innerText);
    let totalStep = parseInt(document.getElementById(`total`).innerText);
    document.getElementById('changed-pass').innerText = changedPassStep;
    if (pause && loginOkStep + changedPassStep + failedStep === totalStep) {
      document.getElementById('thongbao').classList.add('hidden')
      document.getElementById('start').disabled = false;
    }
  })
  ipcRenderer.on('failed', function (e, step, pause) {
    let loginOkStep = parseInt(document.getElementById('login-ok').innerText);
    let changedPassStep = parseInt(document.getElementById('changed-pass').innerText);
    let failedStep = parseInt(document.getElementById('failed').innerText) + step;
    let totalStep = parseInt(document.getElementById(`total`).innerText);
    document.getElementById('failed').innerText = failedStep;
    if (pause && loginOkStep + changedPassStep + failedStep === totalStep) {
      document.getElementById('thongbao').classList.add('hidden')
      document.getElementById('start').disabled = false;
    }
  })
  ipcRenderer.on('disable', function (e, isDisable) {
    document.getElementById('start').disabled = isDisable;
  })
  ipcRenderer.on('result', function (e, isSuccess) {
    if (isSuccess) {
      showThongBao('alert-success', 'Xuất kết quả thành công')
    }
    else {
      showThongBao('alert-danger', 'Xuất kết quả thất bại')
    }
  })
  ipcRenderer.on('time', function (e, time) {
    let h, m, s
    if (time / 3600 >= 1) {
      h = Math.floor(time / 3600);
      s = time % 3600;
      m = 0;
      if (s / 60 >= 1) {
        m = Math.floor(s / 60);
        s = s % 60;
      }
      document.getElementById(`time`).innerText = `${h}h${m}m${s}s`
    } else if (time / 60 >= 1) {
      m = Math.floor(time / 60)
      s = time % 60
      document.getElementById(`time`).innerText = `0h${m}m${s}s`
    } else {
      document.getElementById(`time`).innerText = `0h0m${time}s`
    }
  })
  ipcRenderer.on('done', function (e, isDone) {
    if (isDone) {
      showThongBao('alert-success', 'Đã chạy hết file data')
    }
  })
  ipcRenderer.on('checkfiles', function (e, filename) {
    showThongBao('alert-danger', `Đường dẫn file không hợp lệ: ${filename}`)
  })
  ipcRenderer.on('info', function (e, info, noTimeout) {
    showThongBao('alert-info', info, noTimeout)
  })
  ipcRenderer.on('loi', function (e, err) {
    showThongBao('alert-danger', err)
  })
})
