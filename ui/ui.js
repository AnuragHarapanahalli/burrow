// Burrow chrome core: tabs (top strip or sidebar), toolbar, layout, strip Mochi.
// overlay.js (menus, suggestions), panel.js (library + settings) and bmbar.js build on these helpers.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const B = window.burrow;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const chrome = $('chrome');
const panel = $('panel');
const sidebar = $('sidebar');
const address = $('address');

const UI = {
  state: { tabs: [], workspaces: [], activeId: null, currentWs: null, tabsMode: 'auto' },
  theme: null,
  editing: false, // the user is typing in the address bar
};
const activeTab = () => UI.state.tabs.find((t) => t.id === UI.state.activeId);
const engineName = () => {
  const p = UI.theme?.prefs;
  return p?.engines.find((e) => e.id === p.searchEngine)?.name || 'the web';
};

// Replay a one-shot CSS animation on an element (e.g. the star "pop").
function bump(el, cls = 'bump') {
  if (!el || reducedMotion()) return;
  el.classList.remove(cls);
  void el.offsetWidth; // restart the animation
  el.classList.add(cls);
  el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
}

// ---------- Layout: tell the main process where websites may draw ----------
function sendLayout() {
  const top = chrome.offsetHeight;
  panel.style.top = top + 'px';
  sidebar.style.top = top + 'px';
  B.setLayout(top, panel.hidden ? 0 : panel.offsetWidth, sidebar.hidden ? 0 : sidebar.offsetWidth);
}
new ResizeObserver(sendLayout).observe(chrome);

// ---------- Tabs ----------
// Tabs are kept as live elements keyed by id, so new tabs can slide in and
// closed tabs can shrink away instead of everything being redrawn at once.
const tabEls = new Map();
let tabBox = null;
let lastWs = null;

function useSidebar() {
  const m = UI.state.tabsMode;
  return m === 'side' || (m === 'auto' && UI.state.tabs.length > 8);
}

function makeTab(t, side) {
  const el = document.createElement('div');
  el.className = side ? 'side-tab' : 'tab';
  el.dataset.id = t.id;
  el.setAttribute('role', 'tab');
  el.innerHTML = `<span class="num pixel"></span><span class="fav"></span><button class="snd" data-mute hidden tabindex="-1"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6h3l4-3v10l-4-3H2z"/><path class="w" d="M11 5.5c1 .7 1.5 1.6 1.5 2.5s-.5 1.8-1.5 2.5"/><path class="m" d="M11 6l4 4M15 6l-4 4"/></svg></button><span class="title"></span>
    <button class="close" data-close tabindex="-1"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg></button>`;
  return el;
}

function updateTab(el, t, i) {
  const active = t.id === UI.state.activeId;
  el.classList.toggle('active', active);
  el.classList.toggle('loading', !!t.loading);
  el.classList.toggle('asleep', !!t.asleep);
  el.classList.toggle('kept-awake', !!t.keepAwake);
  el.setAttribute('aria-selected', String(active));
  el.querySelector('.num').textContent = pad(i + 1);
  el.querySelector('.title').textContent = t.title;
  el.title = tabTooltip(t, i);
  el.querySelector('.close').setAttribute('aria-label', `Close ${t.title}`);
  // Speaker when the tab makes sound; click it to mute/unmute.
  const snd = el.querySelector('.snd');
  snd.hidden = !(t.audible || t.muted || (t.volume ?? 100) !== 100);
  snd.classList.toggle('muted', !!t.muted || t.volume === 0);
  snd.title = `Volume ${t.muted ? '(muted)' : (t.volume ?? 100) + '%'} — click to change`;
  snd.setAttribute('aria-label', snd.title);
  const fav = /^(https?:|data:)/.test(t.favicon || '') ? t.favicon : '';
  const slot = el.querySelector('.fav');
  if (slot.dataset.src !== fav) {
    slot.dataset.src = fav;
    slot.innerHTML = fav ? `<img src="${esc(fav)}" alt="">` : '';
  }
}

// The tab's hover tooltip: the full title, the site, and what it's doing (playing, muted, asleep…).
function tabTooltip(t, i) {
  let host = '';
  try { const u = new URL(t.url); host = /^https?:$/.test(u.protocol) ? u.hostname.replace(/^www\./, '') : ''; } catch { /* burrow:// page */ }
  const state = [
    t.loading && !t.asleep ? 'Loading…' : '',
    t.audible && !t.muted ? 'Playing sound' : '', t.muted ? 'Muted' : '',
    t.asleep ? 'Asleep — click to wake' : '', t.keepAwake ? 'Kept awake' : '',
    t.insecure ? 'Not secure' : '',
  ].filter(Boolean).join(' · ');
  return [t.title, host, state, i < 8 ? `Ctrl+${i + 1}` : ''].filter(Boolean).join('\n');
}

function renderTabs() {
  const side = useSidebar();
  document.body.classList.toggle('side-tabs-on', side);
  if (sidebar.hidden === side) { sidebar.hidden = !side; sendLayout(); }
  const box = side ? $('sideTabs') : $('tabs');
  // Switching workspace or tab position: redraw instantly, no animation storm.
  const instant = box !== tabBox || lastWs !== UI.state.currentWs || reducedMotion();
  if (box !== tabBox || lastWs !== UI.state.currentWs) {
    tabEls.forEach((el) => el.remove());
    tabEls.clear();
  }
  tabBox = box; lastWs = UI.state.currentWs;

  const ids = new Set(UI.state.tabs.map((t) => t.id));
  for (const [id, el] of tabEls) {
    if (ids.has(id)) continue;
    tabEls.delete(id);
    if (instant) { el.remove(); continue; }
    el.classList.add('closing');
    el.addEventListener('animationend', () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 400); // fallback
  }

  let prev = null;
  UI.state.tabs.forEach((t, i) => {
    let el = tabEls.get(t.id);
    if (!el) {
      el = makeTab(t, side);
      tabEls.set(t.id, el);
      if (!instant) {
        el.classList.add('opening');
        el.addEventListener('animationend', () => el.classList.remove('opening'), { once: true });
      }
    }
    updateTab(el, t, i);
    const want = prev ? prev.nextElementSibling : box.firstElementChild;
    if (want !== el) box.insertBefore(el, want);
    prev = el;
  });
  box.querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: instant ? 'auto' : 'smooth' });

  const ws = UI.state.workspaces.find((w) => w.id === UI.state.currentWs);
  document.body.classList.toggle('private', !!UI.state.isPrivate);
  $('wsName').textContent = UI.state.isPrivate ? 'PRIVATE' : (ws?.name || 'Home').toUpperCase();
}

function onTabMouseDown(e) {
  const tab = e.target.closest('[data-id]');
  if (!tab || tab.classList.contains('closing')) return;
  const id = Number(tab.dataset.id);
  if (e.target.closest('[data-mute]')) { e.preventDefault(); window.openVolume?.(id, e.target.closest('[data-mute]')); return; }
  if (e.target.closest('[data-close]') || e.button === 1) { e.preventDefault(); B.tabs.close(id); }
  else if (e.button === 0) B.tabs.activate(id);
}
$('tabs').addEventListener('mousedown', onTabMouseDown);
$('sideTabs').addEventListener('mousedown', onTabMouseDown);
$('newTab').addEventListener('click', () => B.tabs.create());
$('sideNew').addEventListener('click', () => B.tabs.create());

// ---------- Toolbar ----------
function renderToolbar() {
  const t = activeTab();
  $('back').disabled = !t?.canBack;
  $('forward').disabled = !t?.canForward;
  $('reload').classList.toggle('is-loading', !!t?.loading);
  $('reload').title = t?.loading ? 'Stop' : 'Reload (Ctrl+R)';
  $('reload').setAttribute('aria-label', t?.loading ? 'Stop' : 'Reload');
  if (!UI.editing) address.value = t?.url || '';
  $('secChip').hidden = !t?.insecure;
  renderAddrView(t);
  renderLoadBar(t);
  const rc = $('readChip');
  rc.hidden = !(t?.readMin >= 2) || UI.editing;
  rc.textContent = t?.readMin >= 2 ? `${t.readMin} MIN READ` : '';
  address.placeholder = `Search ${engineName()} or type a URL`;
  // Zoom chip: only shows when the page isn't at 100%; click resets.
  const zoomBtn = $('zoomBtn');
  const zoom = t?.zoom || 100;
  zoomBtn.hidden = zoom === 100;
  if (zoomBtn.textContent !== `${zoom}%`) { zoomBtn.textContent = `${zoom}%`; if (zoom !== 100) bump(zoomBtn, 'pop'); }
  // Picture-in-picture: shows once a video/audio has played on the page.
  const pipBtn = $('pipBtn');
  const showPip = !!t?.media;
  if (pipBtn.hidden === showPip) { pipBtn.hidden = !showPip; if (showPip) bump(pipBtn, 'pop'); }
  const star = $('star');
  const was = star.getAttribute('aria-pressed') === 'true';
  star.hidden = !t?.url || !/^https?:/i.test(t.url);
  star.setAttribute('aria-pressed', String(!!t?.bookmarked));
  star.title = t?.bookmarked ? 'Remove bookmark (Ctrl+D)' : 'Bookmark this page (Ctrl+D)';
  if (!was && t?.bookmarked && UI.lastStarTab === t.id) bump(star, 'pop');
  UI.lastStarTab = t?.id;
  document.title = t ? `${t.title} - Burrow` : 'Burrow';
}
// Honest address bar: when you're not typing, the address is shown with the site's domain in full ink
// and the rest muted (https:// hidden, like Chrome), a lock for HTTPS, "Not secure" for plain HTTP.
function renderAddrView(t) {
  const view = $('addrView');
  let u = null;
  try { u = t?.url ? new URL(t.url) : null; } catch { u = null; }
  const web = !!u && /^https?:$/.test(u.protocol) && !UI.editing;
  view.hidden = !web;
  $('addressForm').classList.toggle('has-view', web);
  $('siteIcon').hidden = !(web && u.protocol === 'https:');
  if (!web) { view.textContent = ''; return; }
  const host = u.hostname;
  const www = host.startsWith('www.') ? 'www.' : '';
  const rest = (u.port ? ':' + u.port : '') + (u.pathname === '/' && !u.search && !u.hash ? '' : u.pathname + u.search + u.hash);
  view.innerHTML = (u.protocol === 'http:' ? '<span class="av-dim">http://</span>' : '')
    + (www ? '<span class="av-dim">www.</span>' : '') + `<span class="av-host">${esc(host.slice(www.length))}</span>`
    + (rest ? `<span class="av-dim">${esc(rest)}</span>` : '');
}

// A thin bar along the bottom of the toolbar while the page loads.
let loadDone = 0;
function renderLoadBar(t) {
  const bar = $('loadBar');
  const loading = !!t?.loading && !t?.asleep;
  if (loading) { clearTimeout(loadDone); bar.classList.remove('done'); bar.classList.add('on'); }
  else if (bar.classList.contains('on')) {
    bar.classList.replace('on', 'done');
    clearTimeout(loadDone);
    loadDone = setTimeout(() => bar.classList.remove('done'), 400);
  }
}

$('back').onclick = () => B.nav.back();
$('forward').onclick = () => B.nav.forward();
$('reload').onclick = () => {
  if (activeTab()?.loading) return B.nav.stop();
  bump($('reload'), 'spin');
  B.nav.reload();
};
$('star').onclick = () => B.library.toggleBookmark();
$('zoomBtn').onclick = () => B.zoom(0);
async function popOut() {
  const r = await B.tabs.pip();
  if (r === 'none') toast('No video to pop out on this page');
}
window.popOut = popOut;
$('pipBtn').onclick = popOut;

// Tabs whose icon fails to load drop the broken image instead of leaving a gap.
document.addEventListener('error', (e) => { if (e.target.tagName === 'IMG') e.target.remove(); }, true);

B.tabs.onChange((s) => {
  const switched = s.activeId !== UI.state.activeId;
  UI.state = s;
  if (switched && UI.editing && window.hideOverlay) { window.hideOverlay(); address.blur(); }
  renderTabs();
  renderToolbar();
  window.renderWorkspaceMenu?.();
});

// ---------- Strip Mochi: walks in with something to say, then leaves ----------
// Everything Mochi says in the tab strip goes through mochiSay(). Settings → Mochi decides how chatty:
//   Lively: everything · Quiet: only important things ("essential") · Off: nothing.
let stripTimer = 0;
let stripStop = null;
let mochiLastChat = 0;
UI.mochiLog = []; // what Mochi said (the self-test reads this)
function mochiSay(text, { pose = 'happy', essential = false, ms = 5000, opens = null } = {}) {
  if (!UI.theme) return false;
  const mode = UI.theme.prefs?.mochiMode || 'lively';
  if (mode === 'off' || (mode === 'quiet' && !essential)) return false;
  const box = $('stripMochi');
  const now = Date.now();
  if (!essential) {
    if (now - mochiLastChat < 25000) return false;      // don't chatter
    if (!box.hidden && UI.stripEssential) return false;   // don't talk over something important
  }
  mochiLastChat = now;
  UI.stripEssential = essential;
  UI.stripClickOpens = opens;
  UI.mochiLog.push({ text, pose, essential, at: now });
  const sprite = $('stripSprite');
  const tokens = UI.theme.tokens;
  const settle = () => {
    stripStop?.(); stripStop = null;
    box.classList.remove('walking');
    sprite.innerHTML = window.Mochi.svg(tokens, pose, 30);
  };
  $('stripBubble').textContent = text;
  clearTimeout(stripTimer);
  if (box.hidden && !reducedMotion()) {
    // Walk in from the right, then say it.
    box.hidden = false;
    box.classList.add('walking');
    stripStop?.();
    stripStop = window.Mochi.play(sprite, tokens, ['walk1', 'walk2'], { fps: 8, size: 30 });
    setTimeout(settle, 620);
  } else {
    box.hidden = false;
    settle();
  }
  stripTimer = setTimeout(() => { box.hidden = true; UI.stripEssential = false; }, ms + 620);
  return true;
}
window.mochiSay = mochiSay;
// ---------- Toasts: system messages at the bottom left (main/toasts.js) ----------
// Mochi is the friendly voice; downloads, errors, undo and updates are toasts, so they show whatever
// Mochi's setting. toast('Saved x', { kind: 'success', action: 'Show', onAction: () => … })
const toastActions = new Map();
async function toast(text, { kind = 'info', action = null, onAction = null, ms = 0 } = {}) {
  const id = await B.toast({ text, kind, action, ms });
  if (id && onAction) { toastActions.set(id, onAction); setTimeout(() => toastActions.delete(id), 60000); }
  return id;
}
window.toast = toast;
B.onToastAction((id) => { const fn = toastActions.get(id); toastActions.delete(id); fn?.(); });

// Older calls: important messages (downloads, "couldn't find an article", …).
function stripMochi(text, ms = 5000, pose = 'happy') {
  return mochiSay(text, { essential: true, ms, pose, opens: UI.stripClickOpens || null });
}
$('stripMochi').addEventListener('click', () => {
  $('stripMochi').hidden = true;
  if (UI.stripClickOpens === 'report') B.openReport();
  else if (UI.stripClickOpens === 'tidy') window.openTidy?.();
  else if (UI.stripClickOpens === 'night') B.fun.night(true);
  else if (UI.stripClickOpens === 'update') B.updates.install();
  else if (UI.stripClickOpens) window.openPanel?.(UI.stripClickOpens);
});
// Messages from the main process (tabs put to sleep, "question copied", …).
B.onMochiSay((msg) => {
  const m = typeof msg === 'string' ? { text: msg } : (msg || {});
  mochiSay(String(m.text || ''), { pose: m.pose || 'happy', essential: m.essential !== false, ms: m.ms || 6000, opens: ['report', 'night', 'update'].includes(m.opens) ? m.opens : null });
});

// ---------- Theme + preferences ----------
B.theme.onChange((payload) => {
  window.Mochi.wear = payload?.prefs?.outfit || null;
  UI.theme = payload;
  UI.state.tabsMode = payload.prefs.tabsMode;
  window.BurrowTheme.apply(payload.tokens);
  renderToolbar();
  window.renderSettingsPane?.();
  window.renderBookmarksBar?.();
});

window.addEventListener('DOMContentLoaded', () => { B.ready(); sendLayout(); });

(window.__loaded = window.__loaded || []).push('ui');

// ---------- Browser fullscreen (F11): the bars hide; at the top edge they slide back in ----------
UI.full = null;
UI.fs = null; // (the self-test reads this)
// In fullscreen, Burrow's window shows only a small strip at the top centre: the exit note or the ✕.
B.fullscreen.onChange((st) => {
  UI.fs = st;
  UI.full = st?.mode || null;
  document.body.classList.toggle('is-full', !!st);
  document.body.classList.toggle('fs-mini', !!st && !st.big && (!!st.hint || st.exit));
  const hint = $('fsHint');
  hint.hidden = !st?.hint;
  if (st?.hint) hint.innerHTML = `Press <kbd>${st.hint === 'esc' ? 'Esc' : 'F11'}</kbd> to exit full screen`;
  $('fsExit').hidden = !(st?.exit && st.mode === 'browser' && !st.hint);
});
$('fsExit').addEventListener('click', () => B.fullscreen.toggle());
$('chrome').addEventListener('mouseenter', () => { if (UI.full === 'browser') B.fullscreen.peek(true); });
$('chrome').addEventListener('mouseleave', () => {
  // Keep them while you're typing in the address bar or a menu is open.
  if (UI.full === 'browser' && !UI.editing && $('overlay').hidden) B.fullscreen.peek(false);
});
