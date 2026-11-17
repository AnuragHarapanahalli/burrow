// Focus tools in the interface: the countdown chip, the focus-session bar, and Mochi eating a tab
// when its time is up (after offering "1 more minute"). Names start with "fu" to avoid clashes.

// =============== Countdown chip + focus-session bar ===============
const fuMmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.max(0, sec) % 60).padStart(2, '0')}`;
UI.focus = null;
B.focus.onState((st) => {
  UI.focus = st;
  const chip = $('focusChip');
  const parts = [];
  if (st.session) parts.push(`<span class="fc-sess">${st.session.phase === 'focus' ? 'FOCUS' : 'BREAK'} ${fuMmss(st.session.leftSec)}</span>`);
  if (st.site && st.remainingSec !== null && st.remainingSec <= 300) parts.push(`<span class="fc-site">${esc(st.name.toUpperCase())} ${fuMmss(st.remainingSec)}</span>`);
  chip.hidden = !parts.length;
  chip.innerHTML = parts.join('');
  chip.classList.toggle('urgent', !!st.site && st.remainingSec !== null && st.remainingSec <= 60);
  // A thin bar under the toolbar shows how far through the focus session (or break) you are.
  const bar = $('focusBar');
  bar.hidden = !st.session;
  if (st.session) {
    const total = (st.session.phase === 'focus' ? 25 : 5) * 60;
    bar.style.width = `${Math.min(100, (1 - st.session.leftSec / total) * 100)}%`;
    bar.classList.toggle('break', st.session.phase === 'break');
  }
});

// =============== Time's up: Mochi offers a minute, then eats the tab ===============
const fuEater = $('eater');
const fuSprite = $('eaterSprite');
const fuBubble = $('eaterBubble');
let fuStop = null;
const FU_CAPTION_SPACE = 158; // Windows' minimise / maximise / close buttons (146 px) plus a gap
let fuBusy = false;
UI.eatLog = []; // what happened (the self-test reads this)

const fuWait = (ms) => new Promise((r) => setTimeout(r, ms));
function fuPose(pose) { fuStop?.(); fuStop = null; fuSprite.innerHTML = window.Mochi.svg(UI.theme.tokens, pose, 32); }
function fuAnimate(frames, fps) { fuStop?.(); fuStop = window.Mochi.play(fuSprite, UI.theme.tokens, frames, { fps, size: 32 }); }
// Move Mochi to x (px from the left) at walking pace.
async function fuWalkTo(x) {
  const from = parseFloat(fuEater.style.left) || x;
  const ms = Math.max(300, Math.min(1600, Math.abs(x - from) * 2.2));
  fuAnimate(['walk1', 'walk2'], 8);
  fuEater.style.transition = `left ${ms}ms linear`;
  fuEater.style.left = x + 'px';
  await fuWait(ms);
  fuEater.style.transition = '';
}
function fuSay(html) { fuBubble.innerHTML = html; fuBubble.hidden = !html; }

B.focus.onTimeUp(async ({ site, name, snoozesLeft, tabIds }) => {
  if (fuBusy) return;
  fuBusy = true;
  UI.eatLog.push({ site, at: Date.now(), step: 'timeup' });
  $('stripMochi').hidden = true;
  try {
    await fuOffer(site, name, snoozesLeft) || await fuEat(site, name, tabIds);
  } finally {
    fuBusy = false;
  }
});

// Step 1: "Time's up!" with a 5-second "1 more minute" button. Resolves true if you took it.
async function fuOffer(site, name, snoozesLeft) {
  const button = snoozesLeft > 0 ? `<button class="eat-snooze" id="eatSnooze">1 more minute <span class="pixel">(${snoozesLeft} LEFT)</span></button>` : '';
  const bubble = (s) => `<b>Time's up for ${esc(name)}!</b> ${button}<span class="pixel eat-count">${s}</span>`;
  // Measure Mochi + the bubble first, so the bubble ends left of the window's minimise/maximise/close buttons.
  fuEater.style.left = '0px';
  fuEater.style.top = '4px';
  fuEater.style.visibility = 'hidden';
  fuEater.hidden = false;
  fuPose('walk1'); // Mochi's sprite counts towards the width too
  fuSay(bubble(5));
  const startX = Math.max(160, window.innerWidth - FU_CAPTION_SPACE - fuEater.offsetWidth);
  fuSay('');
  fuEater.style.left = (window.innerWidth - FU_CAPTION_SPACE) + 'px';
  fuEater.style.visibility = '';
  if (!reducedMotion()) await fuWalkTo(startX);
  else fuEater.style.left = startX + 'px';
  fuPose('wave');
  let choice = null;
  for (let s = 5; s > 0 && !choice; s--) {
    fuSay(bubble(s));
    const btn = $('eatSnooze');
    if (btn) btn.onclick = () => { choice = 'snooze'; };
    for (let i = 0; i < 10 && !choice; i++) await fuWait(100);
  }
  if (choice === 'snooze' && await B.focus.snooze(site)) {
    UI.eatLog.push({ site, at: Date.now(), step: 'snoozed' });
    fuPose('happy');
    fuSay('Okay, one more minute!');
    await fuWait(1800);
    fuEater.hidden = true;
    return true;
  }
  fuSay('');
  return false;
}

// Step 2: walk to the tab and eat it (chomp, chomp, chomp), with pixel crumbs.
async function fuEat(site, name, tabIds) {
  const el = tabIds.map((id) => document.querySelector(`#tabs [data-id="${id}"], #sideTabs [data-id="${id}"]`)).find(Boolean);
  if (!el || reducedMotion()) {
    UI.eatLog.push({ site, at: Date.now(), step: 'no-animation', foundTab: !!el, tabIds, reduced: reducedMotion() });
    if (el) el.classList.add('eaten-fade');
    await fuWait(el ? 400 : 0);
    B.focus.eaten(site);
    fuPose('happy');
    fuSay(`That's ${esc(name)} for today.`);
    UI.eatLog.push({ site, at: Date.now(), step: 'eaten' });
    await fuWait(2200);
    fuEater.hidden = true;
    return;
  }
  const r = el.getBoundingClientRect();
  const sideways = el.classList.contains('side-tab');
  // Stand just past the tab's right edge (or below it in the sidebar), facing it.
  fuEater.style.top = (sideways ? r.top + r.height / 2 - 14 : 4) + 'px';
  await fuWalkTo(sideways ? r.right + 4 : r.right - 8);
  el.classList.add('doomed');
  await fuWait(350);
  el.classList.add('being-eaten');
  fuAnimate(['chomp1', 'chomp2'], 5);
  fuCrumbs(sideways ? r.right + 10 : r.right, sideways ? r.top + r.height / 2 : r.bottom - 6);
  await fuWait(1250);
  UI.eatLog.push({ site, at: Date.now(), step: 'eaten' });
  B.focus.eaten(site);
  fuPose('happy');
  fuSay(`Nom! That's ${esc(name)} for today.`);
  await fuWait(2400);
  fuSay('');
  await fuWalkTo(window.innerWidth + 40);
  fuEater.hidden = true;
}

// Pixel crumbs falling from Mochi's mouth.
function fuCrumbs(x, y) {
  for (let i = 0; i < 10; i++) {
    const c = document.createElement('span');
    c.className = 'crumb';
    c.style.left = x + 'px';
    c.style.top = y + 'px';
    c.style.setProperty('--dx', `${Math.round((Math.random() - 0.5) * 60)}px`);
    c.style.setProperty('--dy', `${Math.round(20 + Math.random() * 40)}px`);
    c.style.animationDelay = `${Math.round(Math.random() * 600)}ms`;
    document.body.append(c);
    setTimeout(() => c.remove(), 1800);
  }
}

(window.__loaded = window.__loaded || []).push('focus-ui');
