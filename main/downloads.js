// Downloads: saved straight to your Downloads folder (like Chrome), with progress.
const fs = require('fs');
const path = require('path');
const { app, shell } = require('electron');
const { Store } = require('./store');

const KEEP = 50;
// Files that can run code on your computer. They download under a temporary name and only get their
// real name once you press Keep (Discard deletes them).
const RISKY = new Set(['.exe', '.msi', '.msix', '.appx', '.bat', '.cmd', '.com', '.scr', '.pif', '.cpl', '.ps1', '.psm1',
  '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.hta', '.jar', '.reg', '.lnk', '.dll', '.sys', '.inf']);
const isRisky = (file) => RISKY.has(path.extname(file).toLowerCase());

function uniquePath(dir, name) {
  const safe = (name || 'download').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 180) || 'download';
  const ext = path.extname(safe);
  const base = safe.slice(0, safe.length - ext.length);
  let p = path.join(dir, safe);
  for (let i = 1; fs.existsSync(p); i++) p = path.join(dir, `${base} (${i})${ext}`);
  return p;
}

class Downloads {
  constructor({ session, onChange, onDone, onRisky, persist = true }) {
    this.onChange = onChange || (() => {});
    this.onDone = onDone || (() => {});
    this.onRisky = onRisky || (() => {});
    // Private windows keep their download list in memory only.
    this.store = persist ? new Store('downloads.json', { items: [], nextId: 1 }) : memoryStore();
    // Finished downloads from earlier sessions (in-progress ones can't survive a restart).
    this.list = (this.store.get('items') || []).map((d) => (d.state === 'progressing' ? { ...d, state: 'interrupted' } : d));
    this.live = new Map(); // id -> DownloadItem
    this.throttle = null;
    session.on('will-download', (_e, item) => this.track(item));
  }

  track(item) {
    const id = this.store.get('nextId') || 1;
    this.store.set('nextId', id + 1);
    const savePath = uniquePath(app.getPath('downloads'), item.getFilename());
    const held = isRisky(savePath);
    item.setSavePath(held ? savePath + '.unconfirmed' : savePath);
    const d = {
      id, filename: path.basename(savePath), path: savePath, url: item.getURL(),
      received: 0, total: item.getTotalBytes(), state: 'progressing', started: Date.now(),
      held, tmp: held ? savePath + '.unconfirmed' : null,
    };
    if (held) setImmediate(() => this.onRisky(d));
    this.list.unshift(d);
    this.live.set(id, item);
    item.on('updated', (_e, state) => {
      d.received = item.getReceivedBytes();
      d.total = item.getTotalBytes();
      d.state = state === 'interrupted' ? 'interrupted' : item.isPaused() ? 'paused' : 'progressing';
      this.emitSoon();
    });
    item.once('done', (_e, state) => {
      d.received = item.getReceivedBytes();
      d.state = state; // completed | cancelled | interrupted
      this.live.delete(id);
      if (state === 'completed' && !d.held) { this.finalize(d); this.onDone(d); }
      this.save();
    });
    this.save();
  }

  emitSoon() {
    if (this.throttle) return;
    this.throttle = setTimeout(() => { this.throttle = null; this.onChange(this.state()); }, 250);
  }

  save() {
    this.list = this.list.slice(0, KEEP);
    this.store.set('items', this.list);
    this.onChange(this.state());
  }

  state() { return this.list.map((d) => ({ ...d, exists: d.state !== 'completed' || (d.held ? !!d.tmp && fs.existsSync(d.tmp) : fs.existsSync(d.path)) })); }

  find(id) { return this.list.find((d) => d.id === Number(id)); }
  open(id) { const d = this.find(id); if (d?.state === 'completed' && !d.held && fs.existsSync(d.path)) shell.openPath(d.path); }
  show(id) { const d = this.find(id); if (d && !d.held && fs.existsSync(d.path)) shell.showItemInFolder(d.path); }

  // A risky file: give it its real name (it may still be downloading — then that happens when it's done).
  finalize(d) {
    if (d.tmp && fs.existsSync(d.tmp)) {
      if (fs.existsSync(d.path)) d.path = uniquePath(path.dirname(d.path), d.filename);
      fs.renameSync(d.tmp, d.path);
      d.filename = path.basename(d.path);
    }
    d.tmp = null;
  }
  keep(id) {
    const d = this.find(id);
    if (!d?.held) return;
    d.held = false;
    if (d.state === 'completed') { this.finalize(d); this.onDone(d); }
    this.save();
  }
  discard(id) {
    const d = this.find(id);
    if (!d?.held) return;
    const item = this.live.get(d.id);
    d.held = false;
    d.state = 'discarded';
    if (item) item.cancel();
    else if (d.tmp) fs.rmSync(d.tmp, { force: true });
    d.tmp = null;
    this.save();
  }
  cancel(id) { this.live.get(Number(id))?.cancel(); }
  pause(id) { const it = this.live.get(Number(id)); if (it) it.isPaused() ? it.resume() : it.pause(); }

  // Clear browsing data: forget finished downloads started since a moment (the files stay on disk).
  clearSince(since) {
    const before = this.list.length;
    this.list = this.list.filter((d) => this.live.has(d.id) || d.started < since);
    this.save();
    return before - this.list.length;
  }

  clear() {
    this.list = this.list.filter((d) => this.live.has(d.id));
    this.save();
  }

  flush() { this.store.flush(); }
}

function memoryStore() {
  const data = { items: [], nextId: 1 };
  return { get: (k) => data[k], set: (k, v) => { data[k] = v; }, flush() {} };
}

module.exports = { Downloads };
