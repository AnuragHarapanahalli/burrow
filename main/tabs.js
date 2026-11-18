// Tab manager. Each tab is a WebContentsView showing one website.
// A tab can also be *asleep*: its page is unloaded to save memory (tab.view is null), and it keeps
// its address, title, icon and back/forward history so it can wake up where it was.
// Tabs belong to a workspace (Home, College, ...); only the current workspace's tabs are shown.
const path = require('path');
const { WebContentsView } = require('electron');
const { toUrl, displayUrl, NEWTAB } = require('./url');
const Reader = require('./reader');
const Volume = require('./volume');

// In reader view the tab's address is burrow://reader/?k=…&u=<original>; this gets the original.
function readerOriginal(url) {
  if (!String(url).startsWith('burrow://reader') && !String(url).startsWith('burrow://gate')) return null;
  try { const u = new URL(url).searchParams.get('u'); return /^https?:\/\//i.test(u || '') ? u : null; } catch { return null; }
}

const MAX_CLOSED = 25;
// IDs are unique across every window, so a tab can move between windows without clashing.
let nextTabId = 1;
let nextWsId = 1;

// A web page without HTTPS (your own computer's test servers don't count).
function insecurePage(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:') return false;
    return process.env.BURROW_SELFTEST ? true : !/^(localhost|127\.0\.0\.1|\[::1\])$/i.test(u.hostname);
  } catch { return false; }
}

class Tabs {
  constructor({ win, store, session, persist = true, zoom, gate, onChange, onInput, onVisit, onTitle, onSave }) {
    this.gate = gate || (() => null); // focus tools: returns the gate page to show instead of a URL, or null
    this.win = win;
    this.store = store;
    this.session = session;   // private windows pass their own in-memory session
    this.persist = persist;   // private windows don't save their tabs
    this.zoom = zoom || { get: () => 1, set: () => {} }; // per-site zoom memory
    this.onChange = onChange; // tab/workspace list changed
    this.onInput = onInput;   // keyboard shortcut hook
    this.onVisit = onVisit || (() => {});   // a page finished navigating (for history)
    this.onTitle = onTitle || (() => {});   // a page's title changed (for history)
    this.onSave = onSave || (() => {});     // this window's tabs changed (main.js saves them)
    this.tabs = [];           // { id, ws, view, title, url, favicon, loading }
    this.workspaces = [];     // { id, name, activeId }
    this.currentWs = null;
    this.activeId = null;
    this.shownTabs = [];     // pages attached to the window right now (1, or 2 in split view)
    this.split = null;       // split view: { a, b, ratio } — tab a on the left, b on the right
    this.closed = [];         // recently closed: { url, ws }
    this.bounds = { x: 0, y: 80, width: 800, height: 600 };
  }

  // ---------------- Tabs ----------------
  get visible() { return this.tabs.filter((t) => t.ws === this.currentWs); }
  get(id) { return this.tabs.find((t) => t.id === id); }
  get active() { return this.get(this.activeId); }
  ws(id) { return this.workspaces.find((w) => w.id === id); }

  create(url = NEWTAB, { activate = true, after, ws = this.currentWs, asleep = false, title, favicon } = {}) {
    const tab = {
      id: nextTabId++, ws, view: null, title: title || 'New tab', url, favicon: favicon || null,
      loading: !asleep, audible: false, media: false, playing: false, owner: this,
      asleep: !!asleep, keepAwake: false, history: null, lastActive: Date.now(),
    };
    const at = after ? this.tabs.findIndex((t) => t.id === after) : -1;
    if (at >= 0) this.tabs.splice(at + 1, 0, tab);
    else this.tabs.push(tab);
    if (!tab.asleep) {
      this.attach(tab);
      tab.view.webContents.loadURL(this.gate(url) || url).catch(() => {});
    }
    if (activate && ws === this.currentWs) this.activate(tab.id);
    else this.emit();
    return tab;
  }

  // Build the live page for a tab and wire up its events.
  attach(tab) {
    const view = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'tab-preload.js'),
        contextIsolation: true, sandbox: true, nodeIntegration: false,
        ...(this.session ? { session: this.session } : {}),
      },
    });
    tab.view = view;
    const wc = view.webContents;
    // Listeners always talk to the tab's *current* owner, because a tab can be dragged to another window.
    const T = () => tab.owner;

    const update = (patch) => { Object.assign(tab, patch); T().emit(); };
    wc.on('page-title-updated', (_e, title) => { update({ title }); T().onTitle(tab.url, title); });
    wc.on('page-favicon-updated', (_e, icons) => update({ favicon: icons[0] || null }));
    wc.on('did-start-loading', () => update({ loading: true }));
    wc.on('did-stop-loading', () => { update({ loading: false }); T().checkReader(tab); });
    wc.on('did-navigate', (_e, u) => {
      T().applyZoom(tab, u);
      update({ url: u, favicon: null, media: false, readerable: false });
      T().onVisit(u, wc.getTitle());
    });
    // Sound + video: a speaker on the tab, and the picture-in-picture button.
    wc.on('audio-state-changed', (e) => update({ audible: !!e.audible }));
    wc.on('media-started-playing', () => { update({ media: true, playing: true }); T().applyVolume(tab); });
    wc.on('dom-ready', () => T().applyVolume(tab));
    wc.on('media-paused', () => update({ playing: false }));
    // Ctrl + mouse wheel zooms, like other browsers.
    wc.on('zoom-changed', (_e, dir) => T().stepZoom(dir === 'in' ? 1 : -1, tab));
    wc.on('found-in-page', (_e, r) => { if (tab.id === T().activeId) T().onFind?.(r); });
    wc.on('did-navigate-in-page', (_e, u, isMain) => {
      if (!isMain) return;
      update({ url: u });
      T().onVisit(u, wc.getTitle());
    });
    wc.on('before-input-event', (e, input) => T().onInput(e, input));
    wc.on('context-menu', (_e, params) => T().onContextMenu?.(tab, params));
    wc.on('focus', () => T().focusPane(tab));
    // Focus tools: links, redirects and Back/Forward to a closed site show the gate instead.
    const toGate = (e, url) => {
      const g = T().gate(url);
      if (!g) return;
      e?.preventDefault?.();
      setImmediate(() => { if (!wc.isDestroyed()) wc.loadURL(g).catch(() => {}); });
    };
    wc.on('will-navigate', (e) => toGate(e, e.url));
    wc.on('will-redirect', (e) => { if (e.isMainFrame !== false) toGate(e, e.url); });
    wc.on('did-start-navigation', (e, legacyUrl, _inPlace, legacyMain) => {
      const url = typeof legacyUrl === 'string' ? legacyUrl : e.url;
      const isMain = typeof legacyMain === 'boolean' ? legacyMain : e.isMainFrame;
      if (!isMain || e.isSameDocument) return;
      const g = T().gate(url);
      if (g) setImmediate(() => { if (!wc.isDestroyed()) { wc.stop(); wc.loadURL(g).catch(() => {}); } });
    });
    // Links that open a new window become new tabs next to this one.
    wc.setWindowOpenHandler(({ url: u }) => {
      if (/^https?:/i.test(u)) T().create(u, { after: tab.id, ws: tab.ws });
      return { action: 'deny' };
    });
    return view;
  }

  // ---------------- Tab sleeping ----------------
  // Sites you've marked "never sleep" (Settings → Tabs, or Ctrl+K).
  neverSleeps(tab) {
    const never = this.store.get('sleep')?.never || [];
    try { return never.includes(new URL(tab.url).host); } catch { return false; }
  }

  // Asleep tabs can't make sound, aren't on screen, and aren't something you asked to keep awake.
  canSleep(tab) {
    if (!tab.view || tab.asleep || tab.keepAwake || this.shownTabs.includes(tab)) return false;
    const wc = tab.view.webContents;
    if (tab.audible || tab.playing || wc.isCurrentlyAudible()) return false;
    return !this.neverSleeps(tab);
  }

  // Unload the page but keep the tab (and its back/forward history).
  sleep(tab) {
    if (!this.canSleep(tab)) return false;
    const wc = tab.view.webContents;
    try {
      const nav = wc.navigationHistory;
      tab.history = { entries: nav.getAllEntries(), index: nav.getActiveIndex() };
    } catch { tab.history = null; }
    tab.pid = wc.getOSProcessId();
    try { this.win.contentView.removeChildView(tab.view); } catch { /* wasn't attached */ }
    wc.close();
    Object.assign(tab, { view: null, asleep: true, loading: false, readerable: false, audible: false, playing: false });
    return true;
  }

  // Bring the page back, exactly where it was (history included).
  wake(tab) {
    if (!tab.asleep) return;
    this.attach(tab);
    tab.asleep = false;
    tab.loading = true;
    const wc = tab.view.webContents;
    const h = tab.history;
    tab.history = null;
    const load = () => wc.loadURL(this.gate(tab.url) || tab.url).catch(() => {});
    if (h?.entries?.length) {
      Promise.resolve()
        .then(() => wc.navigationHistory.restore({ entries: h.entries, index: Math.max(0, h.index) }))
        .catch(load);
    } else load();
  }

  // Put tabs to sleep that have been out of sight for longer than `idleMs` (all of them if 0).
  sleepIdle(idleMs = 0) {
    const now = Date.now();
    const slept = this.tabs.filter((t) => now - (t.lastActive || 0) >= idleMs && this.sleep(t));
    if (slept.length) this.emit();
    return slept;
  }

  keepAwake(id, on) {
    const t = this.get(id);
    if (!t) return;
    t.keepAwake = on === undefined ? !t.keepAwake : !!on;
    this.emit();
  }

  activate(id) {
    const next = this.get(id);
    if (!next) return;
    if (next.ws !== this.currentWs) return this.switchWorkspace(next.ws, id);
    const prev = this.active;
    if (prev && prev !== next) prev.view?.webContents.stopFindInPage('clearSelection');
    this.activeId = id;
    this.ws(this.currentWs).activeId = id;
    // A tab from the split pair brings its partner along; any other tab shows on its own.
    const sp = this.split;
    const pair = sp && (id === sp.a || id === sp.b) ? [this.get(sp.a), this.get(sp.b)] : null;
    this.show(pair && pair[0] && pair[1] ? pair : [next]);
    next.view.webContents.focus();
    this.emit();
  }

  // Attach exactly these pages to the window (and detach any others).
  show(list) {
    const now = Date.now();
    for (const t of this.shownTabs) {
      if (list.includes(t)) continue;
      t.lastActive = now; // the sleep timer starts when a tab goes out of sight
      if (t.view) { try { this.win.contentView.removeChildView(t.view); } catch { /* already gone */ } }
    }
    for (const t of list) {
      if (t.asleep) this.wake(t);
      t.lastActive = now;
      this.win.contentView.addChildView(t.view);
    }
    this.shownTabs = list;
    this.layoutViews();
  }

  // Position the shown page(s): full size, or left/right with a gap for the divider.
  layoutViews() {
    const b = this.bounds;
    const list = this.shownTabs;
    if (list.length !== 2 || !this.split) { list[0]?.view.setBounds(b); return; }
    const GAP = Tabs.SPLIT_GAP, TOP = Tabs.SPLIT_TOP;
    const h = Math.max(0, b.height - TOP);
    const lw = Math.round((b.width - GAP) * this.split.ratio);
    list[0].view.setBounds({ x: b.x, y: b.y + TOP, width: Math.max(0, lw), height: h });
    list[1].view.setBounds({ x: b.x + lw + GAP, y: b.y + TOP, width: Math.max(0, b.width - lw - GAP), height: h });
  }

  // ---------------- Reader mode ----------------
  // After a page loads, quietly check whether it looks like an article (shows the reader button).
  checkReader(tab) {
    if (!/^https?:/i.test(tab.url)) return;
    Reader.isReaderable(tab.view.webContents).then((ok) => {
      if (tab.readerable !== ok) { tab.readerable = ok; tab.owner.emit(); }
    });
  }
  // Open the active tab in reader view, or go back to the original page.
  async toggleReader(tab = this.active) {
    if (!tab?.view) return false;
    const wc = tab.view.webContents;
    const original = readerOriginal(tab.url);
    if (original) {
      const nav = wc.navigationHistory;
      if (nav.canGoBack()) nav.goBack(); else wc.loadURL(original).catch(() => {});
      return true;
    }
    if (!/^https?:/i.test(tab.url)) return false;
    const key = await Reader.extract(wc);
    if (!key) return false;
    wc.loadURL(`burrow://reader/?k=${key}&u=${encodeURIComponent(tab.url)}`).catch(() => {});
    return true;
  }

  // ---------------- Split view ----------------
  // Put the current tab on the left and another tab (or the next one, or a new tab) on the right.
  splitWith(otherId) {
    const a = this.active;
    if (!a) return;
    let b = otherId === 'new' ? this.create(NEWTAB, { activate: false, after: a.id }) : this.get(otherId);
    if (!b || b === a || b.ws !== a.ws) {
      const vis = this.visible;
      const i = vis.indexOf(a);
      b = vis[i + 1] || vis[i - 1] || null;
    }
    if (!b) b = this.create(NEWTAB, { activate: false, after: a.id });
    this.split = { a: a.id, b: b.id, ratio: 0.5 };
    this.activate(a.id);
  }
  unsplit() {
    if (!this.split) return;
    this.split = null;
    this.activate(this.activeId);
  }
  swapSplit() {
    const sp = this.split;
    if (!sp) return;
    [sp.a, sp.b] = [sp.b, sp.a];
    if (this.shownTabs.length === 2) this.show([this.get(sp.a), this.get(sp.b)]);
    this.emit();
  }
  setSplitRatio(r) {
    if (!this.split) return;
    this.split.ratio = Math.max(0.2, Math.min(0.8, Number(r) || 0.5));
    this.layoutViews();
  }
  // Clicking into one side of a split makes it the active tab (address bar follows).
  focusPane(tab) {
    if (tab.owner !== this || this.activeId === tab.id || !this.shownTabs.includes(tab)) return;
    this.activeId = tab.id;
    this.ws(this.currentWs).activeId = tab.id;
    this.emit();
  }
  // Leaving split view when one of its tabs closes or moves away.
  dropFromSplit(id) {
    if (this.split && (this.split.a === id || this.split.b === id)) this.split = null;
  }

  // Closing a window's very last tab closes the window (like Chrome). keepWindow: leave a new tab
  // instead (Mochi eating your last tab shouldn't make the window vanish).
  close(id, { keepWindow = false } = {}) {
    const tab = this.get(id);
    if (!tab) return;
    if (this.tabs.length === 1 && !keepWindow && this.onEmpty) {
      if (!tab.url.startsWith('burrow://newtab')) this.closed.push({ url: tab.url, ws: tab.ws });
      this.onEmpty();
      return;
    }
    const vis = this.visible;
    const vi = vis.indexOf(tab);
    if (!tab.url.startsWith('burrow://newtab')) {
      this.closed.push({ url: tab.url, ws: tab.ws });
      if (this.closed.length > MAX_CLOSED) this.closed.shift();
    }
    const wasShown = this.shownTabs.includes(tab);
    this.dropFromSplit(id);
    this.tabs.splice(this.tabs.indexOf(tab), 1);
    if (this.activeId === id) {
      this.activeId = null;
      const neighbour = vis[vi + 1] || vis[vi - 1];
      if (neighbour) this.activate(neighbour.id);
      else this.show([]);
    } else if (wasShown) this.activate(this.activeId); // its split partner stays, on its own
    tab.view?.webContents.close();
    if (!this.visible.length) this.create(NEWTAB);
    else this.emit();
  }

  reopenClosed() {
    const last = this.closed.pop();
    if (!last) return;
    const ws = this.ws(last.ws) ? last.ws : this.currentWs;
    if (ws !== this.currentWs) this.switchWorkspace(ws);
    this.create(last.url, { ws });
  }

  // Drag to reorder: move a tab to position `to` among the visible tabs.
  move(id, to) {
    const vis = this.visible;
    const tab = this.get(id);
    const from = vis.indexOf(tab);
    if (from < 0) return;
    to = Math.max(0, Math.min(vis.length - 1, Number(to) || 0));
    if (from === to) return;
    const target = vis[to];
    this.tabs.splice(this.tabs.indexOf(tab), 1);
    const ti = this.tabs.indexOf(target);
    this.tabs.splice(to > from ? ti + 1 : ti, 0, tab);
    this.emit();
  }

  // Pull a tab out of this window (to drag it into another one). The page keeps running.
  // allowLast: the window's only tab may go (it's being dropped on another window, which then
  // closes this empty one).
  detach(id, { allowLast = false } = {}) {
    const tab = this.get(id);
    if (!tab || (this.tabs.length < 2 && !allowLast)) return null;
    const vis = this.visible;
    const vi = vis.indexOf(tab);
    const wasShown = this.shownTabs.includes(tab);
    this.dropFromSplit(id);
    this.tabs.splice(this.tabs.indexOf(tab), 1);
    if (this.activeId === id) {
      this.activeId = null;
      const neighbour = vis[vi + 1] || vis[vi - 1];
      if (neighbour) this.activate(neighbour.id);
      else this.show([]);
    } else if (wasShown) this.activate(this.activeId);
    if (this.shownTabs.includes(tab)) this.show(this.shownTabs.filter((t) => t !== tab));
    tab.view?.webContents.stopFindInPage('clearSelection');
    if (!this.tabs.length) this.emit(); // empty: the window is about to close
    else if (!this.visible.length) this.create(NEWTAB);
    else this.emit();
    return tab;
  }

  // ---------------- Tab menu actions ----------------
  duplicate(id) {
    const t = this.get(id);
    if (t) this.create(t.url, { after: t.id, ws: t.ws });
  }
  reload(id) {
    const t = this.get(id);
    if (!t) return;
    if (t.asleep || !t.view) { this.activate(t.id); return; }
    t.view.webContents.reload();
  }
  sleepTab(id) {
    const t = this.get(id);
    if (t && this.sleep(t)) this.emit();
  }
  closeOthers(id) {
    for (const t of this.visible.filter((x) => x.id !== id)) this.close(t.id);
    if (this.get(id)) this.activate(id);
  }
  closeRight(id) {
    const vis = this.visible;
    const i = vis.findIndex((t) => t.id === id);
    if (i < 0) return;
    for (const t of vis.slice(i + 1)) this.close(t.id);
  }
  // Move a tab to another workspace in this window (or a new one).
  moveToWorkspace(id, wsId) {
    const t = this.get(id);
    if (!t) return;
    let ws = wsId === 'new' ? null : this.ws(Number(wsId));
    if (wsId === 'new') {
      ws = { id: nextWsId++, name: `Space ${this.workspaces.length + 1}`, activeId: null };
      this.workspaces.push(ws);
    }
    if (!ws || ws.id === t.ws) return;
    const vis = this.visible;
    const vi = vis.indexOf(t);
    const wasShown = this.shownTabs.includes(t);
    this.dropFromSplit(id);
    t.ws = ws.id;
    ws.activeId = t.id;
    if (wasShown) this.show(this.shownTabs.filter((x) => x !== t));
    if (this.activeId === id) {
      this.activeId = null;
      const left = this.visible;
      const nb = left[Math.min(vi, left.length - 1)];
      if (nb) this.activate(nb.id);
      else this.create(NEWTAB);
    } else this.emit();
  }

  // Take in a tab dragged from another window, at visible position `at` (or the end).
  adopt(tab, at) {
    tab.owner = this;
    tab.ws = this.currentWs;
    const vis = this.visible;
    const before = at !== undefined && at !== null && vis[at] ? vis[at] : null;
    if (before) this.tabs.splice(this.tabs.indexOf(before), 0, tab);
    else this.tabs.push(tab);
    this.activate(tab.id);
  }

  activateIndex(i) {
    const vis = this.visible;
    const t = i === -1 ? vis[vis.length - 1] : vis[i];
    if (t) this.activate(t.id);
  }

  cycle(step) {
    const vis = this.visible;
    const i = vis.findIndex((t) => t.id === this.activeId);
    if (vis.length) this.activate(vis[(i + step + vis.length) % vis.length].id);
  }

  navigate(input) {
    const tab = this.active;
    if (!tab) return;
    const url = toUrl(input, this.store.get('searchEngine'));
    tab.view.webContents.loadURL(this.gate(url) || url).catch(() => {});
    tab.view.webContents.focus();
  }

  // Navigate the tab that owns a given page (used by the new-tab search box).
  navigateFrom(webContents, input) {
    const tab = this.tabs.find((t) => t.view?.webContents === webContents);
    if (!tab) return;
    const url = toUrl(input, this.store.get('searchEngine'));
    tab.view.webContents.loadURL(this.gate(url) || url).catch(() => {});
  }

  // ---------------- Zoom (remembered per site) ----------------
  static LEVELS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
  hostOf(url) { try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.host : null; } catch { return null; } }
  applyZoom(tab, url) {
    const host = this.hostOf(url);
    tab.view.webContents.setZoomFactor(host ? this.zoom.get(host) : 1);
  }
  // dir: +1 zoom in, -1 zoom out, 0 reset to 100%.
  stepZoom(dir, tab = this.active) {
    if (!tab) return;
    if (dir === 0) return this.setZoom(tab, 1);
    const cur = tab.view.webContents.getZoomFactor();
    const L = Tabs.LEVELS;
    const next = dir > 0 ? L.find((z) => z > cur + 0.001) : [...L].reverse().find((z) => z < cur - 0.001);
    if (next) this.setZoom(tab, next);
  }
  setZoom(tab, factor) {
    const host = this.hostOf(tab.url);
    // Same-site tabs follow along, like Chrome.
    for (const t of this.tabs) if (t.view && (t === tab || (host && this.hostOf(t.url) === host))) t.view.webContents.setZoomFactor(factor);
    if (host) this.zoom.set(host, factor);
    this.emit();
  }

  // ---------------- Per-tab volume (0–200%) ----------------
  siteVolume(tab) {
    try { return (this.store.get('volumes') || {})[new URL(tab.url).host]; } catch { return undefined; }
  }
  volumeOf(tab) { return tab.volume ?? this.siteVolume(tab) ?? 100; }
  async applyVolume(tab) {
    if (!tab.view) return null;
    const v = this.volumeOf(tab);
    if (v === 100 && !tab.volApplied) return null; // nothing to change yet
    tab.volApplied = true;
    const res = await Volume.apply(tab.view.webContents, v);
    tab.boostOk = res.boostOk;
    return res;
  }
  async setVolume(id, volume, remember) {
    const t = this.get(id);
    if (!t) return null;
    const v = Math.max(0, Math.min(200, Math.round(Number(volume) / 5) * 5 || 0));
    t.volume = v;
    if (remember !== undefined) {
      let host = '';
      try { host = new URL(t.url).host; } catch { /* not a website */ }
      if (host && /^https?:/.test(t.url)) {
        const all = { ...(this.store.get('volumes') || {}) };
        if (remember) all[host] = v; else delete all[host];
        this.store.set('volumes', all);
      }
    }
    const res = await this.applyVolume(t);
    this.emit();
    return { volume: v, media: res?.media ?? 0, boostOk: res?.boostOk ?? true };
  }

  toggleMute(id) {
    const t = this.get(id);
    if (!t?.view) return;
    t.view.webContents.setAudioMuted(!t.view.webContents.isAudioMuted());
    this.emit();
  }

  back() { const n = this.active?.view.webContents.navigationHistory; if (n?.canGoBack()) n.goBack(); }
  forward() { const n = this.active?.view.webContents.navigationHistory; if (n?.canGoForward()) n.goForward(); }
  reload() { this.active?.view.webContents.reload(); }
  stop() { this.active?.view.webContents.stop(); }

  setBounds(bounds) {
    this.bounds = bounds;
    this.layoutViews();
  }

  // Put the active website back on top (after the UI overlay closes).
  raiseActive() { for (const t of this.shownTabs) this.win.contentView.addChildView(t.view); }

  // Which workspace a page belongs to (so the new tab can show that workspace's links).
  workspaceOf(webContents) {
    const tab = this.tabs.find((t) => t.view?.webContents === webContents);
    const w = tab && this.ws(tab.ws);
    return w ? { id: w.id, name: w.name } : null;
  }

  burrowPages() {
    return this.tabs.filter((t) => t.view).map((t) => t.view.webContents).filter((wc) => !wc.isDestroyed() && wc.getURL().startsWith('burrow://'));
  }

  // ---------------- Workspaces ----------------
  createWorkspace(name) {
    const w = { id: nextWsId++, name: cleanName(name) || `Space ${this.workspaces.length + 1}`, activeId: null };
    this.workspaces.push(w);
    this.switchWorkspace(w.id);
    return w;
  }

  renameWorkspace(id, name) {
    const w = this.ws(id);
    const n = cleanName(name);
    if (w && n) { w.name = n; this.emit(); }
  }

  deleteWorkspace(id) {
    if (this.workspaces.length < 2 || !this.ws(id)) return;
    if (id === this.currentWs) {
      const other = this.workspaces.find((w) => w.id !== id);
      this.switchWorkspace(other.id);
    }
    for (const t of this.tabs.filter((x) => x.ws === id)) { this.dropFromSplit(t.id); t.view?.webContents.close(); }
    this.tabs = this.tabs.filter((t) => t.ws !== id);
    this.closed = this.closed.filter((c) => c.ws !== id);
    this.workspaces = this.workspaces.filter((w) => w.id !== id);
    this.emit();
  }

  switchWorkspace(id, tabId) {
    const w = this.ws(id);
    if (!w) return;
    this.show([]);
    this.activeId = null;
    this.currentWs = id;
    const target = this.get(tabId) || this.get(w.activeId) || this.visible[0];
    if (target) this.activate(target.id);
    else this.create(NEWTAB);
  }

  switchWorkspaceIndex(i) {
    const w = this.workspaces[i];
    if (w) this.switchWorkspace(w.id);
  }

  // ---------------- State + session ----------------
  state() {
    return {
      activeId: this.activeId,
      currentWs: this.currentWs,
      workspaces: this.workspaces.map((w) => ({ id: w.id, name: w.name, count: this.tabs.filter((t) => t.ws === w.id).length })),
      tabs: this.visible.map((t) => {
        const wc = t.view?.webContents;
        const nav = wc?.navigationHistory;
        return {
          id: t.id,
          // Pages without a title show their address instead of "New tab".
          title: t.url.startsWith('burrow://newtab') ? 'New tab' : (t.title && t.title !== 'New tab' ? t.title : displayUrl(t.url)),
          url: readerOriginal(t.url) || displayUrl(t.url),
          rawUrl: readerOriginal(t.url) || t.url,
          readerable: !!t.readerable,
          inReader: String(t.url).startsWith('burrow://reader') && !!readerOriginal(t.url),
          gated: String(t.url).startsWith('burrow://gate'),
          favicon: t.favicon,
          loading: t.loading,
          audible: t.audible,
          muted: wc ? wc.isAudioMuted() : false,
          media: t.media,
          zoom: wc ? Math.round(wc.getZoomFactor() * 100) : 100,
          canBack: nav ? nav.canGoBack() : false,
          canForward: nav ? nav.canGoForward() : false,
          asleep: !!t.asleep,
          insecure: insecurePage(t.url),
          volume: this.volumeOf(t),
          volumeRemembered: this.siteVolume(t) !== undefined,
          boostOk: t.boostOk !== false,
          keepAwake: !!t.keepAwake,
        };
      }),
      canReopen: this.closed.length > 0,
      // Split view as the interface needs it: which tabs pair up, and whether it's on screen now.
      split: this.split && this.get(this.split.a)?.ws === this.currentWs
        ? { a: this.split.a, b: this.split.b, ratio: this.split.ratio, shown: this.shownTabs.length === 2 }
        : null,
    };
  }

  // What gets saved for this window so it can come back after a restart.
  snapshot() {
    return {
      current: this.currentWs,
      workspaces: this.workspaces.map((w) => {
        const tabs = this.tabs.filter((t) => t.ws === w.id);
        return { id: w.id, name: w.name, tabs: tabs.map((t) => ({ url: t.url, title: t.title, favicon: t.favicon, seen: t.lastActive })), active: Math.max(0, tabs.findIndex((t) => t.id === w.activeId)) };
      }),
    };
  }

  emit() {
    if (this.persist) this.onSave(this.snapshot());
    this.onChange(this.state());
  }

  // A fresh window with one workspace and one new tab (used by private windows).
  startFresh(name, url) {
    this.workspaces.push({ id: nextWsId++, name, activeId: null });
    if (url) { this.currentWs = this.workspaces[0].id; this.create(url); return; }
    this.switchWorkspace(this.workspaces[0].id);
  }

  // A new window that starts with a tab dragged out of another window.
  startWith(name, tab) {
    this.workspaces.push({ id: nextWsId++, name, activeId: null });
    this.currentWs = this.workspaces[0].id;
    this.adopt(tab);
  }

  // Rebuild a window from its saved snapshot (see snapshot()).
  restore(s) {
    const saved = (s?.workspaces || []).filter((w) => w && typeof w.name === 'string');
    if (!saved.length) saved.push({ id: 0, name: 'Home', tabs: [], active: 0 });

    for (const w of saved) {
      // Keep saved IDs (quick links refer to them) unless another window already uses one.
      let id = Number(w.id);
      if (!id || Tabs.usedWs.has(id)) id = nextWsId;
      Tabs.usedWs.add(id);
      nextWsId = Math.max(nextWsId, id + 1);
      this.workspaces.push({ id, name: cleanName(w.name) || 'Home', activeId: null });
    }
    // Create every workspace's tabs without showing them, then switch to the saved one.
    saved.forEach((w, i) => {
      const ws = this.workspaces[i];
      // Saved tabs are { url, title, favicon } (older versions saved just the address).
      const items = (w.tabs || []).map((t) => (typeof t === 'string' ? { url: t } : t))
        .filter((t) => t && typeof t.url === 'string' && /^(https?|burrow):/i.test(t.url));
      const made = items.map((t) => this.create(t.url, {
        activate: false, ws: ws.id, asleep: true,
        title: typeof t.title === 'string' ? t.title.slice(0, 300) : undefined,
        favicon: /^https?:/i.test(t.favicon || '') ? t.favicon : null,
      }));
      // When you last looked at each tab survives restarts (tab tidy-up uses it).
      made.forEach((t, j) => { const seen = Number(items[j].seen); if (seen > 0 && seen <= Date.now()) t.lastActive = seen; });
      const pick = made[Math.min(Number(w.active) || 0, made.length - 1)];
      if (pick) ws.activeId = pick.id;
    });
    const current = this.ws(Number(s?.current)) ? Number(s.current) : this.workspaces[0].id;
    this.switchWorkspace(current);
  }
}

Tabs.SPLIT_GAP = 8; // px between the two pages (the divider lives here)
Tabs.SPLIT_TOP = 3; // px above the pages, where the active side's accent bar shows
Tabs.usedWs = new Set(); // workspace IDs already taken by some window
// Make sure new workspace IDs never collide with ones saved earlier.
Tabs.reserveWsIds = (ids) => { for (const id of ids) if (Number(id) >= nextWsId) nextWsId = Number(id) + 1; };

function cleanName(name) {
  return String(name || '').replace(/\s+/g, ' ').trim().slice(0, 24);
}

module.exports = { Tabs };
