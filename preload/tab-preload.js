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
    mochiInfo: () => ipcRenderer.invoke('page:mochi-info'),
    mochiAction: (action) => ipcRenderer.send('page:mochi', String(action || '')),
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
    // The offline page (burrow://offline only)
    offlineInfo: () => ipcRenderer.invoke('page:offline-info'),
    offlineRetry: (go) => ipcRenderer.invoke('page:offline-retry', !!go),
    hopScore: (score, collected) => ipcRenderer.invoke('page:hop-score', Number(score) || 0, Number(collected) || 0),
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

// Google sign-in (see main/signin.js), set up before the page's own scripts run:
//  • on every web page, fill in the window.chrome pieces real Chrome has (app, csi, loadTimes);
//  • on Google's sign-in pages, the page sees the same user agent its requests send.
if (/^https?:$/.test(location.protocol)) {
  try {
    const id = ipcRenderer.sendSync('signin:identity');
    if (id && (id.chromePieces || id.ua)) {
      contextBridge.executeInMainWorld({
        args: [!!id.chromePieces, id.ua || ''],
        func: (pieces, ua) => {
          if (ua) {
            const appVersion = ua.replace(/^Mozilla\//, '');
            Object.defineProperty(Navigator.prototype, 'userAgent', { get: () => ua, configurable: true, enumerable: true });
            Object.defineProperty(Navigator.prototype, 'appVersion', { get: () => appVersion, configurable: true, enumerable: true });
          }
          if (!pieces) return;
          if (!window.chrome) Object.defineProperty(window, 'chrome', { value: {}, writable: true, configurable: true });
          const c = window.chrome;
          const nav = () => performance.getEntriesByType('navigation')[0] || {};
          const sec = (ms) => (performance.timeOrigin + (ms || 0)) / 1000;
          if (!c.app) {
            c.app = {
              isInstalled: false,
              InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
              RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
              getDetails: () => null,
              getIsInstalled: () => false,
              installState: (cb) => { if (typeof cb === 'function') cb('not_installed'); },
              runningState: () => 'cannot_run',
            };
          }
          if (!c.csi) {
            c.csi = () => ({ startE: Math.round(performance.timeOrigin), onloadT: Math.round(performance.timeOrigin + (nav().domContentLoadedEventEnd || 0)), pageT: performance.now(), tran: 15 });
          }
          if (!c.loadTimes) {
            c.loadTimes = () => {
              const n = nav();
              const paint = performance.getEntriesByName('first-paint')[0];
              const proto = n.nextHopProtocol || 'http/1.1';
              return {
                requestTime: sec(n.requestStart), startLoadTime: sec(n.startTime), commitLoadTime: sec(n.responseStart),
                finishDocumentLoadTime: sec(n.domContentLoadedEventEnd), finishLoadTime: sec(n.loadEventEnd),
                firstPaintTime: paint ? sec(paint.startTime) : 0, firstPaintAfterLoadTime: 0, navigationType: 'Other',
                wasFetchedViaSpdy: /^h[23]/.test(proto), wasNpnNegotiated: /^h[23]/.test(proto), npnNegotiatedProtocol: /^h[23]/.test(proto) ? proto : 'unknown',
                wasAlternateProtocolAvailable: false, connectionInfo: proto,
              };
            };
          }
        },
      });
    }
  } catch { /* the page still works, just without these */ }
}
