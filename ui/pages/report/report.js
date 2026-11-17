// The weekly report page. All numbers come from the main process (stats.js); nothing leaves the computer.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const P = window.burrowPage;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
let tokens = null;
let data = null;
let offset = null; // 0 = this week so far, 1 = last week …

// 1 h 20 m · 45 min · <1 min
function fmt(sec) {
  if (!sec) return '0 min';
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h) return m ? `${h} h ${m} m` : `${h} h`;
  return m ? `${m} min` : '<1 min';
}
const dateOf = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };
const todayKey = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
function range(start, end) {
  const a = dateOf(start), b = dateOf(end);
  return a.getMonth() === b.getMonth()
    ? `${a.getDate()}–${b.getDate()} ${MONTHS[b.getMonth()]}`
    : `${a.getDate()} ${MONTHS[a.getMonth()]} – ${b.getDate()} ${MONTHS[b.getMonth()]}`;
}

// "↓ 40 min vs last week": for time, less is good; for focus sessions, more is good.
function delta(el, now, before, { time = false, moreIsGood = false } = {}) {
  el.className = 'delta';
  if (!data.prevHas || data.current) { el.textContent = data.current ? 'so far' : ''; return; }
  const diff = now - before;
  if (Math.abs(diff) < (time ? 60 : 1)) { el.textContent = 'same as last week'; return; }
  const amount = time ? fmt(Math.abs(diff)) : Math.abs(diff);
  const good = moreIsGood ? diff > 0 : diff < 0;
  el.classList.add(good ? 'good' : 'up');
  if (good && moreIsGood) el.classList.add('more');
  el.textContent = `${amount} ${diff < 0 ? 'less' : 'more'} than last week`;
}

function headline() {
  if (!data.hasData) return data.current ? ['happy', 'Your week is just getting started.'] : ['sleepy', 'A quiet week. Nothing was recorded.'];
  if (data.limitDays && data.within === data.limitDays && !data.current) return ['celebrate', 'Every day within your limits. Proud of you!'];
  if (data.prevHas && !data.current && data.total < data.prevTotal) return ['happy', `${fmt(data.prevTotal - data.total)} less than last week. Nice!`];
  if (data.focus >= 3) return ['celebrate', `${data.focus} focus sessions. Look at you go.`];
  if (data.current) return ['idle', 'Week in progress. Pace yourself.'];
  return ['wave', 'New week, fresh start.'];
}

function render() {
  if (!data) return;
  $('range').innerHTML = `${esc(range(data.start, data.end))}<span class="dot">.</span>`;
  $('whichWeek').textContent = data.offset === 0 ? 'THIS WEEK SO FAR' : data.offset === 1 ? 'LAST WEEK' : `${data.offset} WEEKS AGO`;
  $('earlier').disabled = !data.earlier;
  $('later').disabled = data.offset === 0;
  const [pose, line] = headline();
  $('headline').textContent = line;
  if (tokens) $('mochi').innerHTML = window.Mochi.svg(tokens, pose, 72);
  $('mochi').dataset.pose = pose;
  document.title = `Your week in Burrow · ${range(data.start, data.end)}`;

  $('empty').hidden = data.hasData;
  $('content').hidden = !data.hasData;
  if (!data.hasData) {
    $('emptyText').textContent = data.on
      ? 'Browse as usual. Mochi counts the time each site is on screen, and your week shows up here.'
      : 'The weekly report is switched off. Turn it on in Settings → Focus.';
    return;
  }

  // Big numbers
  $('nTotal').textContent = fmt(data.total);
  delta($('dTotal'), data.total, data.prevTotal, { time: true });
  $('nWithin').textContent = data.limitDays ? `${data.within} / ${data.limitDays}` : '—';
  $('dWithin').className = 'delta';
  $('dWithin').textContent = data.limitDays ? `day${data.limitDays === 1 ? '' : 's'} with limits` : 'no limits set';
  $('nFocus').textContent = String(data.focus);
  delta($('dFocus'), data.focus, data.prevFocus, { moreIsGood: true });
  $('nEaten').textContent = String(data.eaten);
  $('dEaten').className = 'delta';
  $('dEaten').textContent = data.eaten ? 'Crunchy.' : 'Not one. Nice.';

  // Day by day: pixel bars in 4-px steps, the limited part in the accent colour
  const max = Math.max(...data.days.map((d) => d.total), 1);
  const step = (x) => Math.round((x / max) * 140 / 4) * 4;
  $('chart').innerHTML = data.days.map((d) => {
    const h = step(d.total);
    const lim = Math.min(h, step(d.limited));
    const today = d.key === todayKey;
    return `<div class="day${today ? ' today' : ''}" title="${esc(d.name)}: ${esc(fmt(d.total))}${d.limited ? ` (${esc(fmt(d.limited))} on limited sites)` : ''}">
      <span class="t">${d.total ? esc(fmt(d.total)) : ''}</span>
      <div class="bar${h ? '' : ' zero'}" style="height:${h || 0}px"><div class="lim" style="height:${lim}px"></div></div>
      <span class="d pixel">${esc(d.name.toUpperCase())}</span></div>`;
  }).join('');
  $('chart').setAttribute('aria-label', data.days.map((d) => `${d.name} ${fmt(d.total)}`).join(', '));

  // Top sites
  const topMax = Math.max(...data.top.map((t) => t.sec), 1);
  $('top').innerHTML = data.top.length ? data.top.map((t) => {
    const diff = t.sec - t.prev;
    let d = '';
    if (!data.current && data.prevHas) {
      if (!t.prev) d = '<span class="delta">new this week</span>';
      else if (Math.abs(diff) >= 60) d = `<span class="delta ${diff < 0 ? 'good' : 'up'}">${esc(fmt(Math.abs(diff)))} ${diff < 0 ? 'less' : 'more'}</span>`;
      else d = '<span class="delta">about the same</span>';
    }
    return `<li><div class="name"><b>${esc(t.name)}</b>${t.name !== t.site ? `<span>${esc(t.site)}</span>` : ''}</div>
      <div class="meter"><i style="width:${Math.round((t.sec / topMax) * 100)}%"></i></div>
      <span class="time">${esc(fmt(t.sec))}</span>${d || '<span></span>'}</li>`;
  }).join('') : '<li class="none">No sites yet.</li>';

  // Mochi's highlights
  const hl = [];
  if (data.eaten) hl.push([`${data.eaten} tab${data.eaten === 1 ? '' : 's'}`, 'eaten by Mochi when time ran out']);
  if (data.freedMB >= 10) hl.push([`${data.freedMB} MB`, `freed by sleeping tabs (${data.slept} nap${data.slept === 1 ? '' : 's'})`]);
  else if (data.slept) hl.push([`${data.slept} nap${data.slept === 1 ? '' : 's'}`, 'tabs Mochi tucked into bed']);
  if (data.calmest) hl.push([data.calmest.name, `calmest day (${fmt(data.calmest.total)})`]);
  if (data.focusiest && data.focusiest.focus >= 2) hl.push([`${data.focusiest.focus} sessions`, `most focus in one day (${data.focusiest.name})`]);
  if (data.limits && data.streak >= 2) hl.push([`${data.streak} days`, 'current streak within your limits']);
  if (data.snoozes) hl.push([`${data.snoozes}×`, 'you took “1 more minute”']);
  if (data.unlocks) hl.push([String(data.unlocks), `unlock${data.unlocks === 1 ? '' : 's'} after breathing`]);
  $('highlights').innerHTML = hl.length
    ? hl.map(([b, sp]) => `<li><b>${esc(b)}</b><span>${esc(sp)}</span></li>`).join('')
    : "<li><b>All calm</b><span>Nothing special this week, and that's fine.</span></li>";
}

async function load(n) {
  const fresh = await P.report(n);
  if (!fresh) return;
  // First open: show last week if it has anything, otherwise this week so far.
  if (n === null) {
    offset = fresh.lastHasData ? 1 : 0;
    data = offset === fresh.offset ? fresh : await P.report(offset);
  } else {
    offset = n;
    data = fresh;
  }
  render();
}
$('earlier').onclick = () => { if (data?.earlier) load(offset + 1); };
$('later').onclick = () => { if (offset > 0) load(offset - 1); };
$('settings').onclick = () => P.reportAction('settings');

function applyTheme(p) {
  if (!p?.tokens) return;
  tokens = p.tokens;
  window.BurrowTheme.apply(tokens);
  render();
}
P.getTheme().then(applyTheme);
P.onTheme(applyTheme);
const asked = /^#\d$/.test(location.hash) ? Number(location.hash.slice(1)) : null;
load(asked);
