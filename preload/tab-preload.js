// Runs in every tab. Websites get nothing from it.
// Only Burrow's own pages (burrow://...) get a tiny read-only theme bridge.
const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'burrow:') {
  contextBridge.exposeInMainWorld('burrowPage', {
    getTheme: () => ipcRenderer.invoke('page:theme'),
    onTheme: (cb) => ipcRenderer.on('theme', (_e, data) => cb(data)),
    navigate: (text) => ipcRenderer.send('page:navigate', String(text || '')),
    setSearchEngine: (id) => ipcRenderer.send('page:search-engine', String(id || '')),
    setQuickLinks: (links) => ipcRenderer.send('page:quick-links', links),
  });
}
