// Mochi's welcome tour: look, search engine, AI sign-in, shortcuts.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');

const STEPS = ['Hello', 'Bring', 'Look', 'Search', 'AI', 'Keys', 'Go'];
const SAY = [
  "Hi! I'll show you around.",
  'Moving in? I can carry boxes.',
  'Ooh, pick a colour you like.',
  'Your searches, your choice.',
  'Sign in once, ask anything later.',
  'Ctrl+K is my favourite.',
  "Let's go! I'll be around.",
];
const KEYS = [
  ['Ctrl K', 'Command palette', 'Find anything: tabs, actions, history, or ask AI.'],
  ['Ctrl T · Ctrl W', 'New / close tab', 'Ctrl+Shift+T brings a closed tab back.'],
  ['Ctrl Shift 1–9', 'Workspaces', 'Separate sets of tabs, like College and Personal.'],
  ['Ctrl \\', 'Split view', 'Two pages side by side. Pick which one.'],
  ['Ctrl Shift A', 'AI panel', 'Your AI chat docked beside any page.'],
  ['F9', 'Reader view', 'Just the article, nothing else.'],
  ['Ctrl Shift E', 'Notes', 'A note for every website.'],
  ['Ctrl F', 'Find in page', 'Enter for next, Shift+Enter for previous.'],
  ['Ctrl Shift N', 'Private window', 'No history, cookies wiped on close.'],
  ['Drag a tab', 'Move tabs', 'Reorder, or pull it off to open a new window.'],
];

let step = 0;
let payload = null;
const signedIn = new Set(); // sign-in pages you've opened during this tour

// ---------- Steps ----------
function renderSteps() {
  $('stepList').innerHTML = STEPS.map((s, i) =>
    `<li class="${i < step ? 'done' : i === step ? 'current' : ''}"><button data-go="${i}"><span class="pixel">${pad(i + 1)}</span>${s}</button></li>`).join('');
  document.querySelectorAll('.step').forEach((el) => { el.hidden = Number(el.dataset.step) !== step; });
  $('bar').style.width = `${((step + 1) / STEPS.length) * 100}%`;
  $('count').textContent = `${pad(step + 1)} / ${pad(STEPS.length)}`;
  $('back').disabled = step === 0;
  $('next').hidden = step === STEPS.length - 1;
  say(SAY[step]);
  if (step === STEPS.length - 1) renderSummary();
  if (step === 1) loadImport();
  document.querySelector(`.step[data-step="${step}"] h1`)?.focus({ preventScroll: true });
}
function goTo(i) {
  step = Math.max(0, Math.min(STEPS.length - 1, i));
  renderSteps();
}
$('next').onclick = () => goTo(step + 1);
$('back').onclick = () => goTo(step - 1);
$('stepList').addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) goTo(Number(b.dataset.go)); });
document.addEventListener('keydown', (e) => {
  if (e.target.closest('button, input')) return; // buttons handle their own Enter
  if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); if (step < STEPS.length - 1) goTo(step + 1); else finish(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(step - 1); }
});
function finish() { window.burrowPage.welcome('done'); }

// ---------- Bring your stuff: import from other browsers ----------
let impLoaded = false;
const impFmt = (n) => Number(n || 0).toLocaleString('en');
const impPl = (n, w) => `${impFmt(n)} ${w}${Number(n) === 1 ? '' : 's'}`;
const imported = []; // what you brought (for the summary)
async function loadImport() {
  if (impLoaded) return;
  impLoaded = true;
  const list = (await window.burrowPage.importSources()) || [];
  $('impCards').innerHTML = list.length
    ? list.map((src) => `<button class="card" data-import="${esc(src.id)}"><span class="n">${esc(src.label)}</span><span class="h">${impPl(src.bookmarks, 'bookmark')} &middot; ${impPl(src.history, 'page')}</span><span class="h pixel imp-state">IMPORT</span></button>`).join('')
    : '<p class="note">No other browsers found. Starting fresh is nice too.</p>';
}
$('impCards').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-import]');
  if (!b || b.disabled) return;
  b.disabled = true;
  b.querySelector('.imp-state').textContent = 'IMPORTING…';
  const r = await window.burrowPage.importRun(b.dataset.import);
  if (!r || r.error) { b.disabled = false; b.querySelector('.imp-state').textContent = 'TRY AGAIN'; return; }
  b.setAttribute('aria-checked', 'true');
  b.querySelector('.imp-state').textContent = `\u2713 ${impFmt(r.bookmarks.added)} BOOKMARKS \u00b7 ${impFmt(r.history.added)} PAGES`;
  imported.push(r.label);
  say('Unpacked! Everything has a place now.');
  if (r.top?.length && !$('impLinks')) {
    const p = document.createElement('p');
    p.className = 'note';
    p.innerHTML = `<button class="link-btn" id="impLinks">Add ${esc(r.top.map((t) => t.name).join(', '))} to your quick links</button>`;
    $('impNote').before(p);
    $('impLinks').onclick = async () => { await window.burrowPage.importQuickLinks(r.top); p.textContent = 'Added to your quick links.'; };
  }
});
$('skip').onclick = finish;
$('go').onclick = finish;

// ---------- Choices (they apply straight away) ----------
function render() {
  if (!payload) return;
  const { settings, presets, prefs } = payload;
  document.querySelectorAll('#modeSeg [data-mode]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === settings.mode)));
  $('swatches').innerHTML = presets.map((p) =>
    `<button role="radio" aria-checked="${!settings.useWindowsAccent && p.hex === settings.seed}" data-seed="${p.hex}" title="${esc(p.name)}">
      <span class="chip" style="background:${p.hex}"></span>${esc(p.name)}</button>`).join('');
  $('engines').innerHTML = prefs.engines.map((e) =>
    `<button class="card" role="radio" aria-checked="${prefs.searchChosen && e.id === prefs.searchEngine}" data-engine="${e.id}">
      <span class="n">${esc(e.name)}</span><span class="h">${esc(e.host)}</span></button>`).join('');
  $('ais').innerHTML = prefs.aiProviders.map((p) => `
    <div class="card ai-card${p.id === prefs.aiProvider ? ' chosen' : ''}">
      <span class="n">${esc(p.name)}</span><span class="h">${esc(p.host)}</span>
      <div class="ai-actions">
        <button class="pick" data-ai="${p.id}" aria-pressed="${p.id === prefs.aiProvider}">${p.id === prefs.aiProvider ? '&#10003; Default' : 'Make default'}</button>
        <button class="signin" data-signin="${p.id}">${signedIn.has(p.id) ? 'Opened &#10003;' : 'Sign in &nearr;'}</button>
      </div>
    </div>`).join('');
}
$('modeSeg').addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (b) window.burrowPage.welcome('mode', b.dataset.mode); });
$('swatches').addEventListener('click', (e) => { const b = e.target.closest('[data-seed]'); if (b) window.burrowPage.welcome('seed', b.dataset.seed); });
$('engines').addEventListener('click', (e) => {
  const b = e.target.closest('[data-engine]');
  if (!b) return;
  window.burrowPage.welcome('search', b.dataset.engine);
  say(`${b.querySelector('.n').textContent} it is!`);
});
$('ais').addEventListener('click', (e) => {
  const pick = e.target.closest('[data-ai]');
  const sign = e.target.closest('[data-signin]');
  if (pick) window.burrowPage.welcome('ai', pick.dataset.ai);
  if (sign) {
    signedIn.add(sign.dataset.signin);
    window.burrowPage.welcome('signin', sign.dataset.signin);
    say('Sign in there, then come back to this tab.');
    render();
  }
});

$('keys').innerHTML = KEYS.map(([k, t, d]) => `
  <div class="key"><span class="kbd pixel">${esc(k)}</span><b>${esc(t)}</b><span>${esc(d)}</span></div>`).join('');

function renderSummary() {
  if (!payload) return;
  const { settings, presets, prefs } = payload;
  const colour = presets.find((p) => p.hex === settings.seed)?.name || 'Custom';
  const engine = prefs.engines.find((e) => e.id === prefs.searchEngine)?.name;
  const ai = prefs.aiProviders.find((p) => p.id === prefs.aiProvider)?.name;
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  $('summary').innerHTML = [
    ...(imported.length ? [['Brought', `Bookmarks and history from ${imported.join(', ')}`]] : []),
    ['Look',`${cap(settings.mode === 'system' ? 'follow Windows' : settings.mode)} · ${colour}`],
    ['Search', engine],
    ['AI', `${ai}${signedIn.size ? ` · opened sign-in for ${[...signedIn].map((id) => prefs.aiProviders.find((p) => p.id === id)?.name).join(', ')}` : ''}`],
  ].map(([k, v]) => `<dt class="pixel">${k.toUpperCase()}</dt><dd>${esc(v)}</dd>`).join('');
}

// ---------- Mochi ----------
let pose = 'wave';
let tokens = null;
let sayTimer;
function drawMochi() { if (tokens) $('mochi').innerHTML = window.Mochi.svg(tokens, pose, 96); }
function say(text) {
  const b = $('bubble');
  b.textContent = text;
  b.classList.remove('pop');
  void b.offsetWidth;
  b.classList.add('pop');
  pose = 'happy'; drawMochi();
  clearTimeout(sayTimer);
  sayTimer = setTimeout(() => { pose = 'idle'; drawMochi(); }, 1200);
}

// ---------- Theme + settings from Burrow ----------
function apply(p) {
  if (!p) return;
  payload = p;
  tokens = p.tokens;
  window.Mochi.wear = p.prefs?.outfit || null;
  window.BurrowTheme.apply(p.tokens);
  drawMochi();
  render();
  if (step === STEPS.length - 1) renderSummary();
}
window.burrowPage.getTheme().then((p) => { apply(p); renderSteps(); });
window.burrowPage.onTheme(apply);
