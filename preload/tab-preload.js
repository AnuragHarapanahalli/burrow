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
    // New tab: the one stat line. Weekly report page: its numbers.
    statLine: () => ipcRenderer.invoke('page:statline'),
    report: (offset) => ipcRenderer.invoke('page:report', Number(offset) || 0),
    reportAction: (action) => ipcRenderer.send('page:report-action', String(action || '')),
    // Welcome tour only (the main process ignores these from any other page).
    // The Burrow gate only (the main process ignores these from any other page).
    gateInfo: () => ipcRenderer.invoke('page:gate-info'),
    gateStart: () => ipcRenderer.invoke('page:gate-start'),
    gateUnlock: () => ipcRenderer.invoke('page:gate-unlock'),
    gateAction: (action, value) => ipcRenderer.send('page:gate-action', String(action || ''), String(value || '')),
    welcome: (action, value) => ipcRenderer.send('page:welcome', String(action || ''), String(value || '')),
    importSources: () => ipcRenderer.invoke('page:import-sources'),
    importRun: (id, want) => ipcRenderer.invoke('page:import-run', String(id || ''), { bookmarks: want?.bookmarks !== false, history: want?.history !== false }),
    importQuickLinks: (sites) => ipcRenderer.invoke('page:import-quicklinks', Array.isArray(sites) ? sites.slice(0, 8).map((x) => ({ name: String(x?.name || ''), url: String(x?.url || '') })) : []),
    setQuickLinks: (links) => ipcRenderer.send('page:quick-links', links),
    reportBug: (report) => ipcRenderer.send('page:report-bug', {
      title: String(report?.title || ''), what: String(report?.what || ''),
      steps: String(report?.steps || ''), includeSystem: !!report?.includeSystem,
    }),
  });
}

// Every web page: if you start typing in a password box on a page without HTTPS, tell Burrow so Mochi
// can warn you. The page learns nothing and gets no access to Burrow.
if (location.protocol === 'http:') {
  let told = false;
  window.addEventListener('focusin', (e) => {
    const el = e.target;
    if (told || !el || el.tagName !== 'INPUT' || String(el.type).toLowerCase() !== 'password') return;
    told = true;
    ipcRenderer.send('page:insecure-password');
  }, true);
}
