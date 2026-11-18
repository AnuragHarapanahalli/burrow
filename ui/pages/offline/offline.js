// No internet, or a site that can't be reached: Burrow's own page, with Mochi Hop — a tiny game.
// When the connection comes back, the page returns to the site by itself (unless you're mid-game).
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const P = window.burrowPage;
const q = new URLSearchParams(location.search);
const playOnly = q.get('play') === '1';
let info = null;
let tokens = null;

// ---------- The message ----------
const WHY = {
  '-105': "Burrow couldn't find this site. Check the address for typos.",
  '-137': "Burrow couldn't find this site. Check the address for typos.",
  '-102': 'The site refused to connect.',
  '-118': 'It took too long to answer.',
  '-7': 'It took too long to answer.',
  '-109': "The site's address can't be reached.",
};
function render() {
  if (playOnly) {
    $('kicker').textContent = 'A LITTLE BREAK';
    $('title').innerHTML = 'Mochi Hop<span class="dot">.</span>';
    $('lead').textContent = 'Hop over puddles and pebbles, collect carrots. Five carrots in the game earn Mochi one real one (up to five a day).';
    $('btns').hidden = true;
    document.title = 'Mochi Hop';
    return;
  }
  if (!info) return;
  if (info.code === -999) {
    // The page crashed (not a network problem): Mochi fainted; Reload tries again.
    $('kicker').textContent = 'THIS TAB CRASHED';
    $('title').innerHTML = 'Mochi fainted<span class="dot">.</span>';
    $('lead').textContent = `${info.host || 'This page'} stopped working. Reload to try again — your other tabs are fine.`;
    $('retry').textContent = 'Reload';
    document.title = 'Tab crashed';
    return;
  }
  const offline = info.code === -106 || !navigator.onLine;
  $('kicker').textContent = offline ? 'NO INTERNET' : "CAN'T REACH THIS SITE";
  $('title').innerHTML = offline ? 'You’re offline<span class="dot">.</span>' : `${esc(info.host || 'This site')} isn’t answering<span class="dot">.</span>`;
  $('lead').textContent = offline
    ? `Burrow will open ${info.host || 'the page'} again as soon as you're back online. Meanwhile, Mochi's bored.`
    : `${WHY[String(info.code)] || 'Something went wrong on the way there.'} Burrow keeps checking and opens it when it answers.`;
  document.title = offline ? 'Offline' : `Can't reach ${info.host}`;
}

// ---------- Coming back online ----------
let checking = false;
async function retry(manual) {
  if (playOnly || checking || !info?.url) return;
  if (info.code === -999 && !manual) return; // after a crash, only reload when you ask
  checking = true;
  $('status').textContent = manual ? 'CHECKING…' : '';
  const ok = await P.offlineRetry(!game.running);
  checking = false;
  if (ok && game.running) { $('backOnline').hidden = false; $('status').textContent = ''; }
  else if (!ok && manual) $('status').textContent = 'STILL NOT ANSWERING';
}
$('retry').onclick = () => retry(true);
$('back').onclick = () => history.back();
$('goBack').onclick = () => P.offlineRetry(true);
window.addEventListener('online', () => retry(false));
setInterval(() => retry(false), 5000);

// ---------- Mochi Hop ----------
const cv = $('hop');
const ctx = cv.getContext('2d');
const W = 760, H = 220, GROUND = 186;
const MOCHI_W = 45, MOCHI_H = 36; // sprite drawn at 3 px per pixel
const sprites = {};
function loadSprites() {
  for (const pose of ['walk1', 'walk2', 'happy', 'oops', 'idle']) {
    const img = new Image();
    // (An SVG used as an image needs its namespace; inline SVG doesn't.)
    const markup = window.Mochi.svg(tokens, pose, MOCHI_W).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup);
    sprites[pose] = img;
  }
}
const game = {
  running: false, over: false, t: 0,
  y: 0, vy: 0, hops: 0, speed: 6, score: 0, carrots: 0,
  things: [], nextThing: 60, best: 0,
};
window.hop = game; // (the self-test drives the game through this)

function reset() {
  Object.assign(game, { running: true, over: false, t: 0, y: 0, vy: 0, hops: 0, speed: 6, score: 0, carrots: 0, things: [], nextThing: 60 });
  $('backOnline').hidden = true;
}
game.start = () => { reset(); };
game.jump = () => {
  if (!game.running) { reset(); return; }
  if (game.hops >= 2) return; // a hop and a double-hop
  game.vy = game.hops === 0 ? -11.5 : -9.5;
  game.hops++;
};
function crash() {
  game.running = false;
  game.over = true;
  const score = Math.floor(game.score);
  P.hopScore(score, game.carrots).then((r) => {
    if (!r) return;
    game.best = r.best;
    $('best').textContent = r.best;
    game.result = r;
    draw();
  });
}
game.crash = crash;

// Puddles (flat), pebbles (small, or a pair), and carrots to collect up in the air.
function spawn() {
  const kind = Math.random();
  if (kind < 0.35) game.things.push({ type: 'puddle', x: W + 10, w: 30 + Math.random() * 26, h: 6 });
  else if (kind < 0.7) game.things.push({ type: 'pebble', x: W + 10, w: 15, h: 15 });
  else if (kind < 0.85 && game.score > 150) game.things.push({ type: 'pebble', x: W + 10, w: 33, h: 18 });
  else game.things.push({ type: 'carrot', x: W + 10, w: 9, h: 15, y: GROUND - 60 - Math.random() * 50 });
  game.nextThing = 42 + Math.random() * 60 - Math.min(20, game.speed);
}

function step(dt) {
  if (!game.running) return;
  game.t += dt;
  game.speed = Math.min(13, 6 + game.t * 0.0025);
  game.score += game.speed * dt * 0.1;
  // Mochi: gravity, landing.
  game.vy += 0.75 * dt;
  game.y = Math.min(0, game.y + game.vy * dt);
  if (game.y === 0) { game.vy = 0; game.hops = 0; }
  // The world scrolls by.
  game.nextThing -= dt;
  if (game.nextThing <= 0) spawn();
  const mx = 70, my = GROUND - MOCHI_H + game.y;
  for (const o of game.things) {
    o.x -= game.speed * dt;
    const oy = o.type === 'carrot' ? o.y : GROUND - o.h;
    const hit = mx + 8 < o.x + o.w && mx + MOCHI_W - 8 > o.x && my + 6 < oy + o.h && my + MOCHI_H > oy + 2;
    if (!hit || o.gone) continue;
    if (o.type === 'carrot') { o.gone = true; game.carrots++; }
    else { crash(); break; }
  }
  game.things = game.things.filter((o) => o.x + o.w > -20 && !o.gone);
}

function draw() {
  if (!tokens) return;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = tokens.surface || '#fff';
  ctx.fillRect(0, 0, W, H);
  // Ground: a line with a few pixel tufts drifting by.
  ctx.fillStyle = tokens.fg;
  ctx.fillRect(0, GROUND, W, 2);
  ctx.fillStyle = tokens.line || tokens.muted;
  const off = (game.t * game.speed) % 40;
  for (let x = -off; x < W; x += 40) ctx.fillRect(x, GROUND + 8, 6, 2);
  for (const o of game.things) {
    if (o.type === 'puddle') { ctx.fillStyle = tokens.muted; ctx.fillRect(o.x, GROUND - 4, o.w, 4); ctx.fillStyle = tokens.surface; ctx.fillRect(o.x + 6, GROUND - 3, 6, 1); }
    else if (o.type === 'pebble') { ctx.fillStyle = tokens.fg; ctx.fillRect(o.x + 3, GROUND - o.h, o.w - 6, 3); ctx.fillRect(o.x, GROUND - o.h + 3, o.w, o.h - 3); }
    else { ctx.fillStyle = tokens.accent; ctx.fillRect(o.x + 1, o.y + 4, 7, 11); ctx.fillStyle = tokens.mochiInk || tokens.fg; ctx.fillRect(o.x + 2, o.y, 2, 4); ctx.fillRect(o.x + 5, o.y + 1, 2, 3); }
  }
  const pose = game.over ? 'oops' : !game.running ? 'idle' : game.y < 0 ? 'happy' : Math.floor(game.t / 6) % 2 ? 'walk1' : 'walk2';
  const img = sprites[pose];
  if (img?.complete && img.naturalWidth) ctx.drawImage(img, 70, GROUND - MOCHI_H + game.y, MOCHI_W, MOCHI_H);
  ctx.fillStyle = tokens.fg;
  ctx.font = '12px Silkscreen, monospace';
  ctx.textAlign = 'center';
  if (!game.running && !game.over) ctx.fillText('PRESS SPACE TO HOP', W / 2, 80);
  if (game.over) {
    ctx.fillText(game.result?.isBest ? 'NEW BEST!' : 'OOPS!', W / 2, 70);
    ctx.fillText(game.result?.carrots ? `+${game.result.carrots} CARROT${game.result.carrots === 1 ? '' : 'S'} FOR MOCHI` : 'SPACE TO PLAY AGAIN', W / 2, 92);
  }
  $('score').textContent = Math.floor(game.score);
  $('carrots').textContent = game.carrots;
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(3, (now - last) / 16.67);
  last = now;
  requestAnimationFrame(frame); // first, so one bad frame can never stop the game
  step(dt);
  draw();
}

const hopKeys = new Set([' ', 'ArrowUp', 'w', 'W']);
document.addEventListener('keydown', (e) => {
  if (!hopKeys.has(e.key) || e.target.closest('button')) return;
  e.preventDefault();
  game.jump();
});
cv.addEventListener('pointerdown', (e) => { e.preventDefault(); cv.focus(); game.jump(); });

// ---------- Theme ----------
function applyTheme(p) {
  if (!p?.tokens) return;
  tokens = p.tokens;
  window.BurrowTheme.apply(tokens);
  window.Mochi.wear = p.prefs?.outfit || null;
  loadSprites();
  draw();
}
P.getTheme().then(applyTheme);
P.onTheme(applyTheme);
(async () => {
  const got = await P.offlineInfo();
  if (got) { game.best = got.best || 0; $('best').textContent = game.best; }
  info = playOnly ? null : got;
  render();
  if (playOnly) cv.focus();
  requestAnimationFrame(frame);
})();
