// System messages as small toasts at the bottom left, over the page: "3 tabs closed · Undo",
// "Update ready · Restart", "Saved report.pdf · Show". Mochi stays the friendly voice in the tab strip;
// messages that matter come here instead, so they never depend on Mochi's Lively / Quiet / Off setting.
// Each window has one tiny transparent view for its toasts, sized to fit them exactly so the rest of
// the page stays clickable.
const path = require('path');
const { WebContentsView } = require('electron');

const ROOT = path.join(__dirname, '..');
const MAX = 3;                 // at most three at once; the oldest goes first
const LIFE = 5000;             // how long a toast stays
const LIFE_ACTION = 8000;      // …longer when it has a button (time to press Undo)
let nextId = 1;

class Toasts {
  constructor(bw) {
    this.bw = bw;             // the BurrowWindow
    this.view = null;
    this.ready = false;
    this.items = [];          // { id, text, kind, action, onAction, timer, life }
    this.size = { width: 0, height: 0 };
    this.hovered = false;
    this.log = [];            // everything shown, newest last (the self-test reads this)
  }

  ensure() {
    if (this.view) return;
    this.view = new WebContentsView({
      webPreferences: {
        preload: path.join(ROOT, 'preload', 'toast-preload.js'),
        contextIsolation: true, sandbox: true, nodeIntegration: false,
      },
    });
    this.view.setBackgroundColor('#00000000');
    this.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    const wc = this.view.webContents;
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', (e) => e.preventDefault());
    wc.once('did-finish-load', () => { this.ready = true; this.sendTheme(); this.push(); });
    wc.loadURL('burrow://app/ui/toast.html');
    this.bw.win.contentView.addChildView(this.view);
  }

  // kind: info | success | warning | danger. action: a button label; onAction runs when it's pressed.
  show({ text, kind = 'info', action = null, onAction = null, ms = 0 } = {}) {
    if (this.bw.win.isDestroyed()) return 0;
    const id = nextId++;
    const t = {
      id, text: String(text || '').slice(0, 200), kind: ['info', 'success', 'warning', 'danger'].includes(kind) ? kind : 'info',
      action: action ? String(action).slice(0, 24) : null, onAction, life: Number(ms) || (action ? LIFE_ACTION : LIFE),
    };
    this.items.push(t);
    this.log.push(t.text);
    if (this.log.length > 100) this.log.shift();
    while (this.items.length > MAX) this.drop(this.items[0].id);
    this.arm(t);
    this.ensure();
    this.push();
    return id;
  }

  arm(t, ms = t.life) {
    clearTimeout(t.timer);
    if (!this.hovered) t.timer = setTimeout(() => this.dismiss(t.id), ms);
  }

  drop(id) {
    const i = this.items.findIndex((x) => x.id === id);
    if (i < 0) return null;
    const [t] = this.items.splice(i, 1);
    clearTimeout(t.timer);
    return t;
  }

  dismiss(id) { if (this.drop(id)) this.push(); }

  act(id) {
    const t = this.drop(id);
    if (!t) return;
    this.push();
    try { t.onAction?.(t.id); } catch { /* the thing to undo is gone */ }
  }

  // The pointer is over a toast: hold them all until it leaves (then a few more seconds).
  hover(on) {
    this.hovered = !!on;
    for (const t of this.items) { if (on) clearTimeout(t.timer); else this.arm(t, 3000); }
  }

  push() {
    if (!this.ready || this.view.webContents.isDestroyed()) return;
    this.view.webContents.send('toasts', this.items.map(({ id, text, kind, action }) => ({ id, text, kind, action })));
    if (!this.items.length) this.setSize(0, 0);
  }

  setSize(width, height) {
    this.size = { width: Math.max(0, Math.ceil(Number(width) || 0)), height: Math.max(0, Math.ceil(Number(height) || 0)) };
    this.place();
  }

  // Bottom left of the page area (next to the tab sidebar if it's open).
  place() {
    if (!this.view || this.bw.win.isDestroyed()) return;
    const { width, height } = this.size;
    if (!width || !height || !this.items.length) { this.view.setBounds({ x: 0, y: 0, width: 0, height: 0 }); return; }
    const [W, H] = this.bw.win.getContentSize();
    const left = this.bw.full ? 0 : (this.bw.layout?.left || 0);
    this.view.setBounds({ x: left, y: Math.max(0, H - height), width: Math.min(width, Math.max(0, W - left)), height: Math.min(height, H) });
    this.raise();
  }

  // Keep the toasts above the page (menus and the palette still cover them while open).
  raise() {
    if (this.view && this.items.length && !this.bw.overlayOpen && !this.bw.win.isDestroyed()) this.bw.win.contentView.addChildView(this.view);
  }

  sendTheme(payload) {
    if (!this.ready || this.view.webContents.isDestroyed()) return;
    this.view.webContents.send('theme', payload || this.bw.ctx.themePayload(this.bw.isPrivate));
  }

  // (The self-test reads this.)
  list() { return this.items.map(({ id, text, kind, action }) => ({ id, text, kind, action })); }

  destroy() {
    this.items.forEach((t) => clearTimeout(t.timer));
    this.items = [];
    try { this.view?.webContents.close(); } catch { /* already gone */ }
  }
}

module.exports = { Toasts };
