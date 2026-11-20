// Burrow main process: the "brain". Starts the app, keeps settings, history, bookmarks and
// downloads, and routes messages from each window's interface to that window (main/window.js).
const path = require('path');
const { pathToFileURL } = require('url');
const { app, ipcMain, protocol, net, nativeTheme, systemPreferences, session, dialog, clipboard, shell, webContents: WebContents } = require('electron');
const Theme = require('../shared/theme');
const { Store } = require('./store');
const { Library } = require('./library');
const { Downloads } = require('./downloads');
const { Notes } = require('./notes');
const { Focus, pretty: sitePretty } = require('./focus');
const { Stats } = require('./stats');
const { Importer, topSites } = require('./importer');
const { Care } = require('./care');
const { Fun, NIGHT_SEED } = require('./fun');
const { Permissions } = require('./permissions');
const { Updates } = require('./updates');
const SignIn = require('./signin');
const Changelog = require('../shared/changelog');
const Reader = require('./reader');
const { BurrowWindow } = require('./window');
const { Tabs } = require('./tabs');
const { NEWTAB, ENGINES } = require('./url');
const AI = require('../shared/ai');

const ROOT = path.join(__dirname, '..');
const PKG = require('../package.json');

// Bug reports open GitHub's "New issue" page, already filled in. The reporter submits it there.
function bugReportUrl({ title, what, steps, includeSystem }) {
  const base = String(PKG.bugs?.url || '');
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues$/.test(base)) return null;
  const clip = (t, n) => String(t || '').trim().slice(0, n);
  const body = [
    '**What happened**', clip(what, 3000) || '_(not filled in)_', '',
    '**Steps to reproduce**', clip(steps, 1500) || '_(not filled in)_', '',
  ];
  if (includeSystem) {
    body.push('---', `Burrow v${app.getVersion()} · ${process.platform} ${require('os').release()} · Electron ${process.versions.electron} · Chromium ${process.versions.chrome}`);
  }
  const q = new URLSearchParams({ title: clip(title, 120), body: body.join('\n'), labels: 'bug' });
  return `${base}/new?${q}`;
}

// burrow:// is Burrow's own address space (new tab, later settings, reader, report...).
protocol.registerSchemesAsPrivileged([
  { scheme: 'burrow', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

// Remove "Electron/xx" from the user agent so websites treat Burrow like Chrome.
app.userAgentFallback = app.userAgentFallback.replace(/\s(Electron|burrow)\/\S+/gi, '');

// Developer self-test uses a throwaway profile so it never touches your real settings.
const SELFTEST = process.env.BURROW_SELFTEST;
if (SELFTEST) {
  // Always start from a clean slate: a profile left over from an earlier run would make the
  // "first launch" checks fail (search engine already chosen, tour already seen, …).
  for (const d of ['profile', 'downloads']) require('fs').rmSync(path.join(SELFTEST, d), { recursive: true, force: true });
  app.setPath('userData', path.join(SELFTEST, 'profile'));
  app.setPath('downloads', path.join(SELFTEST, 'downloads'));
  require('fs').mkdirSync(path.join(SELFTEST, 'downloads'), { recursive: true });
  // Keep running at full speed even when the test window is behind other windows (you may be
  // using the computer meanwhile): no paused paints, no slowed-down timers.
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-background-timer-throttling');
}

let store, library, downloads, notes, focus, stats, care, fun, perms, updates;
const windows = new Set();
let mainWin = null;          // the first normal window (used by the self-test)
const sessions = new Map();  // normal window -> its saved tabs, in the order windows were opened
const normalWindows = () => [...windows].filter((w) => !w.isPrivate);

// ---------------- burrow:// pages ----------------
function servePath(url) {
  const u = new URL(url);
  const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
  let base, file;
  if (['newtab', 'reader', 'welcome', 'gate', 'report', 'offline'].includes(u.host)) {
    base = path.join(ROOT, 'ui', 'pages', u.host);
    file = path.join(base, rel || `${u.host}.html`);
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
  const isPrivate = ses !== session.defaultSession;
  if (isPrivate) ses.protocol.handle('burrow', serveBurrow);
  // Electron allows every permission by default; a browser must not. Camera, microphone, location and
  // notifications are asked for (and remembered per site, except in private windows); see permissions.js.
  perms.attach(ses, { isPrivate });
  SignIn.attach(ses); // Google sign-in works (see signin.js)
}

// ---------------- Links opened from other apps (Burrow as your default browser) ----------------
// Windows starts Burrow (or pokes the running one) with the address as an argument.
function linkFromArgs(argv) {
  for (const a of (argv || []).slice(1)) {
    if (/^https?:\/\//i.test(a)) return a;
    if (/\.(html?|xhtml|pdf)$/i.test(a) && !a.startsWith('-')) {
      try { if (require('fs').existsSync(a)) return pathToFileURL(a).toString(); } catch { /* not a file */ }
    }
  }
  return null;
}

// ---------------- Clear browsing data ----------------
const RANGES = { hour: 3600e3, day: 864e5, week: 7 * 864e5, all: Infinity };
async function clearData(range, what) {
  const since = RANGES[range] === Infinity || !RANGES[range] ? 0 : Date.now() - RANGES[range];
  const done = {};
  if (what.history) done.history = library.clearHistorySince(since);
  if (what.downloads) done.downloads = downloads.clearSince(since);
  // Cookies, site storage and the cache can't be cleared by date in Electron, so these go entirely.
  if (what.cookies) {
    await session.defaultSession.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'websql', 'serviceworkers', 'cachestorage', 'filesystem', 'shadercache'] });
    done.cookies = true;
  }
  if (what.cache) { await session.defaultSession.clearCache(); done.cache = true; }
  return done;
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
  // Night mode (bedtime): a warm, dim Burrow until morning. Your own theme is untouched.
  const night = !isPrivate && !!store.get('nightMode');
  // Look: Soft paper (default) or Classic. Saved settings from before 0.3.0 have no look → Soft paper.
  const look = settings.look === 'classic' ? 'classic' : 'soft';
  const tokens = night ? Theme.build(NIGHT_SEED, true, look) : Theme.build(seed, isPrivate || nativeTheme.shouldUseDarkColors, look);
  tokens.density = settings.density === 'compact' ? 'compact' : 'comfortable';
  const prefs = {
    searchEngine: store.get('searchEngine'),
    searchChosen: store.get('searchChosen'),
    bookmarksBar: store.get('bookmarksBar'),
    tabsMode: store.get('tabsMode'),
    quickLinks: store.get('quickLinks'),
    aiProvider: store.get('aiProvider'),
    askMode: store.get('askMode'),
    aiProviders: AI.list(),
    sleep: store.get('sleep'),
    mochiMode: store.get('mochiMode'),
    eyeBreaks: Number(store.get('eyeBreaks')) || 0,
    outfit: store.get('outfit') || null,
    carrots: store.get('carrots') || 0,
    bedtime: store.get('bedtime') || '',
    nightTint: store.get('nightTint') !== false,
    nightMode: night,
    reportOn: store.get('reportOn') !== false,
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
  if (['soft', 'classic'].includes(patch?.look)) next.look = patch.look;
  if (['comfortable', 'compact'].includes(patch?.density)) next.density = patch.density;
  store.set('theme', next);
  broadcastTheme();
}

// Validate and save general preferences (search engine, bookmarks bar, tab position).
function setPrefs(patch) {
  if (patch && Object.hasOwn(ENGINES, patch.searchEngine)) { store.set('searchEngine', patch.searchEngine); store.set('searchChosen', true); }
  if (typeof patch?.bookmarksBar === 'boolean') store.set('bookmarksBar', patch.bookmarksBar);
  if (['auto', 'top', 'side'].includes(patch?.tabsMode)) store.set('tabsMode', patch.tabsMode);
  if (patch && Object.hasOwn(AI.PROVIDERS, patch.aiProvider)) store.set('aiProvider', patch.aiProvider);
  if (['smart', 'search', 'ai'].includes(patch?.askMode)) store.set('askMode', patch.askMode);
  if (patch?.aiProvider) everyWindow((w) => w.onAIProviderChange?.());
  if (['lively', 'quiet', 'off'].includes(patch?.mochiMode)) store.set('mochiMode', patch.mochiMode);
  if (typeof patch?.reportOn === 'boolean') store.set('reportOn', patch.reportOn);
  if ([0, 20, 30, 45].includes(patch?.eyeBreaks)) store.set('eyeBreaks', patch.eyeBreaks);
  if (typeof patch?.bedtime === 'string' && (patch.bedtime === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(patch.bedtime))) store.set('bedtime', patch.bedtime);
  if (typeof patch?.nightTint === 'boolean') { store.set('nightTint', patch.nightTint); setNight(!!store.get('nightMode')); }
  if (patch?.sleep && typeof patch.sleep === 'object') {
    const cur = { ...store.get('sleep') };
    if (typeof patch.sleep.on === 'boolean') cur.on = patch.sleep.on;
    if ([15, 30, 60, 120].includes(Number(patch.sleep.minutes))) cur.minutes = Number(patch.sleep.minutes);
    const host = String(patch.sleep.never || patch.sleep.allow || '');
    if (/^[a-z0-9.-]+(:\d+)?$/i.test(host) && host.length < 256) {
      const never = new Set(cur.never || []);
      if (patch.sleep.never) never.add(host); else never.delete(host);
      cur.never = [...never].slice(0, 200);
    }
    store.set('sleep', cur);
  }
  broadcastTheme();
  everyWindow((w) => w.sendTabs());
}

// ---------------- Tab sleeping ----------------
// Once a minute, tabs you haven't looked at for a while are unloaded (they stay in the tab strip).
// `force` puts every eligible tab to sleep right now (Ctrl+K → "Put other tabs to sleep now").
function sweepSleep(onlyWin, force = false) {
  const cfg = store.get('sleep');
  if (!cfg.on && !force) return [];
  const idle = force ? 0 : cfg.minutes * 60000;
  // Measure memory first, so we can say roughly how much sleeping freed.
  const memBefore = new Map(app.getAppMetrics().map((m) => [m.pid, m.memory?.workingSetSize || 0]));
  const results = [];
  for (const w of onlyWin ? [onlyWin] : [...windows]) {
    const slept = w.tabs.sleepIdle(idle);
    if (slept.length) results.push({ w, slept });
  }
  if (!results.length) {
    if (force && onlyWin) onlyWin.send('mochi-say', { text: 'Every other tab is already asleep or busy', pose: 'idle', essential: true });
    return [];
  }
  // A process is only freed if no remaining page still uses it.
  const alive = new Set(WebContents.getAllWebContents().filter((wc) => !wc.isDestroyed()).map((wc) => wc.getOSProcessId()));
  for (const { w, slept } of results) {
    const pids = new Set(slept.map((t) => t.pid).filter((p) => p && !alive.has(p)));
    const mb = Math.round([...pids].reduce((sum, p) => sum + (memBefore.get(p) || 0), 0) / 1024);
    if (!w.isPrivate) { stats?.event('slept', slept.length); stats?.event('freedMB', mb); }
    if (slept.length >= 2 || force) {
      const n = slept.length;
      const text = `I tucked ${n} tab${n === 1 ? '' : 's'} into bed${mb >= 10 ? ` · about ${mb} MB freed` : ''}`;
      w.send('mochi-say', { text, pose: 'sleepy', essential: true });
    }
  }
  return results;
}

// ---------------- Focus tools ----------------
// Which windows currently show a tab of this site (focused window first).
function windowsShowing(site) {
  return [...windows]
    .filter((w) => !w.win.isDestroyed() && w.tabs.shownTabs.some((t) => focus.siteOf(t.url) === site))
    .sort((a, b) => Number(b.win.isFocused()) - Number(a.win.isFocused()));
}
function startFocus() {
  stats = new Stats(() => store.get('reportOn') !== false);
  focus = new Focus({
    getWindows: () => [...windows],
    onCount: (seen, hasLimits) => stats.count(seen, hasLimits),
    onEvent: (name) => { stats.event(name); if (name === 'focus' || name === 'dayWithin') fun.earn(name); },
    onWarn: (site, mins) => {
      for (const w of windowsShowing(site)) {
        w.send('mochi-say', { text: `${mins} min left on ${sitePretty(site)} today`, pose: mins <= 1 ? 'oops' : 'wave', essential: true });
      }
    },
    onTimeUp: (site, snoozesLeft) => {
      const w = windowsShowing(site)[0] || [...windows].find((x) => x.tabs.tabs.some((t) => focus.siteOf(t.url) === site));
      if (!w) return focus.eaten(site);
      const tabIds = w.tabs.visible.filter((t) => focus.siteOf(t.url) === site).map((t) => t.id);
      w.send('focus-timeup', { site, name: sitePretty(site), snoozesLeft, tabIds });
    },
    onTick: () => {
      const sess = focus.session ? { phase: focus.session.phase, leftSec: Math.max(0, Math.round((focus.session.endsAt - Date.now()) / 1000)) } : null;
      for (const w of windows) {
        const site = w.tabs.active ? focus.siteOf(w.tabs.active.url) : null;
        w.send('focus-state', { site, name: site ? sitePretty(site) : '', remainingSec: site ? Math.max(0, focus.remaining(site)) : null, session: sess });
      }
    },
    onSession: (ev) => {
      const say = {
        started: ["Focus time! I'll guard the distractions", 'wave'],
        'focus-done': ['Focus session done! Take a 5-minute break', 'celebrate'],
        'break-done': ["Break's over. Ready for another round?", 'happy'],
        ended: ['Focus session ended', 'idle'],
      }[ev];
      everyWindow((w) => { if (say) w.send('mochi-say', { text: say[0], pose: say[1], essential: true }); });
    },
  });
}

// ---------------- Mochi, fun: carrots, outfits, night mode ----------------
const focusedWindow = () => normalWindows().find((x) => x.win.isFocused()) || normalWindows()[0];
function setNight(on) {
  store.set('nightMode', !!on);
  broadcastTheme();
  // The warm tint follows night mode (and your "tint pages" setting).
  for (const w of normalWindows()) for (const t of w.tabs.tabs) w.tabs.applyNight(t);
}
function startFun() {
  fun = new Fun({
    store,
    say: (text, opts) => focusedWindow()?.send('mochi-say', { text, ...opts }),
  });
}

// ---------------- Mochi, helpful: breaks, tidy-up, reminders ----------------
const remindersChanged = () => everyWindow((w) => w.send('reminders', care.list()));
function startCare() {
  care = new Care({
    store,
    getWindows: () => [...windows],
    mochiOn: () => store.get('mochiMode') !== 'off',
    onEye: (w) => w.send('care-eye', { seconds: 20 }),
    onWelcomeBack: (w) => w.send('mochi-say', { text: 'Welcome back!', pose: 'wave', essential: false }),
    setNight: (on) => setNight(on),
    onBedtime: (kind) => {
      const w = focusedWindow();
      if (!w) return;
      if (kind === 'soon') w.send('mochi-say', { text: 'Bedtime in 30 minutes. Time to wind down?', pose: 'sleepy', essential: true, ms: 8000 });
      else if (kind === 'now') w.send('mochi-say', { text: "It's bedtime. Click me for night mode", pose: 'sleepy', essential: true, ms: 12000, opens: 'night' });
      else w.send('mochi-say', { text: "It's late. Tomorrow-you will thank you", pose: 'sleepy', essential: true, ms: 8000 });
    },
    onStretch: (w) => w.send('mochi-say', { text: "90 minutes in. Stand up and stretch for a minute?", pose: 'wave', essential: true, ms: 9000 }),
    onTidy: (w, offer) => w.send('care-tidy', offer),
    onReminder: (r) => {
      const w = normalWindows().find((x) => x.win.isFocused()) || normalWindows()[0];
      if (!w) return;
      w.tabs.create(r.url, { title: r.title });
      w.send('mochi-say', { text: `Back as promised: ${r.title.slice(0, 40)}`, pose: 'wave', essential: true, ms: 8000 });
      remindersChanged();
    },
  });
  setTimeout(() => care.checkReminders(), 4000); // reminders that came due while Burrow was closed
}

// ---------------- Import from other browsers ----------------
// The self-test points the importer at fake browser profiles inside its own folder.
let importer = null;
const getImporter = () => importer || (importer = new Importer(SELFTEST
  ? { local: path.join(SELFTEST, 'browsers', 'Local'), roaming: path.join(SELFTEST, 'browsers', 'Roaming') }
  : {}));
function importSources() {
  return getImporter().sources().map((src) => ({ id: src.id, label: src.label, browser: src.browser, ...getImporter().preview(src) }));
}
const hostKey = (u) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return ''; } };
function runImport(id, want) {
  const src = getImporter().sources().find((x) => x.id === String(id));
  if (!src) return null;
  const opts = { bookmarks: want?.bookmarks !== false, history: want?.history !== false };
  let data;
  try { data = getImporter().read(src, opts); } catch (err) { return { error: String(err.message || err) }; }
  const bookmarks = opts.bookmarks ? library.importBookmarks(data.bookmarks) : { added: 0, skipped: 0 };
  const history = opts.history ? library.importHistory(data.history) : { added: 0 };
  const have = new Set((store.get('quickLinks') || []).map((q) => hostKey(q.url)));
  const top = topSites(data.history).filter((t) => !have.has(hostKey(t.url)));
  everyWindow((w) => w.sendBookmarks());
  store.set('importedFrom', [...new Set([...(store.get('importedFrom') || []), src.browser])]);
  return { label: src.label, bookmarks, history, top };
}
// Add suggested sites to the new tab's quick links (up to 8 in all, web addresses only).
function addQuickLinks(sites) {
  const links = [...(store.get('quickLinks') || [])];
  const have = new Set(links.map((q) => hostKey(q.url)));
  for (const site of (Array.isArray(sites) ? sites : []).slice(0, 8)) {
    if (links.length >= 8) break;
    try {
      const u = new URL(String(site?.url || ''));
      if (!/^https?:$/.test(u.protocol) || have.has(hostKey(u.href))) continue;
      links.push({ name: String(site.name || u.host).replace(/\s+/g, ' ').trim().slice(0, 24) || u.host, url: u.href });
      have.add(hostKey(u.href));
    } catch { /* not an address */ }
  }
  store.set('quickLinks', links);
  broadcastTheme();
  return links.length;
}

// ---------------- New-tab stat line + weekly report ----------------
const mins = (sec) => Math.max(1, Math.round(sec / 60));
function statLine(w) {
  if (w.isPrivate || store.get('mochiMode') === 'off') return null;
  // 1. A limited site you used today with 10 minutes or less left
  const low = Object.keys(focus.limits)
    .filter((site) => (focus.used[site] || 0) > 0 && focus.remaining(site) > 0 && focus.remaining(site) <= 600)
    .sort((a, b) => focus.remaining(a) - focus.remaining(b))[0];
  if (low) return `${mins(focus.remaining(low))} min left on ${sitePretty(low)} today`;
  // 2. A focus session
  if (focus.session) {
    const left = mins((focus.session.endsAt - Date.now()) / 1000);
    return focus.session.phase === 'focus' ? `Focus session \u00b7 ${left} min to go` : `On a break \u00b7 ${left} min left`;
  }
  // 3. A streak of days within your limits
  if (Object.keys(focus.limits).length && focus.streak.days >= 2) return `${focus.streak.days}-day streak within your limits`;
  if (store.get('reportOn') === false) return null;
  const today = stats.day();
  // 4. Focus sessions finished today
  if (today.focus) return `${today.focus} focus session${today.focus === 1 ? '' : 's'} done today. Nice.`;
  // 5. Memory saved by sleeping tabs
  if (today.freedMB >= 50) return `Sleeping tabs saved about ${today.freedMB} MB today`;
  return null;
}
// Once a week, the first new tab brings Mochi with "Your week in Burrow is ready".
function maybeNudge(w) {
  if (w.isPrivate || !stats.nudgeDue()) return;
  stats.markNudged();
  setTimeout(() => w.send('mochi-say', { text: 'Your week in Burrow is ready! Click me to see it', pose: 'celebrate', opens: 'report', ms: 12000 }), 900);
}
const REPORT = 'burrow://report/';
const reportPage = (e) => (e.sender.getURL().startsWith('burrow://report') ? winOfPage(e.sender) : null);

// ---------------- Windows ----------------
// Every open normal window is saved, so they all come back after a restart.
function saveSessions() {
  store.set('session', { windows: [...sessions.values()] });
}

const ctx = {
  get store() { return store; },
  get library() { return library; },
  get mainDownloads() { return downloads; },
  get focus() { return focus; },
  themePayload, setPrefs, setupSession,
  openPrivate: () => openWindow({ isPrivate: true }),
  openWindow: (opts) => openWindow(opts || {}),
  get notes() { return notes; },
  get perms() { return perms; },
  saveSession: (w, snap) => { if (!windows.has(w)) return; sessions.set(w, snap); saveSessions(); },
  onClosed: (w) => {
    windows.delete(w);
    if (w.isPrivate) return;
    if (w === mainWin) mainWin = normalWindows()[0] || null;
    if (normalWindows().length || w.closedEmpty) {
      // You closed one of several windows — or closed its last tab: forget its tabs (like Chrome).
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
const winOfToast = (wc) => [...windows].find((w) => w.toasts?.view?.webContents === wc);
const winOfPage = (wc) => [...windows].find((w) => w.ownsPage(wc));
const isBurrowPage = (wc) => wc.getURL().startsWith('burrow://');

// ---------------- Messages from each window's interface ----------------
function registerIpc() {
  // Only Burrow's own interface may send these; each goes to the window it came from.
  const on = (ch, fn) => ipcMain.on(ch, (e, ...a) => { const w = winOfUi(e.sender); if (w) fn(w, ...a); });
  const handle = (ch, fn) => ipcMain.handle(ch, (e, ...a) => { const w = winOfUi(e.sender); return w ? fn(w, ...a) : null; });

  on('ui:ready', (w) => { w.sendTabs(); w.applyTheme(); w.sendBookmarks(); w.send('downloads', w.downloads.state()); w.send('ai-panel', w.aiState()); });
  on('ui:layout', (w, l) => w.setLayout(l));
  // System toasts: shown by the interface (e.g. "Saved report.pdf · Show"); the button's press goes back to it.
  handle('toast:show', (w, t) => w.toasts.show({ text: t?.text, kind: t?.kind, action: t?.action, ms: t?.ms, onAction: (id) => w.send('toast-action', id) }));
  const onToast = (ch, fn) => ipcMain.on(ch, (e, ...a) => { const w = winOfToast(e.sender); if (w) fn(w, ...a); });
  onToast('toast:size', (w, width, height) => w.toasts.setSize(width, height));
  onToast('toast:act', (w, id) => w.toasts.act(Number(id)));
  onToast('toast:dismiss', (w, id) => w.toasts.dismiss(Number(id)));
  onToast('toast:hover', (w, on) => w.toasts.hover(on));
  on('ui:overlay', (w, open) => w.setOverlay(open));
  on('prefs:set', (_w, patch) => setPrefs(patch));
  on('theme:set', (_w, patch) => setTheme(patch));
  on('window:private', () => ctx.openPrivate());
  on('window:new', () => openWindow());
  on('fullscreen:peek', (w, on) => { w.uiHovered = !!on; w.setPeek(!!on); });
  on('fullscreen:toggle', (w) => w.toggleBrowserFull());
  // "What's new" any time (Settings → About, Ctrl+K): this version and the one before
  on('whatsnew:show', (w) => { const prev = Changelog.CHANGES[1]?.version || '0.0.0'; showWhatsNew(prev, app.getVersion(), w) || showWhatsNew('0.0.0', app.getVersion(), w); });
  // Clipboard text for Burrow's own text boxes (Paste in the right-click menu). Websites can't read it.
  handle('clip:read', () => clipboard.readText());
  // Site permissions: the bar's answer, and Settings → Site permissions
  on('perm:answer', (_w, id, allow) => perms.answer(Number(id), !!allow));
  handle('perm:list', () => perms.list());
  handle('perm:set', (_w, origin, kind, value) => perms.set(String(origin || ''), String(kind || ''), value === 'allow' || value === 'block' ? value : null));
  // Clear browsing data (normal windows; private windows forget everything on close anyway)
  handle('data:clear', (w, range, what) => (w.isPrivate ? null : clearData(String(range || ''), {
    history: !!what?.history, cookies: !!what?.cookies, cache: !!what?.cache, downloads: !!what?.downloads,
  })));
  // Default browser
  handle('browser:default-state', () => ({ isDefault: app.isDefaultProtocolClient('https'), packaged: app.isPackaged }));
  on('browser:make-default', () => {
    if (app.isPackaged) { app.setAsDefaultProtocolClient('http'); app.setAsDefaultProtocolClient('https'); }
    // Windows only lets you pick the default browser yourself, in Settings.
    shell.openExternal('ms-settings:defaultapps').catch(() => {});
  });
  // Updates
  handle('update:state', () => updates.state);
  handle('update:check', () => updates.check());
  on('update:install', () => updates.install());
  // Import from other browsers (Settings → Import, Ctrl+K)
  // Mochi, helpful
  on('care:eye-done', () => { stats.event('eyes'); fun.earn('eye'); });
  // Carrots and the wardrobe
  handle('fun:state', () => fun.state());
  handle('fun:buy', (_w, id) => { const ok = fun.buy(String(id || '')); if (ok) broadcastTheme(); return ok; });
  handle('fun:wear', (_w, id) => { const ok = fun.wear(id ? String(id) : null); if (ok) broadcastTheme(); return ok; });
  on('night:set', (w, on) => { if (!w.isPrivate) setNight(!!on); });
  on('hop:open', (w) => w.tabs.create('burrow://offline/?play=1'));
  handle('care:tidy', (w) => (w.isPrivate ? null : care.offerTidy(w, true)));
  on('care:close-tabs', (w, ids) => w.tabs.closeMany((Array.isArray(ids) ? ids : []).slice(0, 200), { keepWindow: true }));
  handle('tab:remind', (w, id, at) => {
    if (w.isPrivate) return null;
    const t = w.tabs.get(Number(id));
    const r = care.add(t, Number(at));
    if (r) { w.tabs.close(t.id, { keepWindow: true }); remindersChanged(); }
    return r;
  });
  handle('reminders:list', () => care.list());
  on('reminders:open', (w, id) => { const r = care.remove(Number(id)); if (r) { w.tabs.create(r.url, { title: r.title }); remindersChanged(); } });
  on('reminders:cancel', (_w, id) => { care.remove(Number(id)); remindersChanged(); });
  on('dl:keep', (w, id) => w.downloads.keep(Number(id)));
  on('dl:discard', (w, id) => w.downloads.discard(Number(id)));
  handle('import:sources', (w) => (w.isPrivate ? [] : importSources()));
  handle('import:run', (w, id, want) => (w.isPrivate ? null : runImport(id, want)));
  handle('import:quicklinks', (w, sites) => (w.isPrivate ? 0 : addQuickLinks(sites)));
  // Right-click menus on pages: run / close (the window checks the token and the item).
  on('ctx:run', (w, token, id) => w.runPageMenu(Number(token), String(id || '')));
  on('ctx:closed', (w, token) => w.closePageMenu(Number(token)));
  // Tab menu actions
  on('tab:new-after', (w, id) => { const t = w.tabs.get(Number(id)); w.tabs.create(NEWTAB, t ? { after: t.id } : {}); });
  on('tab:reload', (w, id) => w.tabs.reload(Number(id)));
  on('tab:duplicate', (w, id) => w.tabs.duplicate(Number(id)));
  on('tab:sleep', (w, id) => w.tabs.sleepTab(Number(id)));
  on('tab:close-others', (w, id) => w.tabs.closeOthers(Number(id)));
  on('tab:close-right', (w, id) => w.tabs.closeRight(Number(id)));
  on('tab:move-ws', (w, id, ws) => w.tabs.moveToWorkspace(Number(id), ws === 'new' ? 'new' : Number(ws)));
  // The other normal windows (for "Move to window ▸")
  handle('windows:others', (w) => (w.isPrivate ? [] : normalWindows().filter((o) => o !== w && !o.win.isDestroyed()).map((o, i) => ({
    id: o.win.id, name: `Window ${i + 2}: ${(o.tabs.active?.title || 'New tab').slice(0, 30)}`, tabs: o.tabs.tabs.length,
  }))));
  on('tab:move-window', (w, id, target) => {
    if (w.isPrivate) return;
    if (target === 'new') {
      const tab = w.tabs.detach(Number(id));
      if (!tab) return;
      const b = w.win.getBounds();
      openWindow({ adoptTab: tab, bounds: { x: b.x + 40, y: b.y + 40, width: b.width, height: b.height } });
      return;
    }
    const o = normalWindows().find((x) => x.win.id === Number(target) && x !== w);
    if (!o) return;
    const tab = w.tabs.detach(Number(id), { allowLast: true });
    if (!tab) return;
    o.tabs.adopt(tab);
    o.win.focus();
    if (!w.tabs.tabs.length) w.tabs.onEmpty();
  });
  on('bookmark:edit', (_w, id, title, url) => {
    const u = String(url || '').trim();
    if (!/^https?:\/\//i.test(u)) return;
    library.editBookmark(Number(id), String(title || '').slice(0, 200), u);
  });

  on('tab:new', (w) => w.tabs.create(NEWTAB));
  on('tab:close', (w, id) => w.tabs.close(Number(id)));
  on('tab:activate', (w, id) => w.tabs.activate(Number(id)));
  on('tab:navigate', (w, text) => w.tabs.navigate(String(text || '')));
  on('tab:search', (w, text) => w.tabs.create(require('./url').toUrl(String(text || ''), store.get('searchEngine'))));
  on('ai:ask', (w, text, newTab) => w.ask(String(text || ''), { newTab: !!newTab }));
  handle('palette:tabs', (w) => w.allTabs());
  on('tab:reopen', (w) => w.tabs.reopenClosed());
  on('tab:move', (w, id, to) => w.tabs.move(Number(id), Number(to)));
  // A tab dragged out of the strip: drop it on another window's tabs, or open it in a new window.
  on('tab:detach', async (w, id, sx, sy) => {
    if (w.isPrivate) return; // private tabs stay in their private window
    const x = Math.round(Number(sx) || 0), y = Math.round(Number(sy) || 0);
    const target = normalWindows().find((o) => o !== w && overChrome(o, x, y));
    showDropMarker(null);
    if (target) {
      // Land where you let go: ask the target window which slot is under the pointer.
      const cb = target.win.getContentBounds();
      let at;
      try { at = await target.ui.webContents.executeJavaScript(`window.dropIndexAt ? window.dropIndexAt(${x - cb.x}, ${y - cb.y}) : null`); } catch { at = null; }
      const tab = w.tabs.detach(Number(id), { allowLast: true });
      if (!tab) return;
      target.tabs.adopt(tab, typeof at === 'number' ? at : undefined);
      target.win.focus();
      if (!w.tabs.tabs.length) w.tabs.onEmpty(); // that was its only tab: the empty window closes
      return;
    }
    const b = w.win.getBounds();
    if (w.tabs.tabs.length < 2) {
      // A window's only tab dropped on empty space: move the whole window there instead.
      w.win.setPosition(Math.round(x - 160), Math.round(y - 20));
      return;
    }
    const tab = w.tabs.detach(Number(id));
    if (!tab) return;
    openWindow({ adoptTab: tab, bounds: { x: x - 160, y: y - 20, width: b.width, height: b.height } });
  });
  // While a tab is being dragged: show where it would land in the window under the pointer.
  let dropOver = null;
  function showDropMarker(target, x, y) {
    if (dropOver && dropOver !== target && !dropOver.win.isDestroyed()) dropOver.send('drop-marker', null);
    dropOver = target;
    if (!target) return;
    const cb = target.win.getContentBounds();
    target.send('drop-marker', { x: x - cb.x, y: y - cb.y });
  }
  on('tab:drag-hover', (w, sx, sy) => {
    if (w.isPrivate || sx === null) { showDropMarker(null); return; }
    const x = Math.round(Number(sx) || 0), y = Math.round(Number(sy) || 0);
    showDropMarker(normalWindows().find((o) => o !== w && overChrome(o, x, y)) || null, x, y);
  });
  on('tab:mute', (w, id) => w.tabs.toggleMute(Number(id)));
  on('tab:keepawake', (w, id) => w.tabs.keepAwake(Number(id)));
  handle('tab:volume', (w, id, volume, remember) => w.tabs.setVolume(Number(id), Number(volume), remember === undefined ? undefined : !!remember));
  on('tabs:sleep-now', (w) => sweepSleep(w, true));
  handle('tab:pip', (w) => w.pip());
  on('nav:back', (w) => w.tabs.back());
  on('nav:forward', (w) => w.tabs.forward());
  on('nav:reload', (w) => w.tabs.reload());
  on('nav:stop', (w) => w.tabs.stop());
  on('zoom:step', (w, dir) => w.tabs.stepZoom(Math.sign(Number(dir) || 0)));
  on('find:query', (w, q) => w.find(q));
  // Focus tools
  handle('focus:snooze', (_w, site) => focus.snooze(String(site || '')));
  on('focus:eaten', (_w, site) => focus.eaten(String(site || '')));
  on('focus:session', (_w, what) => (what === 'start' ? focus.startSession() : focus.endSession()));
  handle('focus:limit', (_w, site, minutes) => focus.setLimit(site, minutes));
  handle('focus:info', () => ({ ...focus.info(), reportOn: store.get('reportOn') !== false }));
  on('stats:clear', () => stats.clear());
  on('report:open', (w) => w.tabs.create(REPORT));
  // Split view
  on('split:with', (w, id) => w.tabs.splitWith(id === 'new' ? 'new' : (Number(id) || undefined)));
  on('split:off', (w) => w.tabs.unsplit());
  on('split:swap', (w) => w.tabs.swapSplit());
  on('split:ratio', (w, r) => w.tabs.setSplitRatio(r));
  // Reader mode
  handle('reader:toggle', (w) => w.tabs.toggleReader());
  // AI side panel
  on('ai:panel', (w, open) => w.setAI(open === undefined ? undefined : !!open));
  on('ai:width', (w, px) => w.setAIWidth(px));
  // Notes (one per website; off in private windows)
  const hostOk = (h) => typeof h === 'string' && /^[a-z0-9.-]+(:\d+)?$/i.test(h) && h.length < 256;
  handle('notes:get', (w) => ({ host: w.isPrivate ? '' : w.currentHost(), text: w.isPrivate ? '' : notes.get(w.currentHost()), private: w.isPrivate }));
  handle('notes:read', (_w, host) => (hostOk(host) ? notes.get(host) : ''));
  on('notes:set', (w, host, text) => { if (!w.isPrivate && hostOk(host)) notes.set(host, String(text || '')); });
  handle('notes:all', () => notes.all().map((n) => ({ host: n.host, updated: n.updated, preview: n.text.slice(0, 120) })));
  handle('notes:export', async (w) => {
    if (!notes.all().length) return { ok: false, reason: 'empty' };
    const { canceled, filePath } = await dialog.showSaveDialog(w.win, {
      title: 'Export notes', defaultPath: path.join(app.getPath('documents'), 'burrow-notes.md'),
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (canceled || !filePath) return { ok: false, reason: 'cancelled' };
    await notes.exportTo(filePath);
    return { ok: true, path: filePath };
  });
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
  // The new tab's bug form: open the prefilled GitHub page in a new tab of the same window.
  ipcMain.on('page:report-bug', (e, report) => {
    const w = isBurrowPage(e.sender) && winOfPage(e.sender);
    if (!w || !String(report?.title || '').trim()) return;
    const url = bugReportUrl(report || {});
    if (url) w.tabs.create(url);
  });
  ipcMain.on('page:ask', (e, text) => {
    const w = isBurrowPage(e.sender) && winOfPage(e.sender);
    if (w) w.ask(String(text || ''), { pageWc: e.sender });
  });
  // The reader page asks for the article it should show (by its one-time key).
  ipcMain.handle('page:reader', (e, key) => {
    if (!e.sender.getURL().startsWith('burrow://reader') || !winOfPage(e.sender)) return null;
    return Reader.get(key);
  });
  // The welcome tour (burrow://welcome only) can set up the basics and open AI sign-in pages.
  // The welcome tour's "Bring your stuff" step (burrow://welcome only).
  const welcomePage = (e) => e.sender.getURL().startsWith('burrow://welcome') && winOfPage(e.sender);
  ipcMain.handle('page:import-sources', (e) => (welcomePage(e) ? importSources() : null));
  ipcMain.handle('page:import-run', (e, id, want) => (welcomePage(e) ? runImport(id, want) : null));
  ipcMain.handle('page:import-quicklinks', (e, sites) => (welcomePage(e) ? addQuickLinks(sites) : 0));
  ipcMain.on('page:welcome', (e, action, value) => {
    const w = e.sender.getURL().startsWith('burrow://welcome') && winOfPage(e.sender);
    if (!w) return;
    if (action === 'mode') setTheme({ mode: String(value) });
    else if (action === 'seed') setTheme({ seed: String(value), useWindowsAccent: false });
    else if (action === 'search') setPrefs({ searchEngine: String(value) });
    else if (action === 'ai') setPrefs({ aiProvider: String(value) });
    else if (action === 'eyes') setPrefs({ eyeBreaks: Number(value) });
    else if (action === 'bedtime') setPrefs({ bedtime: String(value) });
    else if (action === 'signin') {
      // Opens the AI's own sign-in page in a normal tab — you sign in on their site; Burrow never sees it.
      const p = AI.PROVIDERS[String(value)];
      if (p?.login) w.tabs.create(p.login);
    } else if (action === 'done') {
      store.set('onboarded', true);
      w.tabs.navigateFrom(e.sender, NEWTAB);
    }
  });
  // ---- The Burrow gate (burrow://gate only). The site comes from the page's own address. ----
  const gatePage = (e) => {
    if (!e.sender.getURL().startsWith('burrow://gate')) return null;
    const w = winOfPage(e.sender);
    if (!w) return null;
    const q = new URL(e.sender.getURL()).searchParams;
    const site = focus.limits[q.get('site')] !== undefined || focus.session ? q.get('site') : null;
    const original = q.get('u') || '';
    return { w, site, original: /^https?:\/\//i.test(original) && focus.siteOf(original) === site ? original : null };
  };
  ipcMain.handle('page:gate-info', (e) => {
    const g = gatePage(e);
    if (!g?.site) return null;
    const links = (store.get('quickLinks') || []).filter((l) => !focus.siteOf(l.url) && !l.ws).slice(0, 4);
    return { ...focus.gateInfo(g.site, focus.blocked(g.site) || 'limit'), links, open: !focus.blocked(g.site) };
  });
  ipcMain.handle('page:gate-start', (e) => { const g = gatePage(e); return g?.site ? focus.startUnlock(e.sender.id, g.site) : null; });
  ipcMain.handle('page:gate-unlock', (e) => {
    const g = gatePage(e);
    if (!g?.site || !focus.unlock(e.sender.id, g.site)) return false;
    if (g.original) g.w.tabs.navigateFrom(e.sender, g.original);
    return true;
  });
  ipcMain.on('page:gate-action', (e, action, value) => {
    const g = gatePage(e);
    if (!g) return;
    const wc = e.sender;
    if (action === 'end-session') { focus.endSession(); if (g.original && !focus.gateFor(g.original)) g.w.tabs.navigateFrom(wc, g.original); }
    else if (action === 'start-session') focus.startSession();
    else if (action === 'back') { const nav = wc.navigationHistory; if (nav.canGoBack()) nav.goBack(); else g.w.tabs.navigateFrom(wc, NEWTAB); }
    else if (action === 'open' && /^https?:\/\//i.test(String(value || ''))) g.w.tabs.navigateFrom(wc, String(value));
    else if (action === 'continue' && g.original && !focus.gateFor(g.original)) g.w.tabs.navigateFrom(wc, g.original);
  });
  // ---- Offline / can't-reach pages (burrow://offline only) ----
  const offlinePage = (e) => {
    if (!e.sender.getURL().startsWith('burrow://offline')) return null;
    const w = winOfPage(e.sender);
    if (!w) return null;
    const q = new URL(e.sender.getURL()).searchParams;
    const u = q.get('u') || '';
    return { w, url: /^https?:\/\//i.test(u) ? u : null, code: Number(q.get('e')) || 0 };
  };
  ipcMain.handle('page:offline-info', (e) => {
    const o = offlinePage(e);
    if (!o) return null;
    let host = '';
    try { host = o.url ? new URL(o.url).host.replace(/^www\./, '') : ''; } catch { host = ''; }
    return { url: o.url, host, code: o.code, best: fun.state().hopBest };
  });
  // Is the site back? A quick check; if it answers (and you're not mid-game) the tab goes back to it.
  ipcMain.handle('page:offline-retry', async (e, go) => {
    const o = offlinePage(e);
    if (!o?.url) return false;
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 5000);
      await net.fetch(o.url, { method: 'HEAD', signal: ctl.signal, bypassCustomProtocolHandlers: true });
      clearTimeout(t);
    } catch { return false; }
    if (go) o.w.tabs.navigateFrom(e.sender, o.url);
    return true;
  });
  ipcMain.handle('page:hop-score', (e, score, collected) => (offlinePage(e) ? fun.hopScore(score, collected) : null));
  // ---- A password box on a page without HTTPS (any web page may send this; it only shows a warning) ----
  const warnedPages = new Set();
  ipcMain.on('page:insecure-password', (e) => {
    let u;
    try { u = new URL(e.sender.getURL()); } catch { return; }
    if (u.protocol !== 'http:') return;
    if (!SELFTEST && /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(u.hostname)) return;
    const key = e.sender.id + ' ' + u.host;
    if (warnedPages.has(key)) return;
    warnedPages.add(key);
    const w = winOfPage(e.sender);
    w?.toasts.show({ text: `${u.host} isn't secure. Don't type passwords here`, kind: 'warning', ms: 9000 });
  });
  // ---- New tab: the stat line (and the weekly nudge) ----
  // ---- Mochi's menu on the new tab (burrow://newtab only) ----
  const newtabPage = (e) => isBurrowPage(e.sender) && e.sender.getURL().startsWith('burrow://newtab') && winOfPage(e.sender);
  ipcMain.handle('page:mochi-info', (e) => {
    const w = newtabPage(e);
    if (!w) return null;
    return { isPrivate: w.isPrivate, carrots: fun.state().carrots, session: focus.session?.phase || null, night: !!store.get('nightMode') };
  });
  ipcMain.on('page:mochi', (e, action) => {
    const w = newtabPage(e);
    if (!w) return;
    if (action === 'hop') w.tabs.navigateFrom(e.sender, 'burrow://offline/?play=1');
    if (w.isPrivate) return; // the rest is for normal windows
    if (action === 'focus') { if (focus.session) focus.endSession(); else focus.startSession(); }
    else if (action === 'tidy') {
      const offer = care.offerTidy(w, true);
      if (offer) w.send('care-tidy-open', offer);
      else w.send('mochi-say', { text: 'All tidy! No duplicates or forgotten tabs.', pose: 'happy', essential: true });
    } else if (action === 'report') w.tabs.navigateFrom(e.sender, REPORT);
    else if (action === 'wardrobe' || action === 'settings') w.openPanel('settings:mochi');
    else if (action === 'night') setNight(!store.get('nightMode'));
  });
  ipcMain.handle('page:statline', (e) => {
    const w = isBurrowPage(e.sender) && e.sender.getURL().startsWith('burrow://newtab') && winOfPage(e.sender);
    if (!w) return null;
    maybeNudge(w);
    return statLine(w);
  });
  // ---- The weekly report (burrow://report only) ----
  ipcMain.handle('page:report', (e, offset) => {
    const w = reportPage(e);
    if (!w) return null;
    const n = Math.max(0, Math.min(4, Math.floor(Number(offset) || 0)));
    const wk = stats.week(n);
    const name = (site) => sitePretty(site);
    return {
      ...wk,
      top: wk.top.map((t) => ({ ...t, name: name(t.site) })),
      on: store.get('reportOn') !== false,
      streak: focus.streak.days,
      limits: Object.keys(focus.limits).length,
      lastHasData: stats.week(1).hasData,
    };
  });
  ipcMain.on('page:report-action', (e, action) => {
    const w = reportPage(e);
    if (w && action === 'settings') w.send('open-panel', 'settings');
  });
  ipcMain.on('page:navigate', (e, text) => {
    const w = isBurrowPage(e.sender) && winOfPage(e.sender);
    if (w) w.tabs.navigateFrom(e.sender, String(text || ''));
  });
}

// ---------------- App lifecycle ----------------
// Only one Burrow at a time (two copies would fight over the saved-state file).
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', (_e, argv) => {
  // Burrow is already open: a link from another app (or the Start menu) opens a tab here.
  const link = linkFromArgs(argv);
  const w = normalWindows().find((x) => x.win.isFocused()) || normalWindows().pop();
  if (!w) return openWindow(link ? { url: link } : {});
  if (w.win.isMinimized()) w.win.restore();
  w.win.focus();
  w.tabs.create(link || NEWTAB);
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
  startFun();
  startFocus();
  startCare();
  notes = new Notes({ onChange: (host) => everyWindow((w) => w.send('notes-changed', host)) });
  downloads = new Downloads({
    session: session.defaultSession,
    onChange: (list) => normalWindows().forEach((w) => w.send('downloads', list)),
    onDone: (d) => normalWindows().forEach((w) => w.send('download-done', d)),
    onRisky: (d) => normalWindows().forEach((w) => w.send('download-risky', d)),
  });
  protocol.handle('burrow', serveBurrow);
  perms = new Permissions({ store, windowFor: (wc) => winOfPage(wc) || null });
  setupSession(session.defaultSession);
  updates = new Updates({
    onState: (st) => {
      everyWindow((w) => w.send('update-state', st));
      if (st.status === 'ready') {
        const w = normalWindows().find((x) => x.win.isFocused()) || normalWindows()[0];
        w?.toasts.show({ text: `Burrow v${st.version} is ready`, kind: 'success', action: 'Restart', ms: 15000, onAction: () => updates.install() });
      }
    },
  });
  registerIpc();
  nativeTheme.on('updated', broadcastTheme);
  systemPreferences.on?.('accent-color-changed', broadcastTheme);
  setInterval(() => sweepSleep(), 60 * 1000);

  // Bring back every window that was open last time (or one fresh window).
  const saved = savedWindows();
  Tabs.reserveWsIds(saved.flatMap((w) => w.workspaces.map((ws) => ws.id)));
  if (saved.length) saved.forEach((snapshot) => openWindow({ snapshot }));
  else openWindow();
  const startLink = linkFromArgs(process.argv);
  if (startLink && mainWin) mainWin.tabs.create(startLink);
  // Just updated? Show what's new once (a fresh install gets the welcome tour instead).
  checkWhatsNew();
  // First time: Mochi's welcome tour (the self-test opens it itself).
  if (!store.get('onboarded') && !SELFTEST) mainWin.tabs.create('burrow://welcome/');
  if (SELFTEST) {
    require('./selftest').run({
      app, ui: mainWin.ui, tabs: mainWin.tabs, library, downloads, setTheme, setPrefs, store, dir: SELFTEST,
      mainWin, openWindow, windows, session, getNotes: () => notes, sweepSleep, getFocus: () => focus, getStats: () => stats, statLine, getCare: () => care, getFun: () => fun, setNight, getPerms: () => perms, showWhatsNew, checkWhatsNew, getUpdates: () => updates, linkFromArgs, clearData,
    });
  }
});

// ---------------- "What's new" after an update ----------------
function checkWhatsNew() {
  const now = app.getVersion();
  const last = store.get('lastVersion');
  store.set('lastVersion', now);
  if (!last || !Changelog.newer(now, last) || SELFTEST) return; // first install, same version, or the self-test
  showWhatsNew(last, now);
}
function showWhatsNew(from, to, w = mainWin) {
  const entries = Changelog.between(from, to);
  if (!entries.length || !w) return false;
  // The window's interface may still be loading: send once it's ready.
  const send = () => w.send('whats-new', { from, to, entries });
  if (w.ui.webContents.isLoading()) w.ui.webContents.once('did-finish-load', () => setTimeout(send, 600)); else setTimeout(send, 300);
  return true;
}

function flushAll() { store?.flush(); library?.flush(); downloads?.flush(); notes?.flush(); focus?.flush(); stats?.flush(); }
app.on('before-quit', flushAll);
app.on('window-all-closed', () => { flushAll(); app.quit(); });
