// Import bookmarks and history from other browsers on this computer: Chrome, Edge, Brave, Vivaldi,
// Opera (all "Chromium" browsers) and Firefox. Read-only: the other browser's files are copied to a
// temporary folder first (so it works while that browser is open), read, then the copies are deleted.
// Nothing leaves the computer. Passwords and sign-ins are not imported (see PROJECT_JOURNAL.md).
const fs = require('fs');
const os = require('os');
const path = require('path');

const HISTORY_DAYS = 90;
const MAX_HISTORY = 5000;
const CHROME_EPOCH_OFFSET_MS = 11644473600000; // Chromium counts microseconds from 1601-01-01

// Where each browser keeps its profiles (relative to %LOCALAPPDATA% or %APPDATA%).
const CHROMIUM = [
  { key: 'chrome', name: 'Chrome', base: 'local', dir: ['Google', 'Chrome', 'User Data'] },
  { key: 'edge', name: 'Edge', base: 'local', dir: ['Microsoft', 'Edge', 'User Data'] },
  { key: 'brave', name: 'Brave', base: 'local', dir: ['BraveSoftware', 'Brave-Browser', 'User Data'] },
  { key: 'vivaldi', name: 'Vivaldi', base: 'local', dir: ['Vivaldi', 'User Data'] },
  // Opera keeps one profile right in its folder (no "User Data" profiles list).
  { key: 'opera', name: 'Opera', base: 'roaming', dir: ['Opera Software', 'Opera Stable'], single: true },
  { key: 'operagx', name: 'Opera GX', base: 'roaming', dir: ['Opera Software', 'Opera GX Stable'], single: true },
];

const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const isWeb = (u) => /^https?:\/\//i.test(u || '');

// Open a copy of a SQLite file read-only; returns { db, done() }.
function openCopy(file) {
  const { DatabaseSync } = require('node:sqlite');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'burrow-import-'));
  const copy = path.join(tmp, 'db.sqlite');
  fs.copyFileSync(file, copy);
  for (const ext of ['-wal', '-journal']) if (exists(file + ext)) { try { fs.copyFileSync(file + ext, copy + ext); } catch { /* optional */ } }
  const db = new DatabaseSync(copy, { readOnly: true });
  return { db, done: () => { try { db.close(); } catch { /* closed */ } fs.rmSync(tmp, { recursive: true, force: true }); } };
}

class Importer {
  /** roots: { local, roaming } — %LOCALAPPDATA% and %APPDATA% (the self-test points these at fake profiles). */
  constructor(roots = {}) {
    this.local = roots.local || process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    this.roaming = roots.roaming || process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  }

  // ---------- What's on this computer ----------
  sources() {
    const list = [];
    for (const b of CHROMIUM) {
      const root = path.join(b.base === 'local' ? this.local : this.roaming, ...b.dir);
      if (!exists(root)) continue;
      const profiles = [];
      if (b.single) profiles.push({ dir: root, name: '' });
      else {
        const info = readJson(path.join(root, 'Local State'))?.profile?.info_cache || {};
        const dirs = new Set(Object.keys(info));
        try { for (const d of fs.readdirSync(root)) if (d === 'Default' || /^Profile \d+$/.test(d)) dirs.add(d); } catch { /* unreadable */ }
        for (const d of dirs) profiles.push({ dir: path.join(root, d), name: info[d]?.name || d });
      }
      for (const p of profiles) {
        const bookmarks = exists(path.join(p.dir, 'Bookmarks'));
        const history = exists(path.join(p.dir, 'History'));
        if (!bookmarks && !history) continue;
        list.push({
          id: `${b.key}:${path.basename(p.dir)}`, browser: b.name, profile: p.name, kind: 'chromium', dir: p.dir,
          label: p.name && profiles.length > 1 ? `${b.name} · ${p.name}` : b.name,
          bookmarks, history,
        });
      }
    }
    // Firefox: profiles.ini lists the profiles.
    const ffRoot = path.join(this.roaming, 'Mozilla', 'Firefox');
    const ini = exists(path.join(ffRoot, 'profiles.ini')) ? fs.readFileSync(path.join(ffRoot, 'profiles.ini'), 'utf8') : '';
    const sections = ini.split(/^\[/m).slice(1).map((sec) => Object.fromEntries(sec.split(/\r?\n/).slice(1).map((l) => l.split('=')).filter((kv) => kv.length >= 2).map(([k, ...v]) => [k.trim(), v.join('=').trim()])));
    const ffProfiles = sections.filter((s) => s.Path);
    for (const s of ffProfiles) {
      const dir = s.IsRelative === '0' ? s.Path : path.join(ffRoot, ...s.Path.split('/'));
      if (!exists(path.join(dir, 'places.sqlite'))) continue;
      list.push({
        id: `firefox:${path.basename(dir)}`, browser: 'Firefox', profile: s.Name || '', kind: 'firefox', dir,
        label: ffProfiles.length > 1 && s.Name ? `Firefox · ${s.Name}` : 'Firefox', bookmarks: true, history: true,
      });
    }
    return list;
  }

  // ---------- Reading one profile ----------
  // → { bookmarks: [{ url, title, folder, bar }], history: [{ url, title, last, visits }] }
  read(src, { bookmarks = true, history = true } = {}) {
    return src.kind === 'firefox' ? this.readFirefox(src, { bookmarks, history }) : this.readChromium(src, { bookmarks, history });
  }

  readChromium(src, want) {
    const out = { bookmarks: [], history: [] };
    if (want.bookmarks && src.bookmarks) {
      const roots = readJson(path.join(src.dir, 'Bookmarks'))?.roots || {};
      const walk = (node, folder, bar) => {
        if (!node) return;
        if (node.type === 'url' && isWeb(node.url)) out.bookmarks.push({ url: node.url, title: node.name || node.url, folder, bar });
        for (const c of node.children || []) walk(c, c.type === 'folder' ? [folder, c.name].filter(Boolean).join(' / ') : folder, bar);
      };
      walk(roots.bookmark_bar, '', true);
      walk(roots.other, 'Other bookmarks', false);
      walk(roots.synced, 'Mobile bookmarks', false);
    }
    if (want.history && src.history) {
      const { db, done } = openCopy(path.join(src.dir, 'History'));
      try {
        // (These numbers are too big for ordinary JavaScript numbers, so they're read as BigInts.)
        const since = BigInt(Math.round(Date.now() - HISTORY_DAYS * 864e5 + CHROME_EPOCH_OFFSET_MS)) * 1000n;
        const stmt = db.prepare('SELECT url, title, last_visit_time AS t, visit_count AS n FROM urls WHERE hidden = 0 AND last_visit_time > ? ORDER BY last_visit_time DESC LIMIT ?');
        stmt.setReadBigInts(true);
        const rows = stmt.all(since, MAX_HISTORY);
        for (const r of rows) if (isWeb(r.url)) out.history.push({ url: r.url, title: r.title || '', last: Number(BigInt(r.t) / 1000n) - CHROME_EPOCH_OFFSET_MS, visits: Number(r.n) || 1 });
      } finally { done(); }
    }
    return out;
  }

  readFirefox(src, want) {
    const out = { bookmarks: [], history: [] };
    const { db, done } = openCopy(path.join(src.dir, 'places.sqlite'));
    try {
      if (want.bookmarks) {
        const folders = new Map(db.prepare('SELECT id, parent, title, guid FROM moz_bookmarks WHERE type = 2').all().map((f) => [f.id, f]));
        const ROOTS = { toolbar_____: { bar: true, label: '' }, menu________: { bar: false, label: 'Bookmarks menu' }, unfiled_____: { bar: false, label: 'Other bookmarks' }, mobile______: { bar: false, label: 'Mobile bookmarks' } };
        const where = (parentId) => {
          const names = [];
          let f = folders.get(parentId);
          while (f && !ROOTS[f.guid] && f.guid !== 'root________') { if (f.title) names.unshift(f.title); f = folders.get(f.parent); }
          const root = f ? ROOTS[f.guid] : null;
          return { bar: !!root?.bar, folder: [root?.label, ...names].filter(Boolean).join(' / ') };
        };
        const rows = db.prepare('SELECT b.title AS title, b.parent AS parent, p.url AS url FROM moz_bookmarks b JOIN moz_places p ON p.id = b.fk WHERE b.type = 1 ORDER BY b.parent, b.position').all();
        for (const r of rows) if (isWeb(r.url)) out.bookmarks.push({ url: r.url, title: r.title || r.url, ...where(r.parent) });
      }
      if (want.history) {
        const since = (Date.now() - HISTORY_DAYS * 864e5) * 1000;
        const rows = db.prepare('SELECT url, title, last_visit_date AS t, visit_count AS n FROM moz_places WHERE hidden = 0 AND last_visit_date > ? ORDER BY last_visit_date DESC LIMIT ?').all(since, MAX_HISTORY);
        for (const r of rows) if (isWeb(r.url)) out.history.push({ url: r.url, title: r.title || '', last: Math.round(Number(r.t) / 1000), visits: Number(r.n) || 1 });
      }
    } finally { done(); }
    return out;
  }

  // Quick counts for the list ("312 bookmarks · 4,210 pages").
  preview(src) {
    try {
      const d = this.read(src);
      return { bookmarks: d.bookmarks.length, history: d.history.length };
    } catch { return { bookmarks: 0, history: 0, error: true }; }
  }
}

// Most-visited sites (one per website) — offered as quick links.
function topSites(history, n = 4) {
  const bySite = new Map();
  for (const h of history) {
    let u;
    try { u = new URL(h.url); } catch { continue; }
    const key = u.host.replace(/^www\./, '');
    const cur = bySite.get(key) || { url: `${u.protocol}//${u.host}/`, name: key, visits: 0 };
    cur.visits += h.visits;
    bySite.set(key, cur);
  }
  return [...bySite.values()].sort((a, b) => b.visits - a.visits).slice(0, n)
    .map((s) => ({ url: s.url, name: s.name.split('.').slice(-2, -1)[0]?.replace(/^./, (c) => c.toUpperCase()) || s.name }));
}

module.exports = { Importer, topSites };
