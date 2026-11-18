// Site permissions: camera, microphone, location and notifications are asked for (a bar under the
// toolbar: Allow / Block) and remembered per site. Private windows ask every time and remember nothing.
// Fullscreen, copying to the clipboard and pointer lock are allowed without asking; anything else is
// refused.
const SAFE = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock']);
const LABEL = { camera: 'use your camera', microphone: 'use your microphone', location: 'know your location', notifications: 'show notifications' };

// Which of our kinds an Electron permission request is about.
function kindsOf(permission, details = {}) {
  if (permission === 'media') {
    const t = details.mediaTypes || [];
    const k = [];
    if (t.includes('video')) k.push('camera');
    if (t.includes('audio')) k.push('microphone');
    return k.length ? k : ['camera', 'microphone'];
  }
  if (permission === 'geolocation') return ['location'];
  if (permission === 'notifications') return ['notifications'];
  return null;
}
const originOf = (url) => { try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.origin : null; } catch { return null; } };

class Permissions {
  /** h: { store, windowFor(webContents) → BurrowWindow | null } */
  constructor(h) {
    this.h = h;
    this.pending = new Map(); // id → { cb, origin, kinds, wc, w }
    this.nextId = 1;
  }
  saved() { return this.h.store.get('sitePerms') || {}; }

  // Hook a session (the normal one, or a private window's) up to Burrow's decisions.
  attach(ses, { isPrivate = false } = {}) {
    ses.setPermissionRequestHandler((wc, permission, cb, details) => this.request(wc, permission, cb, details, isPrivate));
    ses.setPermissionCheckHandler((wc, permission, requestingOrigin) => {
      if (SAFE.has(permission)) return true;
      const kinds = kindsOf(permission === 'media' ? 'media' : permission, {});
      if (!kinds || isPrivate) return false;
      const site = this.saved()[originOf(requestingOrigin) || ''] || {};
      return kinds.every((k) => site[k] === 'allow');
    });
  }

  request(wc, permission, cb, details, isPrivate) {
    if (SAFE.has(permission)) return cb(true);
    const kinds = kindsOf(permission, details);
    const origin = originOf(details?.requestingUrl || wc?.getURL?.());
    if (!kinds || !origin) return cb(false);
    if (!isPrivate) {
      const site = this.saved()[origin] || {};
      if (kinds.some((k) => site[k] === 'block')) return cb(false);
      if (kinds.every((k) => site[k] === 'allow')) return cb(true);
    }
    const w = this.h.windowFor(wc);
    if (!w) return cb(false);
    const id = this.nextId++;
    const tab = w.tabs.tabs.find((t) => t.view?.webContents === wc);
    this.pending.set(id, { cb, origin, kinds, wc, w, isPrivate });
    // If the page goes away (navigates, closes) before you answer, the answer is "no".
    const drop = () => this.answer(id, false, false, true);
    wc.once('did-start-navigation', drop);
    wc.once('destroyed', drop);
    w.send('perm-ask', { id, tabId: tab?.id ?? null, host: new URL(origin).host, kinds, text: kinds.map((k) => LABEL[k]).join(' and ') });
  }

  answer(id, allow, remember = true, silent = false) {
    const p = this.pending.get(Number(id));
    if (!p) return false;
    this.pending.delete(Number(id));
    if (remember && !p.isPrivate) {
      const all = { ...this.saved() };
      all[p.origin] = { ...(all[p.origin] || {}) };
      for (const k of p.kinds) all[p.origin][k] = allow ? 'allow' : 'block';
      this.h.store.set('sitePerms', all);
    }
    if (!silent || !p.w.win.isDestroyed()) p.w.send('perm-done', { id });
    try { p.cb(!!allow); } catch { /* the page is gone */ }
    return true;
  }

  // Settings → Site permissions
  list() {
    return Object.entries(this.saved()).map(([origin, kinds]) => ({ origin, host: new URL(origin).host, kinds }))
      .filter((x) => Object.keys(x.kinds).length).sort((a, b) => a.host.localeCompare(b.host));
  }
  set(origin, kind, value) {
    if (!LABEL[kind] || !originOf(origin)) return false;
    const all = { ...this.saved() };
    const site = { ...(all[origin] || {}) };
    if (value === 'allow' || value === 'block') site[kind] = value; else delete site[kind];
    if (Object.keys(site).length) all[origin] = site; else delete all[origin];
    this.h.store.set('sitePerms', all);
    return true;
  }
}

module.exports = { Permissions, SAFE, LABEL };
