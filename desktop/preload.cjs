const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  quit: () => ipcRenderer.invoke('quit-game'),
});
