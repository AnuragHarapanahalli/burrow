// Mochi's helpful side: eye & stretch breaks, tab tidy-up offers, and "remind me about this tab".
// One timer, once a second. Screen time only counts while a Burrow window is in front and you're
// active; 5 minutes away resets it.
const { powerMonitor } = require('electron');
const { nightOf, sinceBedtime } = require('./fun');

const STRETCH_MIN = 90;          // a stretch nudge after this much screen time in one go
const AWAY_RESET_SEC = 300;      // away this long → the break timers start over
const FORGOTTEN_DAYS = 3;        // tabs not looked at for this long count as forgotten
const FORGOTTEN_MIN_COUNT = 5;   // …and only worth mentioning when there are this many
const TIDY_EVERY_SEC = 300;      // how often to look for duplicates / forgotten tabs

const dayKey = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
// Same page, ignoring #fragments.
const pageKey = (url) => { try { const u = new URL(url); if (!/^https?:$/.test(u.protocol)) return null; u.hash = ''; return u.href; } catch { return null; } };
const siteName = (url) => { try { return new URL(url).host.replace(/^www\./, ''); } catch { return url; } };

class Care {
  /**
   * h: { store, getWindows(), mochiOn(), onEye(win), onStretch(win), onTidy(win, offer), onReminder(reminder) }
   */
  constructor(h) {
    this.h = h;
    this.eyeSec = 0;
    this.longSec = 0;
    this.ticks = 0;
    this.timer = setInterval(() => this.tick(), 1000);
  }

  // (The self-test replaces these three.)
  now() { return Date.now(); }
  idleSeconds() { return powerMonitor.getSystemIdleTime(); }
  winActive(w) { return !w.win.isDestroyed() && w.win.isFocused() && !w.win.isMinimized(); }

  tick() {
    this.ticks++;
    const store = this.h.store;
    const idle = this.idleSeconds();
    if (idle >= AWAY_RESET_SEC) { this.eyeSec = 0; this.longSec = 0; }
    const win = this.h.getWindows().find((w) => this.winActive(w));
    // Breaks: only while you're actually here, and not during fullscreen video.
    const every = Number(store.get('eyeBreaks')) || 0;
    if (win && idle < 60 && this.h.mochiOn() && !win.win.isFullScreen()) {
      this.eyeSec++;
      this.longSec++;
      if (every && this.eyeSec >= every * 60) { this.eyeSec = 0; this.h.onEye(win); }
      else if (this.longSec >= STRETCH_MIN * 60) { this.longSec = 0; this.h.onStretch(win); }
    }
    if (this.ticks % 30 === 0) { this.checkReminders(); this.bedtimeTick(); }
    // Back after a long time away: Mochi waves (Lively only).
    if (idle >= 600) this.away = true;
    else if (this.away && idle < 5 && win) { this.away = false; this.h.onWelcomeBack?.(win); }
    if (this.ticks % TIDY_EVERY_SEC === 0 && win && !win.isPrivate && this.h.mochiOn()) this.offerTidy(win, false);
  }

  // ---------- Bedtime ----------
  // 30 minutes before: a heads-up. At bedtime: offer night mode. Then a soft "it's late" every 30
  // minutes, 3 times at most. Night mode ends by itself at 06:00.
  bedtimeTick() {
    const store = this.h.store;
    const now = this.now();
    const hour = new Date(now).getHours();
    if (store.get('nightMode') && hour >= 6 && hour < 18) this.h.setNight(false);
    const m = sinceBedtime(store.get('bedtime'), now);
    if (m === null || !this.h.mochiOn()) return null;
    const night = nightOf(now);
    let st = store.get('bedtimeState') || {};
    if (st.night !== night) st = { night, warned: false, offered: false, nudges: 0, last: 0 };
    let said = null;
    if (m >= -30 && m < 0 && !st.warned) { st.warned = true; said = 'soon'; }
    else if (m >= 0 && m < 360 && !st.offered) { st.offered = true; st.last = now; said = 'now'; }
    else if (m >= 30 && m < 360 && st.offered && st.nudges < 3 && now - st.last >= 30 * 60000) { st.nudges++; st.last = now; said = 'late'; }
    store.set('bedtimeState', st);
    if (said) this.h.onBedtime(said);
    return said;
  }

  // ---------- Tab tidy-up ----------
  // What could go: duplicates (all but the copy you used last) and forgotten tabs.
  findTidy(w) {
    const now = Date.now();
    const groups = new Map();
    for (const t of w.tabs.tabs) {
      const k = pageKey(t.url);
      if (!k) continue;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(t);
    }
    const dupes = [];
    let dupeName = '';
    let most = 0;
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      // Keep the copy on screen; otherwise the one you looked at most recently.
      const keep = list.find((t) => w.tabs.shownTabs.includes(t)) || list.reduce((a, b) => ((b.lastActive || 0) > (a.lastActive || 0) ? b : a));
      dupes.push(...list.filter((t) => t !== keep && !w.tabs.shownTabs.includes(t)));
      if (list.length > most) { most = list.length; dupeName = siteName(list[0].url); }
    }
    const old = w.tabs.tabs.filter((t) => !w.tabs.shownTabs.includes(t) && !t.keepAwake && !t.playing && !dupes.includes(t)
      && !t.url.startsWith('burrow://') && now - (t.lastActive || now) >= FORGOTTEN_DAYS * 864e5);
    return { dupes, dupeName, dupeCount: most, old };
  }

  // force: you asked (Ctrl+K) — otherwise at most once a day for each kind.
  offerTidy(w, force) {
    const store = this.h.store;
    const seen = store.get('tidySeen') || {};
    const today = dayKey();
    const f = this.findTidy(w);
    const pack = (tabs) => tabs.map((t) => ({ id: t.id, title: t.title || t.url, url: t.url }));
    let offer = null;
    if (f.dupes.length && (force || seen.dupes !== today)) {
      offer = { kind: 'dupes', text: f.dupeCount > 2 ? `${f.dupeCount} copies of ${f.dupeName} open. Click me to tidy` : 'Duplicate tabs open. Click me to tidy', tabs: pack(f.dupes) };
      seen.dupes = today;
    } else if (f.old.length >= (force ? 1 : FORGOTTEN_MIN_COUNT) && (force || seen.old !== today)) {
      offer = { kind: 'old', text: `${f.old.length} forgotten tab${f.old.length === 1 ? '' : 's'}. Click me to tidy`, tabs: pack(f.old) };
      seen.old = today;
    }
    if (offer) { store.set('tidySeen', seen); this.h.onTidy(w, offer); }
    return offer;
  }

  // ---------- Remind me about this tab ----------
  list() { return (this.h.store.get('reminders') || []).slice().sort((a, b) => a.at - b.at); }

  add(tab, at) {
    const t = Number(at);
    if (!tab || !/^https?:/i.test(tab.url) || !(t > Date.now() + 20000) || t > Date.now() + 60 * 864e5) return null;
    const all = this.h.store.get('reminders') || [];
    const r = { id: (all.reduce((m, x) => Math.max(m, x.id), 0) || 0) + 1, url: tab.url, title: tab.title || tab.url, favicon: /^https?:/i.test(tab.favicon || '') ? tab.favicon : null, at: t };
    this.h.store.set('reminders', [...all, r]);
    return r;
  }

  remove(id) {
    const all = this.h.store.get('reminders') || [];
    const r = all.find((x) => x.id === Number(id));
    this.h.store.set('reminders', all.filter((x) => x.id !== Number(id)));
    return r || null;
  }

  // Bring back every reminder that's due (also ones missed while Burrow was closed).
  checkReminders() {
    const due = this.list().filter((r) => r.at <= Date.now());
    for (const r of due) { this.remove(r.id); this.h.onReminder(r); }
    return due.length;
  }
}

module.exports = { Care, pageKey };
