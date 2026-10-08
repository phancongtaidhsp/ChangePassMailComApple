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
  ipcRenderer.on('invalid', function (e, step, pause) {
    let invalidStep = parseInt(document.getElementById(`invalid`).innerText) + step;
    let validStep = parseInt(document.getElementById(`valid`).innerText);
    let uncheckedStep = parseInt(document.getElementById(`unchecked`).innerText);
    let totalStep = parseInt(document.getElementById(`total`).innerText);
    document.getElementById(`invalid`).innerText = invalidStep;
    if (pause && invalidStep + validStep + uncheckedStep === totalStep) {
      document.getElementById('thongbao').classList.add('hidden')
      document.getElementById('start').disabled = false;
    }
  })
  ipcRenderer.on('valid', function (e, step, pause) {
    let invalidStep = parseInt(document.getElementById(`invalid`).innerText);
    let validStep = parseInt(document.getElementById(`valid`).innerText) + step;
    let uncheckedStep = parseInt(document.getElementById(`unchecked`).innerText);
    let totalStep = parseInt(document.getElementById(`total`).innerText);
    document.getElementById(`valid`).innerText = validStep;
    if (pause && invalidStep + validStep + uncheckedStep === totalStep) {
      document.getElementById('thongbao').classList.add('hidden')
      document.getElementById('start').disabled = false;
    }
  })
  ipcRenderer.on('unchecked', function (e, step, pause) {
    let invalidStep = parseInt(document.getElementById(`invalid`).innerText);
    let validStep = parseInt(document.getElementById(`valid`).innerText);
    let uncheckedStep = parseInt(document.getElementById(`unchecked`).innerText) + step;
    let totalStep = parseInt(document.getElementById(`total`).innerText);
    document.getElementById(`unchecked`).innerText = uncheckedStep;
    if (pause && invalidStep + validStep + uncheckedStep === totalStep) {
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
    let failStep = parseInt(document.getElementById(`die`).innerText);
    let successStep = parseInt(document.getElementById(`live`).innerText);
    let totalStep = parseInt(document.getElementById(`total`).innerText);
    if (pause && failStep + successStep === totalStep) {
      document.getElementById('thongbao').classList.add('hidden')
    } else {
      document.getElementById('start').disabled = isDisable;
    }
  })
  ipcRenderer.on('loi', function (e, err) {
    showThongBao('alert-danger', err)
  })
})
