// Burrow main process: the "brain". Starts the app, keeps settings, history, bookmarks and
// downloads, and routes messages from each window's interface to that window (main/window.js).
const path = require('path');
const { pathToFileURL } = require('url');
const { app, ipcMain, protocol, net, nativeTheme, systemPreferences, session } = require('electron');
const Theme = require('../shared/theme');
const { Store } = require('./store');
const { Library } = require('./library');
const { Downloads } = require('./downloads');
const { BurrowWindow } = require('./window');
const { Tabs } = require('./tabs');
const { NEWTAB, ENGINES } = require('./url');

const ROOT = path.join(__dirname, '..');

// burrow:// is Burrow's own address space (new tab, later settings, reader, report...).
protocol.registerSchemesAsPrivileged([
  { scheme: 'burrow', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

// Remove "Electron/xx" from the user agent so websites treat Burrow like Chrome.
app.userAgentFallback = app.userAgentFallback.replace(/\s(Electron|burrow)\/\S+/gi, '');

// Developer self-test uses a throwaway profile so it never touches your real settings.
const SELFTEST = process.env.BURROW_SELFTEST;
if (SELFTEST) {
  app.setPath('userData', path.join(SELFTEST, 'profile'));
  app.setPath('downloads', path.join(SELFTEST, 'downloads'));
  require('fs').mkdirSync(path.join(SELFTEST, 'downloads'), { recursive: true });
}

let store, library, downloads;
const windows = new Set();
let mainWin = null;          // the first normal window (used by the self-test)
const sessions = new Map();  // normal window -> its saved tabs, in the order windows were opened
const normalWindows = () => [...windows].filter((w) => !w.isPrivate);

// ---------------- burrow:// pages ----------------
function servePath(url) {
  const u = new URL(url);
  const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
  let base, file;
  if (u.host === 'newtab') {
    base = path.join(ROOT, 'ui', 'pages', 'newtab');
    file = path.join(base, rel || 'newtab.html');
  } else if (u.host === 'app') {
    base = ROOT;
    file = path.join(base, rel);
    const allowed = ['ui', 'shared', path.join('node_modules', '@fontsource')].map((d) => path.join(ROOT, d) + path.sep);
    if (!allowed.some((d) => file.startsWith(d))) return null;
  } else return null;
  file = path.normalize(file);
  return file.startsWith(base) ? file : null; // block ../ tricks
}

async function serveBurrow(req) {
  const file = servePath(req.url);
  if (!file) return new Response('Not found', { status: 404 });
  const res = await net.fetch(pathToFileURL(file).toString());
  // Let Burrow's own pages share fonts/scripts across burrow:// hosts (fonts need CORS).
  const origin = req.headers.get('origin') || '';
  const headers = new Headers(res.headers);
  if (origin.startsWith('burrow://')) headers.set('Access-Control-Allow-Origin', origin);
  return new Response(res.body, { status: res.status, headers });
}

// Every browsing session (normal and each private one) gets burrow:// pages and safe permissions.
function setupSession(ses) {
  if (ses !== session.defaultSession) ses.protocol.handle('burrow', serveBurrow);
  // Electron allows every permission by default; a browser must not.
  // Safe ones are allowed; the rest are denied until Burrow has a permission prompt.
  const SAFE = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock']);
  ses.setPermissionRequestHandler((_wc, perm, cb) => cb(SAFE.has(perm)));
  ses.setPermissionCheckHandler((_wc, perm) => SAFE.has(perm));
}

// ---------------- Theme + preferences ----------------
function themePayload(isPrivate = false) {
  const settings = store.get('theme');
  let seed = settings.seed;
  if (settings.useWindowsAccent && process.platform === 'win32') {
    try { seed = '#' + systemPreferences.getAccentColor().slice(0, 6); } catch { /* keep seed */ }
  }
  // Also tells websites (prefers-color-scheme) which mode you chose.
  const source = ['light', 'dark'].includes(settings.mode) ? settings.mode : 'system';
  if (nativeTheme.themeSource !== source) nativeTheme.themeSource = source;
  // Private windows are always dark, so you can tell them apart at a glance.
  const tokens = Theme.build(seed, isPrivate || nativeTheme.shouldUseDarkColors);
  const prefs = {
    searchEngine: store.get('searchEngine'),
    searchChosen: store.get('searchChosen'),
    bookmarksBar: store.get('bookmarksBar'),
    tabsMode: store.get('tabsMode'),
    quickLinks: store.get('quickLinks'),
    engines: Object.entries(ENGINES).map(([id, e]) => ({ id, name: e.name, host: new URL(e.url).host.replace(/^www\./, '') })),
  };
  return { settings, tokens, presets: Theme.PRESETS, prefs, isPrivate };
}

const everyWindow = (fn) => windows.forEach((w) => fn(w));
function broadcastTheme() { everyWindow((w) => w.applyTheme()); }

function setTheme(patch) {
  const next = { ...store.get('theme') };
  if (typeof patch?.seed === 'string') next.seed = Theme.normaliseHex(patch.seed);
  if (['light', 'dark', 'system'].includes(patch?.mode)) next.mode = patch.mode;
  if (typeof patch?.useWindowsAccent === 'boolean') next.useWindowsAccent = patch.useWindowsAccent;
  if (typeof patch?.grid === 'boolean') next.grid = patch.grid;
  store.set('theme', next);
  broadcastTheme();
}

// Validate and save general preferences (search engine, bookmarks bar, tab position).
function setPrefs(patch) {
  if (patch && Object.hasOwn(ENGINES, patch.searchEngine)) { store.set('searchEngine', patch.searchEngine); store.set('searchChosen', true); }
  if (typeof patch?.bookmarksBar === 'boolean') store.set('bookmarksBar', patch.bookmarksBar);
  if (['auto', 'top', 'side'].includes(patch?.tabsMode)) store.set('tabsMode', patch.tabsMode);
  broadcastTheme();
  everyWindow((w) => w.sendTabs());
}

// ---------------- Windows ----------------
// Every open normal window is saved, so they all come back after a restart.
function saveSessions() {
  store.set('session', { windows: [...sessions.values()] });
}

const ctx = {
  get store() { return store; },
  get library() { return library; },
  get mainDownloads() { return downloads; },
  themePayload, setPrefs, setupSession,
  openPrivate: () => openWindow({ isPrivate: true }),
  openWindow: () => openWindow(),
  saveSession: (w, snap) => { if (!windows.has(w)) return; sessions.set(w, snap); saveSessions(); },
  onClosed: (w) => {
    windows.delete(w);
    if (w.isPrivate) return;
    if (w === mainWin) mainWin = normalWindows()[0] || null;
    if (normalWindows().length) {
      // You closed one of several windows: forget its tabs (like Chrome).
      sessions.delete(w);
      saveSessions();
    } else {
      // Last normal window: keep its tabs for next time, and close any private windows.
      everyWindow((x) => x.win.close());
    }
  },
};

function openWindow(opts = {}) {
  const w = new BurrowWindow(ctx, opts);
  windows.add(w);
  if (!opts.isPrivate && !mainWin) mainWin = w;
  return w;
}

// Read saved windows (also understands the older one-window formats).
function savedWindows() {
  let s = store.get('session');
  if (s && Array.isArray(s.tabs)) s = { current: 1, workspaces: [{ id: 1, name: 'Home', tabs: s.tabs, active: s.active }] };
  if (s && Array.isArray(s.workspaces)) s = { windows: [s] };
  return Array.isArray(s?.windows) ? s.windows.filter((w) => w && Array.isArray(w.workspaces)) : [];
}

// Is a screen point over a window's tab strip / toolbar? (dropping a dragged tab there)
function overChrome(w, x, y) {
  if (w.win.isDestroyed() || w.win.isMinimized()) return false;
  const b = w.win.getContentBounds();
  return x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + w.layout.top;
}

const winOfUi = (wc) => [...windows].find((w) => w.ui.webContents === wc);
const winOfPage = (wc) => [...windows].find((w) => w.ownsPage(wc));
const isBurrowPage = (wc) => wc.getURL().startsWith('burrow://');

// ---------------- Messages from each window's interface ----------------
function registerIpc() {
  // Only Burrow's own interface may send these; each goes to the window it came from.
  const on = (ch, fn) => ipcMain.on(ch, (e, ...a) => { const w = winOfUi(e.sender); if (w) fn(w, ...a); });
  const handle = (ch, fn) => ipcMain.handle(ch, (e, ...a) => { const w = winOfUi(e.sender); return w ? fn(w, ...a) : null; });

  on('ui:ready', (w) => { w.sendTabs(); w.applyTheme(); w.sendBookmarks(); w.send('downloads', w.downloads.state()); });
  on('ui:layout', (w, l) => w.setLayout(l));
  on('ui:overlay', (w, open) => w.setOverlay(open));
  on('prefs:set', (_w, patch) => setPrefs(patch));
  on('theme:set', (_w, patch) => setTheme(patch));
  on('window:private', () => ctx.openPrivate());
  on('window:new', () => openWindow());

  on('tab:new', (w) => w.tabs.create(NEWTAB));
  on('tab:close', (w, id) => w.tabs.close(Number(id)));
  on('tab:activate', (w, id) => w.tabs.activate(Number(id)));
  on('tab:navigate', (w, text) => w.tabs.navigate(String(text || '')));
  on('tab:reopen', (w) => w.tabs.reopenClosed());
  on('tab:move', (w, id, to) => w.tabs.move(Number(id), Number(to)));
  // A tab dragged out of the strip: drop it on another window's tabs, or open it in a new window.
  on('tab:detach', (w, id, sx, sy) => {
    if (w.isPrivate) return; // private tabs stay in their private window
    const x = Math.round(Number(sx) || 0), y = Math.round(Number(sy) || 0);
    const target = normalWindows().find((o) => o !== w && overChrome(o, x, y));
    const tab = w.tabs.detach(Number(id));
    if (!tab) return;
    if (target) { target.tabs.adopt(tab); target.win.focus(); return; }
    const b = w.win.getBounds();
    openWindow({ adoptTab: tab, bounds: { x: x - 160, y: y - 20, width: b.width, height: b.height } });
  });
  on('tab:mute', (w, id) => w.tabs.toggleMute(Number(id)));
  handle('tab:pip', (w) => w.pip());
  on('nav:back', (w) => w.tabs.back());
  on('nav:forward', (w) => w.tabs.forward());
  on('nav:reload', (w) => w.tabs.reload());
  on('nav:stop', (w) => w.tabs.stop());
  on('zoom:step', (w, dir) => w.tabs.stepZoom(Math.sign(Number(dir) || 0)));
  on('find:query', (w, q) => w.find(q));
  on('find:stop', (w) => w.stopFind());

  on('ws:new', (w, name) => { if (!w.isPrivate) { w.tabs.createWorkspace(String(name || '')); broadcastTheme(); } });
  on('ws:rename', (w, id, name) => { w.tabs.renameWorkspace(Number(id), String(name || '')); broadcastTheme(); });
  on('ws:switch', (w, id) => w.tabs.switchWorkspace(Number(id)));
  on('ws:delete', (w, id) => {
    if (w.isPrivate) return;
    w.tabs.deleteWorkspace(Number(id));
    // Links that only belonged to that workspace go with it.
    const links = store.get('quickLinks') || [];
    if (links.some((l) => l.ws === Number(id))) { store.set('quickLinks', links.filter((l) => l.ws !== Number(id))); broadcastTheme(); }
  });

  on('bookmark:toggle', (w) => w.toggleBookmark());
  on('bookmark:remove', (_w, id) => library.removeBookmark(Number(id)));
  on('history:remove', (_w, url) => library.removeHistory(String(url || '')));
  on('history:clear', () => library.clearHistory());
  on('open:url', (w, url, newTab) => {
    const u = String(url || '');
    if (!/^https?:\/\//i.test(u)) return;
    if (newTab) w.tabs.create(u); else w.tabs.navigate(u);
  });
  handle('lib:bookmarks', (_w, q) => library.searchBookmarks(String(q || '')));
  handle('lib:history', (_w, q) => library.searchHistory(String(q || '')));
  handle('lib:suggest', (_w, q) => library.suggest(String(q || '')));

  on('dl:open', (w, id) => w.downloads.open(id));
  on('dl:show', (w, id) => w.downloads.show(id));
  on('dl:cancel', (w, id) => w.downloads.cancel(id));
  on('dl:pause', (w, id) => w.downloads.pause(id));
  on('dl:clear', (w) => w.downloads.clear());

  // ---- Burrow's own pages (new tab). Websites never get this bridge. ----
  ipcMain.handle('page:theme', (e) => {
    const w = isBurrowPage(e.sender) && winOfPage(e.sender);
    return w ? w.pagePayload(e.sender) : null;
  });
  // Quick links: web addresses only; a link is global or belongs to one existing workspace.
  ipcMain.on('page:quick-links', (e, links) => {
    const w = isBurrowPage(e.sender) && winOfPage(e.sender);
    if (!w || !Array.isArray(links)) return;
    const wsIds = new Set(normalWindows().flatMap((x) => x.tabs.workspaces.map((ws) => ws.id)));
    const clean = links.slice(0, 64).map((l) => {
      const name = String(l?.name || '').replace(/\s+/g, ' ').trim().slice(0, 24);
      const ws = wsIds.has(Number(l?.ws)) ? Number(l.ws) : undefined;
      try {
        const u = new URL(String(l?.url || ''));
        if (!/^https?:$/.test(u.protocol)) return null;
        const link = { name: name || u.host.replace(/^www\./, ''), url: u.href };
        if (ws) link.ws = ws;
        return link;
      } catch { return null; }
    }).filter(Boolean);
    store.set('quickLinks', clean);
    broadcastTheme();
  });
  ipcMain.on('page:search-engine', (e, id) => {
    if (isBurrowPage(e.sender) && winOfPage(e.sender)) setPrefs({ searchEngine: String(id || '') });
  });
  ipcMain.on('page:navigate', (e, text) => {
    const w = isBurrowPage(e.sender) && winOfPage(e.sender);
    if (w) w.tabs.navigateFrom(e.sender, String(text || ''));
  });
}

// ---------------- App lifecycle ----------------
// Only one Burrow at a time (two copies would fight over the saved-state file).
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => {
  const w = normalWindows().pop();
  if (!w) return openWindow();
  if (w.win.isMinimized()) w.win.restore();
  w.win.focus();
  w.tabs.create(NEWTAB);
});

app.whenReady().then(() => {
  store = new Store();
  // Until you pick a search engine, use Google (earlier versions defaulted to DuckDuckGo).
  if (!store.get('searchChosen')) store.set('searchEngine', 'google');
  library = new Library({
    onChange: (what) => everyWindow((w) => {
      if (what === 'bookmarks') { w.sendTabs(); w.sendBookmarks(); }
      w.send('library-changed', what);
    }),
  });
  // Normal windows share one session, so they share one downloads list.
  downloads = new Downloads({
    session: session.defaultSession,
    onChange: (list) => normalWindows().forEach((w) => w.send('downloads', list)),
    onDone: (d) => normalWindows().forEach((w) => w.send('download-done', d)),
  });
  protocol.handle('burrow', serveBurrow);
  setupSession(session.defaultSession);
  registerIpc();
  nativeTheme.on('updated', broadcastTheme);
  systemPreferences.on?.('accent-color-changed', broadcastTheme);
  // Bring back every window that was open last time (or one fresh window).
  const saved = savedWindows();
  Tabs.reserveWsIds(saved.flatMap((w) => w.workspaces.map((ws) => ws.id)));
  if (saved.length) saved.forEach((snapshot) => openWindow({ snapshot }));
  else openWindow();
  if (SELFTEST) {
    require('./selftest').run({
      app, ui: mainWin.ui, tabs: mainWin.tabs, library, downloads, setTheme, setPrefs, store, dir: SELFTEST,
      mainWin, openWindow, windows, session,
    });
  }
});

function flushAll() { store?.flush(); library?.flush(); downloads?.flush(); }
app.on('before-quit', flushAll);
app.on('window-all-closed', () => { flushAll(); app.quit(); });
