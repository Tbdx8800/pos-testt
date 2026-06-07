const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  printSilent: (html, options = {}) => ipcRenderer.invoke('print-silent', { html, options })
});
