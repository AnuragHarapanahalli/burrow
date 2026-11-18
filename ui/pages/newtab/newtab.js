// New tab page: clock, search, quick links, one gentle line, and Mochi.
const $ = (id) => document.getElementById(id);
let tokens = null;

// Quick links live in quicklinks.js (they're editable and saved in your settings).

// ---------- Clock ----------
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
function tick() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  $('date').textContent = `${DAYS[d.getDay()]} ${p(d.getDate())}.${p(d.getMonth() + 1)} —`;
  $('clock').textContent = `${p(d.getHours())}:${p(d.getMinutes())}`;
}
tick();
setInterval(tick, 1000);

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Up late. Go easy on yourself.';
  if (h < 12) return 'Good morning. Welcome to Burrow.';
  if (h < 18) return 'Good afternoon. Welcome to Burrow.';
  return 'Good evening. Welcome to Burrow.';
}
$('stat').textContent = greeting();
// One gentle stat instead of the greeting, when there's something worth saying.
window.burrowPage.statLine?.().then((line) => {
  if (line && !isPrivate) { $('stat').textContent = line; $('stat').classList.add('has-stat'); }
}).catch(() => {});

// ---------- Search ----------
// ---------- Search | Ask ----------
// "Smart" mode flips the toggle to Ask when what you type looks like a question.
// Clicking the toggle yourself overrides that until the box is cleared.
let prefsNow = null;
let mode = 'search';
let modePinned = false;
function setMode(m, pinned) {
  mode = m;
  if (pinned !== undefined) modePinned = pinned;
  document.querySelectorAll('#modeToggle [data-mode]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === m)));
  document.body.classList.toggle('ask-mode', m === 'ask');
  updatePlaceholder();
}
function updatePlaceholder() {
  if (!prefsNow) return;
  const engine = prefsNow.engines.find((e) => e.id === prefsNow.searchEngine);
  const ai = prefsNow.aiProviders.find((p) => p.id === prefsNow.aiProvider);
  $('q').placeholder = mode === 'ask' ? `Ask ${ai ? ai.name : 'AI'} anything` : `Search ${engine ? engine.name : 'the web'} or type a URL`;
  $('qHint').textContent = mode === 'ask' ? `ENTER TO ASK ${(ai?.name || 'AI').toUpperCase()}` : 'ENTER';
}
function autoMode() {
  if (modePinned || !prefsNow) return;
  const q = $('q').value.trim();
  const m = prefsNow.askMode === 'ai' ? 'ask'
    : prefsNow.askMode === 'search' ? 'search'
    : (window.BurrowAI.isQuestion(q) ? 'ask' : 'search');
  if (m !== mode) setMode(m);
}
$('modeToggle').addEventListener('click', (e) => {
  const b = e.target.closest('[data-mode]');
  if (!b) return;
  setMode(b.dataset.mode, true);
  $('q').focus();
});
$('q').addEventListener('input', () => {
  if (!$('q').value.trim()) modePinned = false;
  autoMode();
});
$('search').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('q').value.trim();
  if (!q) return;
  if (mode === 'ask') window.burrowPage.ask(q);
  else window.burrowPage.navigate(q);
});

// ---------- Mochi ----------
// Mochi speaks only with a reason: the first new tab of the session, or when you poke them.
const POKES = ['Boop!', 'Hehe, that tickles.', 'Need anything?', 'I like it here.', 'Stay cozy.'];
let pose = 'idle', poke = 0, bubbleTimer;

let isPrivate = false;
// In a private window Mochi wears sunglasses.
let look = null; // Mochi's eyes follow the pointer
function drawMochi() {
  if (!tokens) return;
  const p = isPrivate && (pose === 'idle' || pose === 'blink') ? 'shades' : pose;
  $('mochi').innerHTML = window.Mochi.svg(tokens, p, 84, { look: pose === 'idle' || pose === 'blink' ? look : null });
}

// ---------- Mochi's idle life: watches the pointer, naps when you're away, fidgets now and then ----------
let lastActive = Date.now();
const napAfter = () => window.NAP_AFTER_MS || 60000;
function wakeUp() {
  lastActive = Date.now();
  if (pose !== 'sleepy') return;
  pose = 'wave'; drawMochi();
  setTimeout(() => { if (pose === 'wave') { pose = 'idle'; drawMochi(); } }, 1200);
}
document.addEventListener('mousemove', (e) => {
  wakeUp();
  const r = $('mochi').getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const next = e.clientX < cx - 90 ? 'left' : e.clientX > cx + 90 ? 'right' : null;
  if (next !== look) { look = next; if (pose === 'idle') drawMochi(); }
});
['keydown', 'wheel', 'pointerdown'].forEach((ev) => document.addEventListener(ev, wakeUp, { passive: true }));
setInterval(() => {
  if (pose === 'idle' && Date.now() - lastActive > napAfter()) { pose = 'sleepy'; drawMochi(); }
}, 500);
let nextFidget = Date.now() + 9000 + Math.random() * 6000;
setInterval(() => {
  if (Date.now() < nextFidget || pose !== 'idle' || document.hidden) return;
  nextFidget = Date.now() + 9000 + Math.random() * 7000;
  if (Math.random() < 0.5 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const m = $('mochi');
    m.classList.remove('hop'); void m.offsetWidth; m.classList.add('hop');
  } else {
    pose = 'celebrate'; drawMochi(); // a little stretch
    setTimeout(() => { if (pose === 'celebrate') { pose = 'idle'; drawMochi(); } }, 700);
  }
}, 1000);
let mochiMode = 'lively';
// `explicit` = you did something (clicked Mochi, picked an engine): shown even in Quiet mode.
function say(text, ms = 4000, explicit = false) {
  if (mochiMode === 'off' || (mochiMode === 'quiet' && !explicit)) return;
  if (!explicit && !$('mochiMenu').hidden) return; // don't talk over the open menu
  const b = $('bubble');
  b.textContent = text;
  b.hidden = false;
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => { b.hidden = true; }, ms);
}
function blink() {
  if (pose !== 'idle') return;
  pose = 'blink'; drawMochi();
  setTimeout(() => { pose = 'idle'; drawMochi(); }, 160);
}
setInterval(blink, 4200);

function pet() {
  pose = 'happy'; drawMochi();
  say(POKES[poke++ % POKES.length], 2500, true);
  setTimeout(() => { pose = 'idle'; drawMochi(); }, 900);
}

// ---------- Click Mochi: a little menu of things to do together ----------
const MM_ICON = { pet: '\u2665', hop: '\u25B2', focus: '\u25F7', tidy: '\u2713', report: '\u2261', wardrobe: '\u25C6', night: '\u263E', settings: '\u2026' };
async function openMochiMenu() {
  const info = (await window.burrowPage.mochiInfo?.()) || { isPrivate: true };
  const items = [
    ['pet', 'Pet Mochi'],
    ['hop', 'Play Mochi Hop'],
  ];
  if (!info.isPrivate) {
    items.push(null,
      ['focus', info.session === 'focus' ? 'End the focus session' : info.session === 'break' ? 'Skip the break' : 'Start a 25-minute focus session'],
      ['tidy', 'Tidy up my tabs'],
      ['report', 'My week in Burrow'],
      null,
      ['wardrobe', 'Wardrobe'],
      ['night', info.night ? 'Night mode off' : 'Night mode on'],
      ['settings', 'Mochi settings']);
  }
  $('mmCarrots').textContent = info.isPrivate ? '' : `${info.carrots || 0} CARROT${info.carrots === 1 ? '' : 'S'}`;
  $('mmItems').innerHTML = items.map((it) => (it
    ? `<button class="mm-item" role="menuitem" data-mm="${it[0]}"><span class="ico" aria-hidden="true">${MM_ICON[it[0]]}</span>${it[1]}</button>`
    : '<div class="mm-sep" role="separator"></div>')).join('');
  $('bubble').hidden = true;
  $('mochiMenu').hidden = false;
  $('mochi').setAttribute('aria-expanded', 'true');
  pose = 'wave'; drawMochi();
  $('mmItems').querySelector('.mm-item')?.focus();
}
function closeMochiMenu() {
  if ($('mochiMenu').hidden) return;
  $('mochiMenu').hidden = true;
  $('mochi').setAttribute('aria-expanded', 'false');
  if (pose === 'wave') { pose = 'idle'; drawMochi(); }
}
window.openMochiMenu = openMochiMenu;
$('mochi').addEventListener('click', (e) => {
  e.stopPropagation();
  if ($('mochiMenu').hidden) openMochiMenu(); else closeMochiMenu();
});
$('mmItems').addEventListener('click', (e) => {
  const b = e.target.closest('[data-mm]');
  if (!b) return;
  const act = b.dataset.mm;
  closeMochiMenu();
  if (act === 'pet') pet();
  else window.burrowPage.mochiAction(act);
});
$('mochiMenu').addEventListener('keydown', (e) => {
  const items = [...$('mmItems').querySelectorAll('.mm-item')];
  const i = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  } else if (e.key === 'Escape') { e.preventDefault(); closeMochiMenu(); $('mochi').focus(); }
});
document.addEventListener('click', (e) => { if (!e.target.closest('#mochiMenu')) closeMochiMenu(); });

try {
  if (!sessionStorage.getItem('mochi-greeted')) {
    sessionStorage.setItem('mochi-greeted', '1');
    pose = 'wave';
    setTimeout(() => { say("Hi! I'm Mochi. I'll pop up when there's something worth saying."); }, 400);
    setTimeout(() => { pose = 'idle'; drawMochi(); }, 2400);
  }
} catch { /* storage unavailable: skip the greeting */ }

// ---------- Search engine: asked once, then never again ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let askedEngine = false;
function renderPrefs(prefs, ws) {
  window.renderQuickLinks?.(prefs.quickLinks || [], ws || null);
  const engine = prefs.engines.find((e) => e.id === prefs.searchEngine);
  prefsNow = prefs;
  if (!modePinned && prefs.askMode === 'ai' && mode !== 'ask') setMode('ask'); else autoMode();
  updatePlaceholder();
  const chooser = $('chooser');
  if (!prefs.searchChosen) {
    $('engineGrid').innerHTML = prefs.engines.map((e) =>
      `<button role="radio" aria-checked="false" data-engine="${e.id}"><span class="n">${esc(e.name)}</span><span class="h">${esc(e.host)}</span></button>`).join('');
    chooser.hidden = false;
    if (!askedEngine) { askedEngine = true; setTimeout(() => say('Which search engine do you like?', 5000, true), 900); }
  } else if (!chooser.hidden) {
    chooser.classList.add('leaving');
    chooser.addEventListener('animationend', () => { chooser.hidden = true; chooser.classList.remove('leaving'); }, { once: true });
  }
}
$('engineGrid').addEventListener('click', (e) => {
  const b = e.target.closest('[data-engine]');
  if (!b) return;
  window.burrowPage.setSearchEngine(b.dataset.engine);
  pose = 'happy'; drawMochi();
  say(`${b.querySelector('.n').textContent} it is!`, 2500, true);
  setTimeout(() => { pose = 'idle'; drawMochi(); }, 1200);
  $('q').focus();
});

// ---------- Theme ----------
function applyTheme(payload) {
  if (payload?.prefs) window.Mochi.wear = payload.prefs.outfit || null;
  if (!payload) return;
  mochiMode = payload.prefs?.mochiMode || 'lively';
  document.body.classList.toggle('mochi-off', mochiMode === 'off');
  if (payload.isPrivate && !isPrivate) {
    isPrivate = true;
    document.body.classList.add('private');
    document.querySelector('h1').innerHTML = 'Browsing<br>privately<span class="dot">.</span>';
    $('stat').textContent = "Pages you visit here aren't saved to history. Cookies and logins vanish when you close this window.";
  }
  if (payload.prefs) renderPrefs(payload.prefs, payload.workspace);
  if (payload.version) $('version').textContent = `v${payload.version}`;
  tokens = payload.tokens;
  window.BurrowTheme.apply(tokens);
  document.documentElement.classList.toggle('show-grid', !!payload.settings.grid);
  drawMochi();
}
window.burrowPage.getTheme().then(applyTheme);
window.burrowPage.onTheme(applyTheme);
