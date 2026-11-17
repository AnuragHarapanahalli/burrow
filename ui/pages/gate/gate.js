// The Burrow gate: shown instead of a site whose daily time is used up (or during a focus session).
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const P = window.burrowPage;
let info = null;
let tokens = null;

const mmss = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

function render() {
  if (!info) return;
  const focus = info.reason === 'focus';
  document.title = focus ? 'Focus session' : `${info.name} is closed for today`;
  $('kicker').textContent = focus ? 'FOCUS SESSION' : 'CLOSED FOR TODAY';
  $('title').innerHTML = focus
    ? `${esc(info.name)} can wait<span class="dot">.</span>`
    : `${esc(info.name)} is closed for today<span class="dot">.</span>`;
  $('lead').textContent = focus
    ? `You're in a focus session. ${info.name} opens again when it ends.`
    : `You spent ${info.usedMin} min here today${info.budget ? ` (your limit is ${info.budget})` : ''}. It opens again tomorrow.`;
  const pills = [];
  if (info.streak > 0) pills.push(`<span class="pill pixel">STREAK &middot; ${info.streak} DAY${info.streak === 1 ? '' : 'S'}</span>`);
  if (focus) pills.push(`<span class="pill pixel" id="sessLeft">${mmss(info.sessionLeftSec)} LEFT</span>`);
  $('pills').innerHTML = pills.join('');

  const cards = [`<button class="card" data-act="back"><b>&larr; Go back</b><span>Where you were before</span></button>`];
  for (const l of info.links) cards.push(`<button class="card" data-act="open" data-url="${esc(l.url)}"><b>${esc(l.name)}</b><span>${esc(new URL(l.url).host.replace(/^www\./, ''))}</span></button>`);
  if (focus) cards.push(`<button class="card" data-act="end-session"><b>End session early</b><span>${esc(info.name)} opens again</span></button>`);
  else cards.push(`<button class="card" data-act="start-session"><b>Start a focus session</b><span>25 minutes, Mochi guards</span></button>`);
  cards.push(`<button class="card" data-act="stretch"><b>2-minute stretch</b><span>Stand up, breathe, come back</span></button>`);
  $('choices').innerHTML = cards.join('');
  $('unlock').hidden = focus;
  $('phrase').textContent = `I'm choosing more time on ${info.name}`;
  $('breatheBtn').textContent = `Breathe for ${info.wait} seconds`;
}

$('choices').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  if (b.dataset.act === 'stretch') return startStretch();
  P.gateAction(b.dataset.act, b.dataset.url || '');
});

// ---------- 2-minute stretch ----------
const TIPS = ['Stand up. Roll your shoulders back, slowly.', 'Look at something far away for a bit.', 'Stretch your arms up high.', 'Take three slow breaths.', 'Shake out your hands.', 'Welcome back.'];
let stretchTimer = 0;
function startStretch() {
  let left = 120;
  $('stretch').hidden = false;
  $('choices').hidden = true;
  clearInterval(stretchTimer);
  const step = () => {
    $('stretchTime').textContent = mmss(left);
    $('stretchTip').textContent = TIPS[Math.min(TIPS.length - 1, Math.floor((120 - left) / 24))];
    if (left-- <= 0) stopStretch();
  };
  step();
  stretchTimer = setInterval(step, 1000);
}
function stopStretch() { clearInterval(stretchTimer); $('stretch').hidden = true; $('choices').hidden = false; }
$('stretchStop').onclick = stopStretch;

// ---------- Friction unlock: type the sentence, breathe, then 5 more minutes ----------
$('needMore').onclick = () => { $('unlockBody').hidden = false; $('needMore').hidden = true; $('phraseInput').focus(); };
const norm = (s) => s.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
$('phraseInput').addEventListener('input', () => {
  const ok = info && norm($('phraseInput').value) === norm($('phrase').textContent);
  $('breatheBtn').disabled = !ok;
  $('phraseInput').classList.toggle('ok', !!ok);
});
$('phraseInput').addEventListener('paste', (e) => e.preventDefault()); // typing it is the point
$('breatheBtn').onclick = async () => {
  const wait = await P.gateStart();
  if (!wait) return;
  $('breatheBtn').hidden = true;
  $('phraseInput').disabled = true;
  $('breathe').hidden = false;
  let left = wait;
  let t = 0;
  const tick = () => {
    $('breathLeft').textContent = `${left}S`;
    $('breathWord').textContent = Math.floor((wait - left) / 4) % 2 === 0 ? 'Breathe in' : 'Breathe out';
    if (left-- <= 0) {
      clearInterval(t);
      $('breathe').hidden = true;
      $('openBtn').hidden = false;
      $('openBtn').textContent = `Open ${info.name} for ${info.unlockMinutes} minutes`;
      $('openBtn').focus();
    }
  };
  t = setInterval(tick, 1000);
  tick();
};
$('openBtn').onclick = async () => {
  const ok = await P.gateUnlock();
  if (!ok) { $('openBtn').textContent = "That didn't work. Try again from the start."; }
};

// ---------- Load ----------
async function load() {
  info = await P.gateInfo();
  if (!info) return;
  if (info.open) { P.gateAction('continue'); return; } // limit lifted meanwhile
  render();
}
setInterval(async () => {
  if (info?.reason !== 'focus') return;
  const fresh = await P.gateInfo();
  if (!fresh) return;
  if (fresh.open) { P.gateAction('continue'); return; }
  info.sessionLeftSec = fresh.sessionLeftSec;
  const el = $('sessLeft');
  if (el) el.textContent = `${mmss(info.sessionLeftSec)} LEFT`;
}, 1000);

function applyTheme(p) {
  if (!p?.tokens) return;
  tokens = p.tokens;
  window.BurrowTheme.apply(tokens);
  $('mochi').innerHTML = window.Mochi.svg(tokens, 'sleepy', 120);
}
P.getTheme().then(applyTheme);
P.onTheme(applyTheme);
load();
