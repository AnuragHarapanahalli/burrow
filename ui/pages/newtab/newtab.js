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

// ---------- Search ----------
$('search').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('q').value.trim();
  if (q) window.burrowPage.navigate(q);
});

// ---------- Mochi ----------
// Mochi speaks only with a reason: the first new tab of the session, or when you poke them.
const POKES = ['Boop!', 'Hehe, that tickles.', 'Need anything?', 'I like it here.', 'Stay cozy.'];
let pose = 'idle', poke = 0, bubbleTimer;

let isPrivate = false;
// In a private window Mochi wears sunglasses.
function drawMochi() {
  if (!tokens) return;
  const p = isPrivate && (pose === 'idle' || pose === 'blink') ? 'shades' : pose;
  $('mochi').innerHTML = window.Mochi.svg(tokens, p, 84);
}
function say(text, ms = 4000) {
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

$('mochi').addEventListener('click', () => {
  pose = 'happy'; drawMochi();
  say(POKES[poke++ % POKES.length], 2500);
  setTimeout(() => { pose = 'idle'; drawMochi(); }, 900);
});

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
  $('q').placeholder = `Search ${engine ? engine.name : 'the web'} or type a URL`;
  const chooser = $('chooser');
  if (!prefs.searchChosen) {
    $('engineGrid').innerHTML = prefs.engines.map((e) =>
      `<button role="radio" aria-checked="false" data-engine="${e.id}"><span class="n">${esc(e.name)}</span><span class="h">${esc(e.host)}</span></button>`).join('');
    chooser.hidden = false;
    if (!askedEngine) { askedEngine = true; setTimeout(() => say('Which search engine do you like?', 5000), 900); }
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
  say(`${b.querySelector('.n').textContent} it is!`, 2500);
  setTimeout(() => { pose = 'idle'; drawMochi(); }, 1200);
  $('q').focus();
});

// ---------- Theme ----------
function applyTheme(payload) {
  if (!payload) return;
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
