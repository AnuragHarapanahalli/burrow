// Focus tools: daily time limits per site, Mochi's warnings, "1 more minute", the Burrow gate,
// the friction unlock, and focus sessions. Time only counts while a limited site is on screen,
// its window is focused, and you've been active in the last minute.
const { powerMonitor } = require('electron');
const { Store } = require('./store');
const { hostOf } = require('./stats');

const SUGGESTED = ['youtube.com', 'instagram.com', 'x.com', 'reddit.com', 'tiktok.com', 'facebook.com'];
const BUDGETS = [15, 30, 45, 60, 90];          // minutes a day you can pick
const SNOOZES_PER_DAY = 2;                      // "1 more minute", per site
const UNLOCK_MINUTES = 5;                        // what the gate's friction unlock gives you
const UNLOCK_WAITS = [10, 30, 60];               // seconds of breathing, growing through the day
const IDLE_SECONDS = 60;                         // away from the keyboard this long → stop counting
const FOCUS_MIN = 25, BREAK_MIN = 5;

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const pretty = (site) => ({ 'youtube.com': 'YouTube', 'instagram.com': 'Instagram', 'x.com': 'X', 'twitter.com': 'X', 'reddit.com': 'Reddit', 'tiktok.com': 'TikTok', 'facebook.com': 'Facebook' }[site] || site);

// When to warn, by daily budget (seconds left).
function thresholdsFor(budgetMin) {
  if (budgetMin >= 30) return [600, 300, 60];
  if (budgetMin >= 15) return [300, 60];
  return [120, 60];
}

class Focus {
  /**
   * hooks: getWindows() → BurrowWindow[], onWarn(site, minutesLeft), onTimeUp(site, snoozesLeft),
   *        onTick(), onSession(event)
   */
  constructor(hooks) {
    this.h = hooks;
    this.store = new Store('focus.json', {
      limits: {}, day: null, used: {}, warned: {}, snoozes: {}, unlocks: {}, extra: {}, hit: {},
      streak: { days: 0, last: null },
    });
    for (const k of ['limits', 'used', 'warned', 'snoozes', 'unlocks', 'extra', 'hit']) this[k] = this.store.get(k) || {};
    this.day = this.store.get('day');
    this.streak = this.store.get('streak') || { days: 0, last: null };
    this.session = null;            // { phase: 'focus' | 'break', endsAt }
    this.eating = new Map();        // site → fallback timer while Mochi is offering "1 more minute"
    this.gateStarts = new Map();    // gate page id → { site, at, wait } (the unlock countdown)
    this.rollover();
    this.timer = setInterval(() => this.tick(), 1000);
  }

  save() {
    for (const k of ['limits', 'used', 'warned', 'snoozes', 'unlocks', 'extra', 'hit']) this.store.set(k, this[k]);
    this.store.set('day', this.day);
    this.store.set('streak', this.streak);
  }

  // A new day: budgets reset, and the streak grows if yesterday stayed within every limit.
  rollover() {
    const t = today();
    if (this.day === t) return;
    if (this.day) {
      const gap = Math.max(1, Math.round((new Date(t) - new Date(this.day)) / 864e5));
      const yesterdayOk = !Object.keys(this.hit).length;
      if (yesterdayOk && Object.keys(this.limits).length) setImmediate(() => this.h.onEvent?.('dayWithin'));
      this.streak = yesterdayOk ? { days: this.streak.days + gap, last: this.day } : { days: gap - 1, last: this.day };
    }
    this.day = t;
    this.used = {}; this.warned = {}; this.snoozes = {}; this.unlocks = {}; this.extra = {}; this.hit = {};
    this.save();
  }

  // ---------- Which limit applies to an address ----------
  siteOf(url) {
    let host;
    try { const u = new URL(url); if (!/^https?:$/.test(u.protocol)) return null; host = u.host.toLowerCase(); } catch { return null; }
    for (const site of Object.keys(this.limits)) if (host === site || host.endsWith('.' + site)) return site;
    return null;
  }
  budgetSec(site) { return (this.limits[site] || 0) * 60; }
  remaining(site) { return this.budgetSec(site) + (this.extra[site] || 0) - (this.used[site] || 0); }

  // Why a site is closed right now: 'focus' (a focus session), 'limit' (budget used up) or null.
  blocked(site) {
    if (!site) return null;
    if (this.session?.phase === 'focus') return 'focus';
    return this.remaining(site) <= 0 ? 'limit' : null;
  }
  gateUrl(site, url, reason) {
    return `burrow://gate/?site=${encodeURIComponent(site)}&r=${reason}&u=${encodeURIComponent(url)}`;
  }
  // The gate address to show instead of \`url\`, or null if it may load.
  gateFor(url) {
    const site = this.siteOf(url);
    const r = this.blocked(site);
    return r ? this.gateUrl(site, url, r) : null;
  }

  // ---------- Settings ----------
  setLimit(site, minutes) {
    site = String(site || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(site)) return false;
    const m = Number(minutes);
    if (!m) delete this.limits[site];
    else if (BUDGETS.includes(m)) this.limits[site] = m;
    else return false;
    this.save();
    return true;
  }

  info() {
    return {
      limits: Object.entries(this.limits).map(([site, min]) => ({
        site, name: pretty(site), budget: min,
        usedMin: Math.floor((this.used[site] || 0) / 60), remainingSec: Math.max(0, this.remaining(site)),
      })),
      suggested: SUGGESTED.filter((s) => !this.limits[s]),
      budgets: BUDGETS,
      streak: this.streak.days,
      session: this.session ? { phase: this.session.phase, leftSec: Math.max(0, Math.round((this.session.endsAt - Date.now()) / 1000)) } : null,
    };
  }

  // ---------- Counting time (once a second) ----------
  tick() {
    this.rollover();
    this.tickSession();
    const idle = this.isIdle();
    const counted = new Set();
    const seen = new Map(); // for the weekly report: host → is it limited? (never private windows)
    if (!idle) {
      for (const w of this.h.getWindows()) {
        if (!this.winActive(w)) continue;
        for (const t of w.tabs.shownTabs) {
          const site = this.siteOf(t.url);
          if (site && !counted.has(site)) counted.add(site);
          const host = !w.isPrivate && hostOf(t.url);
          if (host) seen.set(host, !!site || !!seen.get(host));
        }
      }
    }
    if (seen.size) this.h.onCount?.(seen, Object.keys(this.limits).length > 0);
    for (const site of counted) {
      this.used[site] = (this.used[site] || 0) + 1;
      this.checkWarnings(site);
      if (this.remaining(site) <= 0) this.timeUp(site);
    }
    if (counted.size && Math.floor(Date.now() / 1000) % 5 === 0) this.save();
    this.h.onTick?.();
  }

  isIdle() { return powerMonitor.getSystemIdleTime() >= IDLE_SECONDS; }
  // Only the window you're using counts.
  winActive(w) { return !w.win.isDestroyed() && w.win.isFocused() && !w.win.isMinimized(); }

  checkWarnings(site) {
    const left = this.remaining(site);
    if (left <= 0) return;
    const done = this.warned[site] || (this.warned[site] = []);
    const crossed = thresholdsFor(this.limits[site]).filter((th) => left <= th && !done.includes(th));
    if (!crossed.length) return;
    done.push(...crossed);
    this.h.onWarn?.(site, Math.max(1, Math.ceil(left / 60)));
  }

  // Time's up: Mochi offers "1 more minute", then eats the tab. If nothing answers, close anyway.
  timeUp(site) {
    if (this.eating.has(site)) return;
    this.hit[site] = true;
    this.h.onEvent?.('hit');
    const snoozesLeft = SNOOZES_PER_DAY - (this.snoozes[site] || 0);
    this.eating.set(site, setTimeout(() => this.eaten(site), 12000));
    this.save();
    this.h.onTimeUp?.(site, snoozesLeft);
  }

  snooze(site) {
    if (!this.eating.has(site) || (this.snoozes[site] || 0) >= SNOOZES_PER_DAY) return false;
    clearTimeout(this.eating.get(site));
    this.eating.delete(site);
    this.snoozes[site] = (this.snoozes[site] || 0) + 1;
    this.h.onEvent?.('snoozes');
    this.extra[site] = (this.extra[site] || 0) + Math.max(0, -this.remaining(site)) + 60;
    this.warned[site] = []; // the 1-minute warning can come again
    this.save();
    return true;
  }

  // The tab was eaten: close every tab of that site, in every window.
  eaten(site) {
    if (!this.eating.has(site)) return; // already eaten (or never due)
    clearTimeout(this.eating.get(site));
    this.eating.delete(site);
    this.h.onEvent?.('eaten');
    for (const w of this.h.getWindows()) {
      for (const t of [...w.tabs.tabs]) if (this.siteOf(t.url) === site) w.tabs.close(t.id, { keepWindow: true });
    }
  }

  // ---------- The gate's friction unlock ----------
  unlockWait(site) { return UNLOCK_WAITS[Math.min(this.unlocks[site] || 0, UNLOCK_WAITS.length - 1)]; }

  gateInfo(site, reason) {
    return {
      site, name: pretty(site), reason,
      usedMin: Math.floor((this.used[site] || 0) / 60), budget: this.limits[site] || 0,
      streak: this.streak.days, wait: this.unlockWait(site), unlockMinutes: UNLOCK_MINUTES,
      sessionLeftSec: this.session?.phase === 'focus' ? Math.max(0, Math.round((this.session.endsAt - Date.now()) / 1000)) : 0,
    };
  }
  // The page starts the breathing countdown (after you've typed the sentence).
  startUnlock(pageId, site) {
    this.gateStarts.set(pageId, { site, at: Date.now(), wait: this.unlockWait(site) });
    return this.unlockWait(site);
  }
  // Only granted if the countdown really ran its full length.
  unlock(pageId, site) {
    const st = this.gateStarts.get(pageId);
    if (!st || st.site !== site || Date.now() - st.at < st.wait * 1000 - 250) return false;
    if (this.blocked(site) !== 'limit') return false;
    this.gateStarts.delete(pageId);
    this.unlocks[site] = (this.unlocks[site] || 0) + 1;
    this.h.onEvent?.('unlocks');
    this.extra[site] = (this.extra[site] || 0) + Math.max(0, -this.remaining(site)) + UNLOCK_MINUTES * 60;
    this.warned[site] = [];
    this.save();
    return true;
  }

  // ---------- Focus sessions: 25 minutes focus, 5 minutes break ----------
  startSession(minutes = FOCUS_MIN) {
    this.session = { phase: 'focus', endsAt: Date.now() + minutes * 60000 };
    // Limited sites already on screen go to the gate straight away.
    for (const w of this.h.getWindows()) {
      for (const t of w.tabs.tabs) {
        const g = t.view && this.gateFor(t.url);
        if (g) t.view.webContents.loadURL(g).catch(() => {});
      }
    }
    this.h.onSession?.('started');
  }
  endSession() {
    if (!this.session) return;
    this.session = null;
    this.h.onSession?.('ended');
  }
  tickSession() {
    const s = this.session;
    if (!s || Date.now() < s.endsAt) return;
    if (s.phase === 'focus') {
      this.session = { phase: 'break', endsAt: Date.now() + BREAK_MIN * 60000 };
      this.h.onEvent?.('focus');
      this.h.onSession?.('focus-done');
    } else {
      this.session = null;
      this.h.onSession?.('break-done');
    }
  }

  flush() { this.save(); this.store.flush(); }
}

module.exports = { Focus, pretty, BUDGETS, SUGGESTED };
