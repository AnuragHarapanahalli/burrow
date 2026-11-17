// Weekly report data: active time per website per day, plus a few daily counts (focus sessions,
// tabs Mochi ate, "1 more minute"s, unlocks, tabs put to sleep). Kept on this computer for 5 weeks.
// Private windows are never recorded here (they still count toward limits — that's focus.js).
const { Store } = require('./store');

const KEEP_DAYS = 35;
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const keyOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dateOf = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
// Monday of the week that contains `d`.
const mondayOf = (d) => addDays(d, -((d.getDay() + 6) % 7));

// "youtube.com" from any http(s) address (without "www."), else null.
function hostOf(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return null;
    return u.host.toLowerCase().replace(/^www\./, '');
  } catch { return null; }
}

const emptyDay = () => ({ sites: {}, total: 0, limited: 0, hadLimits: false, hit: false, focus: 0, eaten: 0, snoozes: 0, unlocks: 0, slept: 0, freedMB: 0 });

class Stats {
  /** isOn() → whether recording is switched on (Settings → Focus). now() is replaceable for tests. */
  constructor(isOn, now = () => new Date()) {
    this.isOn = isOn;
    this.now = now;
    this.store = new Store('stats.json', { days: {}, reportSeen: null });
    this.days = this.store.get('days') || {};
    this.dirty = false;
    this.prune();
    this.timer = setInterval(() => this.save(), 10000);
  }

  today() { return keyOf(this.now()); }
  day(key = this.today()) { return this.days[key] || (this.days[key] = emptyDay()); }

  save() {
    if (!this.dirty) return;
    this.dirty = false;
    this.store.set('days', this.days);
  }
  flush() { this.save(); this.store.flush(); }

  // Forget days older than 5 weeks.
  prune() {
    const oldest = keyOf(addDays(this.now(), -KEEP_DAYS));
    for (const k of Object.keys(this.days)) if (k < oldest) { delete this.days[k]; this.dirty = true; }
  }

  clear() {
    this.days = {};
    this.dirty = true;
    this.save();
  }

  // One second on screen. seen: Map host → whether it's a limited site; hasLimits: any limits set today.
  count(seen, hasLimits) {
    if (!this.isOn() || !seen.size) return;
    const d = this.day();
    for (const [host, limited] of seen) {
      d.sites[host] = (d.sites[host] || 0) + 1;
      if (limited) d.limited += 1;
    }
    d.total += 1; // wall-clock seconds browsing (two sites side by side still count once)
    if (hasLimits) d.hadLimits = true;
    this.dirty = true;
  }

  // focus · eaten · snoozes · unlocks · slept · freedMB · hit
  event(name, n = 1) {
    if (!this.isOn()) return;
    const d = this.day();
    if (name === 'hit') d.hit = true;
    else d[name] = (d[name] || 0) + n;
    this.dirty = true;
  }

  // ---------- The weekly report ----------
  // offset 0 = this week so far, 1 = last week, … 4.
  week(offset = 0) {
    const start = addDays(mondayOf(this.now()), -7 * offset);
    const sum = (from) => {
      const days = [];
      const tot = { total: 0, limited: 0, focus: 0, eaten: 0, snoozes: 0, unlocks: 0, slept: 0, freedMB: 0, within: 0, limitDays: 0, sites: {} };
      for (let i = 0; i < 7; i++) {
        const key = keyOf(addDays(from, i));
        const d = this.days[key];
        days.push({ key, name: DAY_NAMES[i], total: d?.total || 0, limited: d?.limited || 0, focus: d?.focus || 0, has: !!d && d.total > 0 });
        if (!d) continue;
        for (const k of ['total', 'limited', 'focus', 'eaten', 'snoozes', 'unlocks', 'slept', 'freedMB']) tot[k] += d[k] || 0;
        for (const [h, s] of Object.entries(d.sites || {})) tot.sites[h] = (tot.sites[h] || 0) + s;
        if (d.hadLimits && key !== this.today()) { tot.limitDays += 1; if (!d.hit) tot.within += 1; }
      }
      return { days, ...tot };
    };
    const cur = sum(start);
    const prev = sum(addDays(start, -7));
    const top = Object.entries(cur.sites).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([site, sec]) => ({ site, sec, prev: prev.sites[site] || 0 }));
    const withData = cur.days.filter((d) => d.has && d.key !== this.today());
    const calmest = withData.length >= 2 ? withData.reduce((a, b) => (b.total < a.total ? b : a)) : null;
    const focusiest = cur.days.reduce((a, b) => (b.focus > a.focus ? b : a));
    const oldest = Object.keys(this.days).sort()[0];
    return {
      offset,
      start: keyOf(start), end: keyOf(addDays(start, 6)),
      current: offset === 0,
      days: cur.days, total: cur.total, limited: cur.limited,
      prevTotal: prev.total, prevHas: prev.total > 0,
      focus: cur.focus, prevFocus: prev.focus,
      eaten: cur.eaten, snoozes: cur.snoozes, unlocks: cur.unlocks, slept: cur.slept, freedMB: cur.freedMB,
      within: cur.within, limitDays: cur.limitDays,
      top,
      calmest: calmest && { name: calmest.name, total: calmest.total },
      focusiest: focusiest.focus ? { name: focusiest.name, focus: focusiest.focus } : null,
      hasData: cur.total > 0,
      // Can you step further back? Only while there's data that old (and at most 4 weeks back).
      earlier: offset < 4 && !!oldest && oldest < keyOf(start),
    };
  }

  // The weekly nudge: once per week, on the first new tab, if last week has anything to show.
  nudgeDue() {
    if (!this.isOn()) return false;
    const thisWeek = keyOf(mondayOf(this.now()));
    if (this.store.get('reportSeen') === thisWeek) return false;
    return this.week(1).hasData;
  }
  markNudged() { this.store.set('reportSeen', keyOf(mondayOf(this.now()))); }
}

module.exports = { Stats, hostOf, keyOf, mondayOf, addDays };
