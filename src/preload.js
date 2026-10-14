const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mailcomAPI', {
  config: () => ipcRenderer.invoke('app:config'),
  choose: kind => ipcRenderer.invoke('file:choose', kind),
  start: options => ipcRenderer.invoke('batch:start', options),
  pause: () => ipcRenderer.invoke('batch:pause'),
  resume: () => ipcRenderer.invoke('batch:resume'),
  openResults: () => ipcRenderer.invoke('results:open'),
  exportResults: () => ipcRenderer.invoke('results:export'),
  onUpdate: callback => {
    const listener = (_event, update) => callback(update);
    ipcRenderer.on('batch:update', listener);
    return () => ipcRenderer.removeListener('batch:update', listener);
  },
});
