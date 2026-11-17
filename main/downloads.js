// Downloads: saved straight to your Downloads folder (like Chrome), with progress.
const fs = require('fs');
const path = require('path');
const { app, shell } = require('electron');
const { Store } = require('./store');

const KEEP = 50;

function uniquePath(dir, name) {
  const safe = (name || 'download').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 180) || 'download';
  const ext = path.extname(safe);
  const base = safe.slice(0, safe.length - ext.length);
  let p = path.join(dir, safe);
  for (let i = 1; fs.existsSync(p); i++) p = path.join(dir, `${base} (${i})${ext}`);
  return p;
}

class Downloads {
  constructor({ session, onChange, onDone, persist = true }) {
    this.onChange = onChange || (() => {});
    this.onDone = onDone || (() => {});
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
    item.setSavePath(savePath);
    const d = {
      id, filename: path.basename(savePath), path: savePath, url: item.getURL(),
      received: 0, total: item.getTotalBytes(), state: 'progressing', started: Date.now(),
    };
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
      this.save();
      if (state === 'completed') this.onDone(d);
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

  state() { return this.list.map((d) => ({ ...d, exists: d.state !== 'completed' || fs.existsSync(d.path) })); }

  find(id) { return this.list.find((d) => d.id === Number(id)); }
  open(id) { const d = this.find(id); if (d?.state === 'completed' && fs.existsSync(d.path)) shell.openPath(d.path); }
  show(id) { const d = this.find(id); if (d && fs.existsSync(d.path)) shell.showItemInFolder(d.path); }
  cancel(id) { this.live.get(Number(id))?.cancel(); }
  pause(id) { const it = this.live.get(Number(id)); if (it) it.isPaused() ? it.resume() : it.pause(); }

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
