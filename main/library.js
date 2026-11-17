// History and bookmarks, each saved in its own JSON file.
const { Store } = require('./store');

const MAX_HISTORY = 5000;
const isWeb = (u) => /^https?:\/\//i.test(u || '');
const words = (q) => String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
const matches = (item, ws) => ws.every((w) => (item.url + ' ' + (item.title || '')).toLowerCase().includes(w));

class Library {
  constructor({ onChange } = {}) {
    this.onChange = onChange || (() => {});
    this.historyStore = new Store('history.json', { entries: [] });
    this.bookmarkStore = new Store('bookmarks.json', { items: [], nextId: 1 });
    this.history = this.historyStore.get('entries') || [];       // newest first: { url, title, last, visits }
    this.bookmarks = this.bookmarkStore.get('items') || [];      // { id, url, title, created }
    this.byUrl = new Map(this.history.map((h) => [h.url, h]));
  }

  // ---------- History ----------
  visit(url, title) {
    if (!isWeb(url)) return;
    let h = this.byUrl.get(url);
    if (h) {
      this.history.splice(this.history.indexOf(h), 1);
      h.visits += 1;
      h.last = Date.now();
      if (title) h.title = title;
    } else {
      h = { url, title: title || '', last: Date.now(), visits: 1 };
      this.byUrl.set(url, h);
    }
    this.history.unshift(h);
    if (this.history.length > MAX_HISTORY) this.byUrl.delete(this.history.pop().url);
    this.saveHistory();
  }

  title(url, title) {
    const h = this.byUrl.get(url);
    if (h && title && h.title !== title) { h.title = title; this.saveHistory(); }
    const b = this.bookmarks.find((x) => x.url === url);
    if (b && title && !b.title) { b.title = title; this.saveBookmarks(); }
  }

  searchHistory(q, limit = 200) {
    const ws = words(q);
    return this.history.filter((h) => matches(h, ws)).slice(0, limit);
  }

  removeHistory(url) {
    const h = this.byUrl.get(url);
    if (!h) return;
    this.history.splice(this.history.indexOf(h), 1);
    this.byUrl.delete(url);
    this.saveHistory();
  }

  clearHistory() {
    this.history = [];
    this.byUrl.clear();
    this.saveHistory();
  }

  saveHistory() { this.historyStore.set('entries', this.history); this.onChange('history'); }

  // ---------- Bookmarks ----------
  isBookmarked(url) { return this.bookmarks.some((b) => b.url === url); }

  toggleBookmark(url, title, favicon) {
    if (!isWeb(url)) return false;
    const i = this.bookmarks.findIndex((b) => b.url === url);
    if (i >= 0) this.bookmarks.splice(i, 1);
    else {
      const id = this.bookmarkStore.get('nextId') || 1;
      this.bookmarkStore.set('nextId', id + 1);
      const icon = /^https?:/i.test(favicon || '') ? favicon : null;
      this.bookmarks.unshift({ id, url, title: title || url, favicon: icon, created: Date.now() });
    }
    this.saveBookmarks();
    return i < 0;
  }

  editBookmark(id, title, url) {
    const b = this.bookmarks.find((x) => x.id === id);
    if (!b) return false;
    b.title = title.trim() || url;
    b.url = url;
    this.saveBookmarks();
    return true;
  }

  removeBookmark(id) {
    this.bookmarks = this.bookmarks.filter((b) => b.id !== id);
    this.saveBookmarks();
  }

  searchBookmarks(q) {
    const ws = words(q);
    return this.bookmarks.filter((b) => matches(b, ws));
  }

  saveBookmarks() { this.bookmarkStore.set('items', this.bookmarks); this.onChange('bookmarks'); }

  // ---------- Address-bar suggestions ----------
  suggest(q, limit = 6) {
    const ws = words(q);
    if (!ws.length) return [];
    const seen = new Set();
    const out = [];
    const add = (item, kind) => {
      if (seen.has(item.url) || out.length >= limit) return;
      seen.add(item.url);
      out.push({ kind, url: item.url, title: item.title || item.url });
    };
    this.bookmarks.filter((b) => matches(b, ws)).forEach((b) => add(b, 'bookmark'));
    // History: favour frequently and recently visited pages.
    const now = Date.now();
    this.history.filter((h) => matches(h, ws))
      .map((h) => ({ h, score: h.visits * 2 + 10 / (1 + (now - h.last) / 864e5) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit * 2)
      .forEach(({ h }) => add(h, 'history'));
    return out;
  }

  flush() { this.historyStore.flush(); this.bookmarkStore.flush(); }
}

module.exports = { Library };
