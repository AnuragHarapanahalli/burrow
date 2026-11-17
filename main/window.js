// One Burrow window: its frame, its interface (UI view), its tabs, and its keyboard shortcuts.
// The main window saves its tabs; a private window uses a throwaway in-memory session.
const path = require('path');
const { BaseWindow, WebContentsView, session: Session } = require('electron');
const { Tabs } = require('./tabs');
const { Downloads } = require('./downloads');
const { NEWTAB } = require('./url');

const ROOT = path.join(__dirname, '..');
const TITLEBAR_HEIGHT = 40;

// Finds the biggest video on the page and pops it out (or brings it back).
const PIP_SCRIPT = `(async () => {
  if (document.pictureInPictureElement) { await document.exitPictureInPicture(); return 'exit'; }
  const vids = [...document.querySelectorAll('video')].filter((v) => v.readyState > 0 && !v.disablePictureInPicture)
    .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);
  const v = vids.find((x) => !x.paused) || vids[0];
  if (!v) return 'none';
  await v.requestPictureInPicture();
  return 'ok';
})()`;

let privateCount = 0;

class BurrowWindow {
  /**
   * ctx: app-wide services from main.js
   *   store, library, mainDownloads, themePayload(isPrivate), setPrefs(patch),
   *   setupSession(session), openPrivate(), openWindow(), saveSession(win, snapshot), onClosed(win)
   * opts: isPrivate, snapshot (saved tabs to restore), adoptTab (a tab dragged out of another window), bounds
   */
  constructor(ctx, { isPrivate = false, snapshot = null, adoptTab = null, bounds = null } = {}) {
    this.ctx = ctx;
    this.isPrivate = isPrivate;
    this.layout = { top: 80, right: 0, left: 0 };

    if (isPrivate) {
      // A brand-new in-memory session: cookies, logins and cache vanish when the window closes.
      this.session = Session.fromPartition(`burrow-private-${Date.now()}-${++privateCount}`);
      ctx.setupSession(this.session);
      this.downloads = new Downloads({
        session: this.session, persist: false,
        onChange: (list) => this.send('downloads', list),
        onDone: (d) => this.send('download-done', d),
      });
    } else {
      this.session = null; // default session
      this.downloads = ctx.mainDownloads;
    }

    const { tokens } = ctx.themePayload(isPrivate);
    this.win = new BaseWindow({
      width: 1280, height: 820, minWidth: 640, minHeight: 420,
      ...(bounds || {}),
      title: isPrivate ? 'Burrow (private)' : 'Burrow',
      show: false,
      backgroundColor: tokens.bg,
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: tokens.bg, symbolColor: tokens.fg, height: TITLEBAR_HEIGHT - 2 },
    });

    this.ui = new WebContentsView({
      webPreferences: {
        preload: path.join(ROOT, 'preload', 'ui-preload.js'),
        contextIsolation: true, sandbox: true, nodeIntegration: false,
      },
    });
    this.ui.setBackgroundColor('#00000000'); // transparent below the chrome, so menus can float over pages
    this.win.contentView.addChildView(this.ui);
    const uwc = this.ui.webContents;
    uwc.on('before-input-event', (e, input) => this.handleInput(e, input));
    uwc.setWindowOpenHandler(() => ({ action: 'deny' }));
    uwc.on('will-navigate', (e) => e.preventDefault()); // the UI page never navigates away
    uwc.once('did-finish-load', () => this.win.show());
    uwc.loadURL('burrow://app/ui/index.html');

    const { store, library } = ctx;
    this.tabs = new Tabs({
      win: this.win, store, session: this.session, persist: !isPrivate,
      zoom: {
        get: (host) => (store.get('zoom') || {})[host] || 1,
        // Private windows can use your saved zoom levels but don't save new ones.
        set: (host, f) => {
          if (isPrivate) return;
          const z = { ...(store.get('zoom') || {}) };
          if (Math.abs(f - 1) < 0.001) delete z[host]; else z[host] = f;
          store.set('zoom', z);
        },
      },
      onInput: (e, input) => this.handleInput(e, input),
      onChange: (state) => this.sendTabs(state),
      onSave: (snap) => ctx.saveSession(this, snap),
      // Private windows leave no history.
      onVisit: (url, title) => { if (!isPrivate) library.visit(url, title); },
      onTitle: (url, title) => { if (!isPrivate) library.title(url, title); },
    });
    this.tabs.onFind = (r) => this.send('find-result', { active: r.activeMatchOrdinal, matches: r.matches });

    this.relayout();
    if (isPrivate) this.tabs.startFresh('Private');
    else if (adoptTab) this.tabs.startWith('Home', adoptTab);
    else if (snapshot) this.tabs.restore(snapshot);
    else this.tabs.startFresh('Home');

    ['resize', 'maximize', 'unmaximize', 'restore', 'enter-full-screen', 'leave-full-screen']
      .forEach((ev) => this.win.on(ev, () => this.relayout()));
    this.win.on('closed', () => this.onClosed());
  }

  // ---------- Messages to this window's interface ----------
  send(channel, data) {
    const wc = this.ui?.webContents;
    if (wc && !wc.isDestroyed()) wc.send(channel, data);
  }

  sendTabs(state = this.tabs.state()) {
    state.tabs.forEach((t) => { t.bookmarked = this.ctx.library.isBookmarked(t.rawUrl); });
    state.tabsMode = this.ctx.store.get('tabsMode');
    state.isPrivate = this.isPrivate;
    this.send('tabs', state);
  }

  sendBookmarks() {
    this.send('bookmarks', this.ctx.library.bookmarks.slice(0, 100).map(({ id, url, title, favicon }) => ({ id, url, title, favicon })));
  }

  applyTheme() {
    const payload = this.ctx.themePayload(this.isPrivate);
    if (!this.win.isDestroyed() && process.platform !== 'darwin') {
      this.win.setTitleBarOverlay({ color: payload.tokens.bg, symbolColor: payload.tokens.fg, height: TITLEBAR_HEIGHT - 2 });
      this.win.setBackgroundColor(payload.tokens.bg);
    }
    this.send('theme', payload);
    this.tabs.burrowPages().forEach((wc) => wc.send('theme', this.pagePayload(wc, payload)));
  }

  // Burrow's own pages also get the app version, their workspace, and whether they're private.
  pagePayload(wc, base = this.ctx.themePayload(this.isPrivate)) {
    return {
      ...base,
      version: require('electron').app.getVersion(),
      workspace: this.isPrivate ? null : this.tabs.workspaceOf(wc),
      workspaces: this.isPrivate ? [] : this.tabs.workspaces.map((w) => ({ id: w.id, name: w.name })),
    };
  }

  ownsPage(wc) { return this.tabs.tabs.some((t) => t.view.webContents === wc); }

  relayout() {
    if (this.win.isDestroyed()) return;
    const [w, h] = this.win.getContentSize();
    const l = this.layout;
    this.ui.setBounds({ x: 0, y: 0, width: w, height: h });
    this.tabs.setBounds({ x: l.left, y: l.top, width: Math.max(0, w - l.right - l.left), height: Math.max(0, h - l.top) });
  }

  setLayout(l) {
    const px = (v) => Math.max(0, Math.round(Number(v) || 0));
    this.layout = { top: px(l?.top), right: px(l?.right), left: px(l?.left) };
    this.relayout();
  }

  // While a menu or suggestion list is open, the UI sits on top of the website.
  setOverlay(open) {
    if (open) this.win.contentView.addChildView(this.ui);
    else this.tabs.raiseActive();
  }

  openPanel(section) { this.ui.webContents.focus(); this.send('open-panel', section); }
  focusAddress() { this.ui.webContents.focus(); this.send('focus-address'); }

  toggleBookmark() {
    const t = this.tabs.active;
    if (t) this.ctx.library.toggleBookmark(t.url, t.view.webContents.getTitle(), t.favicon);
  }

  // ---------- Find in page ----------
  find({ text, forward = true, findNext = false, matchCase = false } = {}) {
    const wc = this.tabs.active?.view.webContents;
    if (!wc) return;
    const q = String(text || '').slice(0, 500);
    if (!q) { wc.stopFindInPage('clearSelection'); this.send('find-result', { active: 0, matches: 0 }); return; }
    wc.findInPage(q, { forward: !!forward, findNext: !!findNext, matchCase: !!matchCase });
  }
  stopFind() { this.tabs.active?.view.webContents.stopFindInPage('clearSelection'); }

  // ---------- Picture-in-picture ----------
  async pip() {
    const wc = this.tabs.active?.view.webContents;
    if (!wc) return 'none';
    try { return await wc.executeJavaScript(PIP_SCRIPT, true); } catch { return 'none'; }
  }

  // ---------- Keyboard shortcuts (work in the UI and inside websites) ----------
  handleInput(event, input) {
    if (input.type !== 'keyDown') return;
    const { tabs, ctx } = this;
    const ctrl = input.control || input.meta;
    const k = input.key.toLowerCase();
    const digit = /^Digit([1-9])$/.exec(input.code || '');
    let handled = true;
    if (ctrl && !input.shift && k === 't') tabs.create(NEWTAB);
    else if (ctrl && input.shift && k === 't') tabs.reopenClosed();
    else if (ctrl && input.shift && k === 'n') ctx.openPrivate();
    else if (ctrl && !input.shift && k === 'n') ctx.openWindow();
    else if (ctrl && input.shift && digit && !this.isPrivate) tabs.switchWorkspaceIndex(Number(digit[1]) - 1);
    else if (ctrl && !input.shift && k === 'd') this.toggleBookmark();
    else if (ctrl && !input.shift && k === 'h') this.openPanel('history');
    else if (ctrl && !input.shift && k === 'j') this.openPanel('downloads');
    else if (ctrl && input.shift && k === 'o') this.openPanel('bookmarks');
    else if (ctrl && input.shift && k === 'b') ctx.setPrefs({ bookmarksBar: !ctx.store.get('bookmarksBar') });
    else if (ctrl && !input.shift && k === 'f') { this.ui.webContents.focus(); this.send('find-open'); }
    else if (input.key === 'F3') this.send('find-step', input.shift ? -1 : 1);
    else if (ctrl && (k === '=' || k === '+') ) tabs.stepZoom(1);
    else if (ctrl && (k === '-' || k === '_')) tabs.stepZoom(-1);
    else if (ctrl && k === '0') tabs.stepZoom(0);
    else if (ctrl && k === 'w') tabs.close(tabs.activeId);
    else if (ctrl && k === 'l') this.focusAddress();
    else if (ctrl && k === 'tab') tabs.cycle(input.shift ? -1 : 1);
    else if (ctrl && !input.shift && /^[1-8]$/.test(k)) tabs.activateIndex(Number(k) - 1);
    else if (ctrl && !input.shift && k === '9') tabs.activateIndex(-1);
    else if ((ctrl && k === 'r') || input.key === 'F5') tabs.reload();
    else if (input.alt && input.key === 'ArrowLeft') tabs.back();
    else if (input.alt && input.key === 'ArrowRight') tabs.forward();
    else if (input.key === 'F12') tabs.active?.view.webContents.toggleDevTools();
    else handled = false;
    if (handled) event.preventDefault();
  }

  onClosed() {
    if (this.isPrivate && this.session) {
      // Belt and braces: wipe everything this private session stored.
      this.session.clearStorageData().catch(() => {});
      this.session.clearCache().catch(() => {});
    }
    this.ctx.onClosed(this);
  }
}

module.exports = { BurrowWindow };
