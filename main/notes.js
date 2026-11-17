// Notes: one note per website (by its host, e.g. "moodle.college.edu"), saved in notes.json.
const fs = require('fs');
const { Store } = require('./store');

const MAX_NOTE = 50000; // characters

class Notes {
  constructor({ onChange } = {}) {
    this.store = new Store('notes.json', { items: {} });
    this.items = this.store.get('items') || {}; // host -> { text, updated }
    this.onChange = onChange || (() => {});
  }

  get(host) { return this.items[host]?.text || ''; }

  set(host, text) {
    if (!host) return;
    const t = String(text || '').slice(0, MAX_NOTE);
    if (t.trim()) this.items[host] = { text: t, updated: Date.now() };
    else delete this.items[host]; // an emptied note is removed
    this.store.set('items', this.items);
    this.onChange(host);
  }

  // Every note, newest first: [{ host, text, updated }]
  all() {
    return Object.entries(this.items)
      .map(([host, n]) => ({ host, text: n.text, updated: n.updated }))
      .sort((a, b) => b.updated - a.updated);
  }

  // All notes as one Markdown document.
  markdown() {
    const date = (ts) => new Date(ts).toISOString().slice(0, 10);
    const parts = ['# Burrow notes', '', `_Exported ${date(Date.now())}_`, ''];
    for (const n of this.all()) parts.push(`## ${n.host}`, `_Updated ${date(n.updated)}_`, '', n.text.trim(), '');
    return parts.join('\n');
  }

  async exportTo(filePath) {
    await fs.promises.writeFile(filePath, this.markdown(), 'utf8');
  }

  flush() { this.store.flush(); }
}

module.exports = { Notes };
