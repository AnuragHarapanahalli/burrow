// Tiny JSON stores saved in the user's app-data folder.
// Writes go to a temp file first, then rename, so a crash can't corrupt the file.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const SETTINGS_DEFAULTS = {
  theme: { seed: '#E63027', mode: 'system', useWindowsAccent: false, grid: false },
  tabsMode: 'auto', // 'auto' (top, sidebar beyond 8 tabs) | 'top' | 'side'
  session: null,
  searchEngine: 'google',
  searchChosen: false,   // the user hasn't picked an engine yet (new tab asks once)
  bookmarksBar: true,
  onboarded: false,
  sleep: { on: true, minutes: 30, never: [] }, // tab sleeping: unload tabs you haven't looked at for a while
  reportOn: true,        // record time for the weekly report (Settings → Focus)
  mochiMode: 'lively',   // lively (all of Mochi's reactions) | quiet (only important ones) | off      // the welcome tour has been finished or skipped
  aiProvider: 'claude',  // Ask AI: claude | chatgpt | gemini
  askMode: 'smart',      // smart (questions go to AI first) | search (search first) | ai (AI first)
  quickLinks: [
    { name: 'Mail', url: 'https://mail.google.com' },
    { name: 'Drive', url: 'https://drive.google.com' },
    { name: 'YouTube', url: 'https://www.youtube.com' },
    { name: 'Calendar', url: 'https://calendar.google.com' },
  ],
};

class Store {
  constructor(name = 'burrow-state.json', defaults = SETTINGS_DEFAULTS) {
    this.file = path.join(app.getPath('userData'), name);
    this.data = structuredClone(defaults);
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const k of Object.keys(saved)) {
        const d = defaults[k];
        this.data[k] = d && typeof d === 'object' && !Array.isArray(d) ? { ...d, ...saved[k] } : saved[k];
      }
    } catch { /* first run or unreadable file: keep defaults */ }
    this.timer = null;
  }

  get(key) { return this.data[key]; }

  set(key, value) {
    this.data[key] = value;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 400);
  }

  flush() {
    clearTimeout(this.timer);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error('Burrow: could not save', this.file, err);
    }
  }
}

module.exports = { Store };
