// Mochi's fun side: carrots (earned, never lost) and the outfits they buy; Mochi Hop's best score;
// and bedtime / night mode. Kept in the settings file.
const OUTFITS = require('../shared/mochi').OUTFITS;

// What earns carrots.
const EARN = { eye: 1, focus: 3, dayWithin: 2 };
const HOP_CARROTS_PER_DAY = 5;
const NIGHT_SEED = '#C8762B'; // warm amber, dark mode

const dayKey = (d = new Date()) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

class Fun {
  /** h: { store, say(text, opts) } */
  constructor(h) { this.h = h; }
  get store() { return this.h.store; }

  state() {
    const s = this.store;
    return {
      carrots: s.get('carrots') || 0,
      owned: s.get('outfitsOwned') || [],
      outfit: s.get('outfit') || null,
      outfits: Object.entries(OUTFITS).map(([id, o]) => ({ id, ...o })),
      hopBest: s.get('hopBest') || 0,
    };
  }

  earn(reason, n = EARN[reason] || 0) {
    if (!n) return 0;
    this.store.set('carrots', (this.store.get('carrots') || 0) + n);
    const why = { eye: 'for resting your eyes', focus: 'for a focus session', dayWithin: 'for a day within your limits', hop: 'from Mochi Hop' }[reason] || '';
    this.h.say(`+${n} carrot${n === 1 ? '' : 's'} ${why}`.trim(), { pose: 'happy', essential: false });
    return n;
  }

  buy(id) {
    const o = OUTFITS[id];
    const owned = this.store.get('outfitsOwned') || [];
    if (!o || owned.includes(id)) return false;
    const have = this.store.get('carrots') || 0;
    if (have < o.price) return false;
    this.store.set('carrots', have - o.price);
    this.store.set('outfitsOwned', [...owned, id]);
    this.store.set('outfit', id);
    return true;
  }

  wear(id) {
    if (id && !(this.store.get('outfitsOwned') || []).includes(id)) return false;
    this.store.set('outfit', id || null);
    return true;
  }

  // Mochi Hop: best score, and a few carrots for the carrots you collected (5 a day at most).
  hopScore(score, collected) {
    const best = this.store.get('hopBest') || 0;
    const s = Math.max(0, Math.floor(Number(score) || 0));
    const isBest = s > best;
    if (isBest) this.store.set('hopBest', s);
    const today = dayKey();
    const got = this.store.get('hopDay') === today ? this.store.get('hopToday') || 0 : 0;
    const give = Math.min(Math.floor((Number(collected) || 0) / 5), HOP_CARROTS_PER_DAY - got);
    if (give > 0) { this.store.set('hopDay', today); this.store.set('hopToday', got + give); this.earn('hop', give); }
    return { best: Math.max(best, s), isBest, carrots: Math.max(0, give) };
  }
}

// ---------- Bedtime / night mode ----------
// The "night" a time belongs to: before 06:00 it's still yesterday's night.
function nightOf(now) {
  const d = new Date(now);
  if (d.getHours() < 6) d.setDate(d.getDate() - 1);
  return dayKey(d);
}
// Minutes from bedtime (negative = before it). bedtime: "HH:MM".
function sinceBedtime(bedtime, now) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(bedtime || '');
  if (!m) return null;
  const d = new Date(now);
  const night = new Date(now);
  if (d.getHours() < 6) night.setDate(night.getDate() - 1);
  night.setHours(Number(m[1]), Number(m[2]), 0, 0);
  if (Number(m[1]) < 6) night.setDate(night.getDate() + 1); // a bedtime after midnight
  return Math.floor((now - night.getTime()) / 60000);
}

module.exports = { Fun, OUTFITS, NIGHT_SEED, nightOf, sinceBedtime, dayKey };
