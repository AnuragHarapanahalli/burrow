// Bridge for the toast view (system messages at the bottom left). Exposes window.burrowToast only.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('burrowToast', {
  onToasts: (cb) => ipcRenderer.on('toasts', (_e, list) => cb(list)),
  onTheme: (cb) => ipcRenderer.on('theme', (_e, payload) => cb(payload)),
  size: (width, height) => ipcRenderer.send('toast:size', width, height),
  act: (id) => ipcRenderer.send('toast:act', id),
  dismiss: (id) => ipcRenderer.send('toast:dismiss', id),
  hover: (on) => ipcRenderer.send('toast:hover', !!on),
});
