// Tab manager. Each tab is a WebContentsView showing one website.
// Tabs belong to a workspace (Home, College, ...); only the current workspace's tabs are shown.
const path = require('path');
const { WebContentsView } = require('electron');
const { toUrl, displayUrl, NEWTAB } = require('./url');

const MAX_CLOSED = 25;
// IDs are unique across every window, so a tab can move between windows without clashing.
let nextTabId = 1;
let nextWsId = 1;

class Tabs {
  constructor({ win, store, session, persist = true, zoom, onChange, onInput, onVisit, onTitle, onSave }) {
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
    this.closed = [];         // recently closed: { url, ws }
    this.bounds = { x: 0, y: 80, width: 800, height: 600 };
  }

  // ---------------- Tabs ----------------
  get visible() { return this.tabs.filter((t) => t.ws === this.currentWs); }
  get(id) { return this.tabs.find((t) => t.id === id); }
  get active() { return this.get(this.activeId); }
  ws(id) { return this.workspaces.find((w) => w.id === id); }

  create(url = NEWTAB, { activate = true, after, ws = this.currentWs } = {}) {
    const view = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'tab-preload.js'),
        contextIsolation: true, sandbox: true, nodeIntegration: false,
        ...(this.session ? { session: this.session } : {}),
      },
    });
    const tab = { id: nextTabId++, ws, view, title: 'New tab', url, favicon: null, loading: true, audible: false, media: false, owner: this };
    const wc = view.webContents;
    // Listeners always talk to the tab's *current* owner, because a tab can be dragged to another window.
    const T = () => tab.owner;

    const update = (patch) => { Object.assign(tab, patch); T().emit(); };
    wc.on('page-title-updated', (_e, title) => { update({ title }); T().onTitle(tab.url, title); });
    wc.on('page-favicon-updated', (_e, icons) => update({ favicon: icons[0] || null }));
    wc.on('did-start-loading', () => update({ loading: true }));
    wc.on('did-stop-loading', () => update({ loading: false }));
    wc.on('did-navigate', (_e, u) => {
      T().applyZoom(tab, u);
      update({ url: u, favicon: null, media: false });
      T().onVisit(u, wc.getTitle());
    });
    // Sound + video: a speaker on the tab, and the picture-in-picture button.
    wc.on('audio-state-changed', (e) => update({ audible: !!e.audible }));
    wc.on('media-started-playing', () => update({ media: true }));
    wc.on('media-paused', () => update({}));
    // Ctrl + mouse wheel zooms, like other browsers.
    wc.on('zoom-changed', (_e, dir) => T().stepZoom(dir === 'in' ? 1 : -1, tab));
    wc.on('found-in-page', (_e, r) => { if (tab.id === T().activeId) T().onFind?.(r); });
    wc.on('did-navigate-in-page', (_e, u, isMain) => {
      if (!isMain) return;
      update({ url: u });
      T().onVisit(u, wc.getTitle());
    });
    wc.on('before-input-event', (e, input) => T().onInput(e, input));
    // Links that open a new window become new tabs next to this one.
    wc.setWindowOpenHandler(({ url: u }) => {
      if (/^https?:/i.test(u)) T().create(u, { after: tab.id, ws: tab.ws });
      return { action: 'deny' };
    });

    const at = after ? this.tabs.findIndex((t) => t.id === after) : -1;
    if (at >= 0) this.tabs.splice(at + 1, 0, tab);
    else this.tabs.push(tab);
    wc.loadURL(url).catch(() => {});
    if (activate && ws === this.currentWs) this.activate(tab.id);
    else this.emit();
    return tab;
  }

  activate(id) {
    const next = this.get(id);
    if (!next) return;
    if (next.ws !== this.currentWs) return this.switchWorkspace(next.ws, id);
    const prev = this.active;
    if (prev && prev !== next) {
      prev.view.webContents.stopFindInPage('clearSelection');
      this.win.contentView.removeChildView(prev.view);
    }
    this.activeId = id;
    this.ws(this.currentWs).activeId = id;
    this.win.contentView.addChildView(next.view);
    next.view.setBounds(this.bounds);
    next.view.webContents.focus();
    this.emit();
  }

  close(id) {
    const tab = this.get(id);
    if (!tab) return;
    const vis = this.visible;
    const vi = vis.indexOf(tab);
    if (!tab.url.startsWith('burrow://newtab')) {
      this.closed.push({ url: tab.url, ws: tab.ws });
      if (this.closed.length > MAX_CLOSED) this.closed.shift();
    }
    this.tabs.splice(this.tabs.indexOf(tab), 1);
    if (this.activeId === id) {
      this.win.contentView.removeChildView(tab.view);
      this.activeId = null;
      const neighbour = vis[vi + 1] || vis[vi - 1];
      if (neighbour) this.activate(neighbour.id);
    }
    tab.view.webContents.close();
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
  detach(id) {
    const tab = this.get(id);
    if (!tab || this.tabs.length < 2) return null; // a window's very last tab stays put
    const vis = this.visible;
    const vi = vis.indexOf(tab);
    this.tabs.splice(this.tabs.indexOf(tab), 1);
    if (this.activeId === id) {
      this.win.contentView.removeChildView(tab.view);
      this.activeId = null;
      const neighbour = vis[vi + 1] || vis[vi - 1];
      if (neighbour) this.activate(neighbour.id);
    }
    tab.view.webContents.stopFindInPage('clearSelection');
    if (!this.visible.length) this.create(NEWTAB);
    else this.emit();
    return tab;
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
    tab.view.webContents.loadURL(toUrl(input, this.store.get('searchEngine'))).catch(() => {});
    tab.view.webContents.focus();
  }

  // Navigate the tab that owns a given page (used by the new-tab search box).
  navigateFrom(webContents, input) {
    const tab = this.tabs.find((t) => t.view.webContents === webContents);
    if (tab) tab.view.webContents.loadURL(toUrl(input, this.store.get('searchEngine'))).catch(() => {});
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
    for (const t of this.tabs) if (t === tab || (host && this.hostOf(t.url) === host)) t.view.webContents.setZoomFactor(factor);
    if (host) this.zoom.set(host, factor);
    this.emit();
  }

  toggleMute(id) {
    const t = this.get(id);
    if (!t) return;
    t.view.webContents.setAudioMuted(!t.view.webContents.isAudioMuted());
    this.emit();
  }

  back() { const n = this.active?.view.webContents.navigationHistory; if (n?.canGoBack()) n.goBack(); }
  forward() { const n = this.active?.view.webContents.navigationHistory; if (n?.canGoForward()) n.goForward(); }
  reload() { this.active?.view.webContents.reload(); }
  stop() { this.active?.view.webContents.stop(); }

  setBounds(bounds) {
    this.bounds = bounds;
    this.active?.view.setBounds(bounds);
  }

  // Put the active website back on top (after the UI overlay closes).
  raiseActive() { if (this.active) this.win.contentView.addChildView(this.active.view); }

  // Which workspace a page belongs to (so the new tab can show that workspace's links).
  workspaceOf(webContents) {
    const tab = this.tabs.find((t) => t.view.webContents === webContents);
    const w = tab && this.ws(tab.ws);
    return w ? { id: w.id, name: w.name } : null;
  }

  burrowPages() {
    return this.tabs.map((t) => t.view.webContents).filter((wc) => !wc.isDestroyed() && wc.getURL().startsWith('burrow://'));
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
    for (const t of this.tabs.filter((x) => x.ws === id)) t.view.webContents.close();
    this.tabs = this.tabs.filter((t) => t.ws !== id);
    this.closed = this.closed.filter((c) => c.ws !== id);
    this.workspaces = this.workspaces.filter((w) => w.id !== id);
    this.emit();
  }

  switchWorkspace(id, tabId) {
    const w = this.ws(id);
    if (!w) return;
    if (this.active) this.win.contentView.removeChildView(this.active.view);
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
        const nav = t.view.webContents.navigationHistory;
        return {
          id: t.id,
          // Pages without a title show their address instead of "New tab".
          title: t.url.startsWith('burrow://newtab') ? 'New tab' : (t.title && t.title !== 'New tab' ? t.title : displayUrl(t.url)),
          url: displayUrl(t.url),
          rawUrl: t.url,
          favicon: t.favicon,
          loading: t.loading,
          audible: t.audible,
          muted: t.view.webContents.isAudioMuted(),
          media: t.media,
          zoom: Math.round(t.view.webContents.getZoomFactor() * 100),
          canBack: nav.canGoBack(),
          canForward: nav.canGoForward(),
        };
      }),
      canReopen: this.closed.length > 0,
    };
  }

  // What gets saved for this window so it can come back after a restart.
  snapshot() {
    return {
      current: this.currentWs,
      workspaces: this.workspaces.map((w) => {
        const tabs = this.tabs.filter((t) => t.ws === w.id);
        return { id: w.id, name: w.name, tabs: tabs.map((t) => t.url), active: Math.max(0, tabs.findIndex((t) => t.id === w.activeId)) };
      }),
    };
  }

  emit() {
    if (this.persist) this.onSave(this.snapshot());
    this.onChange(this.state());
  }

  // A fresh window with one workspace and one new tab (used by private windows).
  startFresh(name) {
    this.workspaces.push({ id: nextWsId++, name, activeId: null });
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
      const urls = (w.tabs || []).filter((u) => typeof u === 'string' && /^(https?|burrow):/i.test(u));
      const made = urls.map((u) => this.create(u, { activate: false, ws: ws.id }));
      const pick = made[Math.min(Number(w.active) || 0, made.length - 1)];
      if (pick) ws.activeId = pick.id;
    });
    const current = this.ws(Number(s?.current)) ? Number(s.current) : this.workspaces[0].id;
    this.switchWorkspace(current);
  }
}

Tabs.usedWs = new Set(); // workspace IDs already taken by some window
// Make sure new workspace IDs never collide with ones saved earlier.
Tabs.reserveWsIds = (ids) => { for (const id of ids) if (Number(id) >= nextWsId) nextWsId = Number(id) + 1; };

function cleanName(name) {
  return String(name || '').replace(/\s+/g, ' ').trim().slice(0, 24);
}

module.exports = { Tabs };
