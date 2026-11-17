// One Burrow window: its frame, its interface (UI view), its tabs, and its keyboard shortcuts.
// The main window saves its tabs; a private window uses a throwaway in-memory session.
const path = require('path');
const { BaseWindow, WebContentsView, session: Session } = require('electron');
const { Tabs } = require('./tabs');
const { Downloads } = require('./downloads');
const { NEWTAB } = require('./url');
const AI = require('../shared/ai');

const ROOT = path.join(__dirname, '..');
const TITLEBAR_HEIGHT = 40;
const AI_HEAD = 36;          // the AI panel's header (drawn by Burrow's interface)
const AI_MIN = 320, AI_MAX = 760;

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
    this.aiOpen = false;   // AI side panel
    this.aiView = null;
    this.aiShowing = null; // which AI the panel has loaded

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

  ownsPage(wc) { return this.tabs.tabs.some((t) => t.view?.webContents === wc); }

  relayout() {
    if (this.win.isDestroyed()) return;
    const [w, h] = this.win.getContentSize();
    const l = this.layout;
    this.ui.setBounds({ x: 0, y: 0, width: w, height: h });
    // The AI panel takes the right edge; Burrow's interface draws its header and border.
    const aiW = this.aiOpen ? this.aiWidth() : 0;
    const right = Math.max(l.right, aiW);
    this.tabs.setBounds({ x: l.left, y: l.top, width: Math.max(0, w - right - l.left), height: Math.max(0, h - l.top) });
    if (this.aiOpen && this.aiView) {
      this.aiView.setBounds({ x: w - aiW + 2, y: l.top + AI_HEAD, width: Math.max(0, aiW - 2), height: Math.max(0, h - l.top - AI_HEAD) });
    }
  }

  setLayout(l) {
    const px = (v) => Math.max(0, Math.round(Number(v) || 0));
    this.layout = { top: px(l?.top), right: px(l?.right), left: px(l?.left) };
    this.relayout();
  }

  // While a menu or suggestion list is open, the UI sits on top of the website.
  setOverlay(open) {
    if (open) this.win.contentView.addChildView(this.ui);
    else {
      this.tabs.raiseActive();
      if (this.aiOpen && this.aiView) this.win.contentView.addChildView(this.aiView);
    }
  }

  openPanel(section) { this.ui.webContents.focus(); this.send('open-panel', section); }
  focusAddress() { this.ui.webContents.focus(); this.send('focus-address'); }

  toggleBookmark() {
    const t = this.tabs.active;
    if (t) this.ctx.library.toggleBookmark(this.pageUrl(t), t.view.webContents.getTitle(), t.favicon);
  }

  // The real web address of a tab (in reader view, the article's original page).
  pageUrl(t) { return this.tabs.state().tabs.find((x) => x.id === t.id)?.rawUrl || t.url; }

  // ---------- Notes (one per website) ----------
  currentHost() {
    const t = this.tabs.active;
    if (!t) return '';
    try { const u = new URL(this.pageUrl(t)); return /^https?:$/.test(u.protocol) ? u.host : ''; } catch { return ''; }
  }

  // ---------- AI side panel ----------
  aiWidth() { return Math.max(AI_MIN, Math.min(AI_MAX, Number(this.ctx.store.get('aiWidth')) || 420)); }

  aiState() {
    const id = this.ctx.store.get('aiProvider');
    return { open: this.aiOpen, width: this.aiWidth(), provider: id, name: AI.PROVIDERS[id]?.name || 'AI' };
  }

  // Load the chosen AI in the panel (you stay signed in: it's your normal browsing session).
  loadAI(url) {
    const id = this.ctx.store.get('aiProvider');
    if (!this.aiView) {
      this.aiView = new WebContentsView({ webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
      const wc = this.aiView.webContents;
      wc.setWindowOpenHandler(({ url: u }) => { if (/^https?:/i.test(u)) this.tabs.create(u); return { action: 'deny' }; });
      wc.on('before-input-event', (e, input) => this.handleInput(e, input));
    }
    const target = url || AI.PROVIDERS[id]?.home || AI.PROVIDERS[AI.DEFAULT_PROVIDER].home;
    this.aiView.webContents.loadURL(target).catch(() => {});
    this.aiShowing = id;
  }

  setAI(open) {
    if (this.isPrivate) { this.send('mochi-say', 'The AI panel is off in private windows'); return; }
    open = open === undefined ? !this.aiOpen : !!open;
    if (open === this.aiOpen) return;
    this.aiOpen = open;
    if (open) {
      if (!this.aiView || this.aiShowing !== this.ctx.store.get('aiProvider')) this.loadAI();
      this.win.contentView.addChildView(this.aiView);
    } else if (this.aiView) {
      try { this.win.contentView.removeChildView(this.aiView); } catch { /* not attached */ }
    }
    this.send('ai-panel', this.aiState());
    this.relayout();
  }

  setAIWidth(px) {
    this.ctx.store.set('aiWidth', Math.max(AI_MIN, Math.min(AI_MAX, Math.round(Number(px) || 420))));
    this.relayout();
  }

  // The chosen AI changed in Settings: switch the open panel over.
  onAIProviderChange() {
    if (this.aiOpen && this.aiShowing !== this.ctx.store.get('aiProvider')) this.loadAI();
    this.send('ai-panel', this.aiState());
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

  // ---------- Ask AI ----------
  // Opens your AI with the question filled in. Gemini can't take a question in its address,
  // so Burrow copies it and Mochi tells you to paste it.
  ask(text, { newTab = false, pageWc = null } = {}) {
    const q = String(text || '').trim().slice(0, 2000);
    if (!q) return;
    const { url, copy } = AI.askUrl(this.ctx.store.get('aiProvider'), q);
    if (copy) {
      require('electron').clipboard.writeText(q);
      const name = AI.PROVIDERS[this.ctx.store.get('aiProvider')]?.name || 'the AI';
      this.send('mochi-say', `Question copied. Press Ctrl+V in ${name}`);
    }
    // With the AI panel open, questions go to the panel instead of a tab.
    if (this.aiOpen && !pageWc) { this.loadAI(copy ? undefined : url); return; }
    if (pageWc) this.tabs.navigateFrom(pageWc, url);
    else if (newTab) this.tabs.create(url);
    else this.tabs.navigate(url);
  }

  // Every tab in this window (all workspaces), for the Ctrl+K palette.
  allTabs() {
    return this.tabs.tabs.map((t) => ({
      id: t.id,
      title: t.url.startsWith('burrow://newtab') ? 'New tab' : (t.title || t.url),
      url: t.url.startsWith('burrow://') ? '' : t.url,
      favicon: t.favicon,
      ws: this.tabs.ws(t.ws)?.name || '',
      here: t.ws === this.tabs.currentWs,
      active: t.id === this.tabs.activeId,
    }));
  }

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
    else if (ctrl && !input.shift && k === 'k') { this.ui.webContents.focus(); this.send('palette-open'); }
    else if (ctrl && !input.shift && (k === '\\' || input.code === 'Backslash')) (tabs.split ? tabs.unsplit() : (this.ui.webContents.focus(), this.send('split-pick')));
    else if (ctrl && input.shift && k === 'a') this.setAI();
    else if (ctrl && input.shift && k === 'e') this.openPanel('notes');
    else if (input.key === 'F9') tabs.toggleReader();
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
    if (this.aiView) { try { this.aiView.webContents.close(); } catch { /* gone */ } }
    if (this.isPrivate && this.session) {
      // Belt and braces: wipe everything this private session stored.
      this.session.clearStorageData().catch(() => {});
      this.session.clearCache().catch(() => {});
    }
    this.ctx.onClosed(this);
  }
}

module.exports = { BurrowWindow };
