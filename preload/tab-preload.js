// Runs in every tab. Websites get nothing from it.
// Only Burrow's own pages (burrow://...) get a tiny read-only theme bridge.
const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'burrow:') {
  contextBridge.exposeInMainWorld('burrowPage', {
    getTheme: () => ipcRenderer.invoke('page:theme'),
    onTheme: (cb) => ipcRenderer.on('theme', (_e, data) => cb(data)),
    navigate: (text) => ipcRenderer.send('page:navigate', String(text || '')),
    setSearchEngine: (id) => ipcRenderer.send('page:search-engine', String(id || '')),
    ask: (text) => ipcRenderer.send('page:ask', String(text || '')),
    readerArticle: (key) => ipcRenderer.invoke('page:reader', String(key || '')),
    // Welcome tour only (the main process ignores these from any other page).
    // The Burrow gate only (the main process ignores these from any other page).
    gateInfo: () => ipcRenderer.invoke('page:gate-info'),
    gateStart: () => ipcRenderer.invoke('page:gate-start'),
    gateUnlock: () => ipcRenderer.invoke('page:gate-unlock'),
    gateAction: (action, value) => ipcRenderer.send('page:gate-action', String(action || ''), String(value || '')),
    welcome: (action, value) => ipcRenderer.send('page:welcome', String(action || ''), String(value || '')),
    setQuickLinks: (links) => ipcRenderer.send('page:quick-links', links),
    reportBug: (report) => ipcRenderer.send('page:report-bug', {
      title: String(report?.title || ''), what: String(report?.what || ''),
      steps: String(report?.steps || ''), includeSystem: !!report?.includeSystem,
    }),
  });
}
