// Ctrl+K command palette: one box for actions, open tabs, bookmarks, history, Search and Ask AI.
// (Names here start with "pal" so they can't clash with the other interface scripts.)
const palEl = $('palette');
const palInput = $('palInput');
const palList = $('palList');
FLOATERS.palette = palEl; // lets overlay.js show/hide it like the other floating menus
let palRows = [];
let palSel = 0;
let palTabs = [];
let palQuery = 0; // ignore slow answers for an older query

// ---------- Fuzzy matching: letters in order; word starts and runs score higher ----------
function palScore(q, text) {
  q = q.toLowerCase(); text = String(text || '').toLowerCase();
  if (!q) return 1;
  const at = text.indexOf(q);
  if (at >= 0) return 100 - Math.min(at, 50) + (at === 0 || /\W/.test(text[at - 1]) ? 40 : 0);
  let ti = 0, score = 0, run = 0;
  for (const ch of q) {
    if (ch === ' ') continue;
    const i = text.indexOf(ch, ti);
    if (i < 0) return -1;
    run = i === ti ? run + 1 : 0;
    score += 1 + run * 2 + (i === 0 || /\W/.test(text[i - 1]) ? 4 : 0);
    ti = i + 1;
  }
  return score;
}

// ---------- Actions ----------
function palActions() {
  const t = activeTab();
  const p = UI.theme?.prefs;
  const priv = !!UI.state.isPrivate;
  const A = (label, run, key = '', words = '') => ({ kind: 'action', label, run, key, words });
  const list = [
    A('New tab', () => B.tabs.create(), 'CTRL T'),
    A('New window', () => B.openWindow(), 'CTRL N'),
    A('New private window', () => B.openPrivate(), 'CTRL SHIFT N', 'incognito'),
    A('Reopen closed tab', () => B.tabs.reopen(), 'CTRL SHIFT T', 'undo restore'),
    // If Google says "Couldn't sign you in", try another way of signing in (see main/signin.js).
    ...[['both', 'Chrome pieces + Electron identity (default)'], ['chrome', 'Chrome pieces'], ['electron', 'Electron identity']].map(([m, name]) =>
      A(`Google sign-in method: ${name}`, async () => { await B.signInMethod(m); toast(`Google sign-in method: ${name}. Try signing in again.`); }, '', 'google login account sign in signin gmail youtube method')),
    A('Find in page', () => openFind(), 'CTRL F', 'search text'),
    A('Zoom in', () => B.zoom(1), 'CTRL +', 'bigger larger'),
    A('Zoom out', () => B.zoom(-1), 'CTRL -', 'smaller'),
    A('Reset zoom', () => B.zoom(0), 'CTRL 0', '100%'),
    A('Picture in picture', () => popOut(), '', 'video pop out pip'),
    A(p?.bookmarksBar ? 'Hide bookmarks bar' : 'Show bookmarks bar', () => B.setPrefs({ bookmarksBar: !p?.bookmarksBar }), 'CTRL SHIFT B'),
    A('History', () => openPanel('history'), 'CTRL H'),
    A('Bookmarks', () => openPanel('bookmarks'), 'CTRL SHIFT O'),
    A('Downloads', () => openPanel('downloads'), 'CTRL J'),
    A('Settings', () => openPanel('settings'), '', 'preferences options theme colour search engine'),
    A('Switch to light theme', () => B.theme.set({ mode: 'light' }), '', 'mode'),
    A('Switch to dark theme', () => B.theme.set({ mode: 'dark' }), '', 'mode night'),
    A('Follow system theme', () => B.theme.set({ mode: 'system' }), '', 'mode auto'),
    A('Soft paper look', () => B.theme.set({ look: 'soft' }), '', 'look style calm theme design'),
    A('Classic look', () => B.theme.set({ look: 'classic' }), '', 'look style sharp theme design old'),
    A('Compact density', () => B.theme.set({ density: 'compact' }), '', 'small dense size'),
    A('Comfortable density', () => B.theme.set({ density: 'comfortable' }), '', 'big size spacing'),
    A('Welcome tour', () => B.tabs.navigate('burrow://welcome/'), '', 'help shortcuts keys tutorial guide onboarding'),
    A('Report a bug', () => B.tabs.navigate('burrow://newtab/#report-bug'), '', 'issue problem feedback'),
  ];
  if (t) {
    list.push(A('Close tab', () => B.tabs.close(t.id), 'CTRL W'));
    if (/^https?:/i.test(t.url || '')) list.push(A(t.bookmarked ? 'Remove bookmark' : 'Bookmark this page', () => B.library.toggleBookmark(), 'CTRL D', 'star save'));
    if (t.audible || t.muted) list.push(A(t.muted ? 'Unmute tab' : 'Mute tab', () => B.tabs.mute(t.id), '', 'sound audio'));
  }
  if (!priv) {
    list.push(A('New workspace', () => { openWorkspaceMenu(); wsEditing = 'new'; renderWorkspaceMenu(); }, '', 'space'));
    UI.state.workspaces.forEach((w, i) => {
      if (w.id !== UI.state.currentWs) list.push(A(`Switch to ${w.name}`, () => B.workspaces.switchTo(w.id), i < 9 ? `CTRL SHIFT ${i + 1}` : '', 'workspace space'));
    });
  }
  (p?.aiProviders || []).forEach((ai) => {
    if (ai.id !== p.aiProvider) list.push(A(`Use ${ai.name} for Ask AI`, () => B.setPrefs({ aiProvider: ai.id }), '', 'assistant ai chat'));
  });
  return list;
}

// ---------- Building the list ----------
// On a new tab, results open right here; otherwise in a new tab so you don't lose your page.
const palHere = () => !activeTab()?.url;

function palTyped(q) {
  if (!q) return [];
  if (looksLikeUrl(q)) return [{ kind: 'go', text: q }];
  const search = { kind: 'search', text: q };
  const ask = { kind: 'ask', text: q };
  return askFirst(q) ? [ask, search] : [search, ask];
}

function palBuild(q, library = []) {
  if (!q) {
    // Nothing typed yet: your other tabs, then handy actions.
    const tabs = palTabs.filter((t) => !t.active).slice(0, 6).map((t) => ({ kind: 'tab', ...t }));
    return [...tabs, ...palActions().slice(0, 8)];
  }
  const scored = [];
  for (const a of palActions()) {
    const sc = Math.max(palScore(q, a.label), palScore(q, a.words) - 10);
    if (sc > 0) scored.push({ ...a, sc: sc + 5 });
  }
  for (const t of palTabs) {
    const sc = Math.max(palScore(q, t.title), palScore(q, t.url) - 5, palScore(q, t.ws) - 20);
    if (sc > 0) scored.push({ kind: 'tab', ...t, sc });
  }
  scored.sort((a, b) => b.sc - a.sc);
  const matches = scored.slice(0, 8);
  const seen = new Set(palTabs.map((t) => t.url));
  const lib = library.filter((l) => !seen.has(l.url)).slice(0, 5);
  const typed = palTyped(q);
  // Questions put Ask AI on top; otherwise the best matches come first.
  if (typed[0]?.kind === 'ask' || !matches.length) return [...typed, ...matches, ...lib];
  return [...matches, ...typed, ...lib];
}

const PAL_LABEL = { action: 'ACTION', tab: 'TAB', bookmark: '&#9733; SAVED', history: 'PAST', ask: 'ASK', search: 'FIND', go: 'GO' };

function palRender() {
  if (!palRows.length) {
    palList.innerHTML = '<div class="pal-empty">Nothing matches. Press Enter to search.</div>';
    return;
  }
  palList.innerHTML = palRows.map((r, i) => {
    let main, label = PAL_LABEL[r.kind], right = '';
    if (r.kind === 'action') { main = esc(r.label); right = r.key; }
    else if (r.kind === 'tab') {
      main = `${esc(r.title)}<span class="u">${esc((r.url || '').replace(/^https?:\/\/(www\.)?/, ''))}</span>`;
      if (!r.here) label = `TAB &middot; ${esc(r.ws.toUpperCase())}`;
    } else if (r.kind === 'ask') main = `Ask ${esc(aiName())}: <b>${esc(r.text)}</b>`;
    else if (r.kind === 'search') main = `Search ${esc(engineName())} for <b>${esc(r.text)}</b>`;
    else if (r.kind === 'go') main = `Go to <b>${esc(r.text)}</b>`;
    else main = `${esc(r.title)}<span class="u">${esc(r.url.replace(/^https?:\/\/(www\.)?/, ''))}</span>`;
    return `<div class="pal-row pal-${r.kind}${i === palSel ? ' sel' : ''}" role="option" aria-selected="${i === palSel}" data-i="${i}">
      <span class="kind pixel">${label}</span><span class="main">${main}</span><span class="pixel pal-key">${right}</span></div>`;
  }).join('');
  palList.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
}

async function palUpdate() {
  const q = palInput.value.trim();
  const mine = ++palQuery;
  palRows = palBuild(q);
  palSel = 0;
  palRender();
  if (!q) return;
  const library = (await B.library.suggest(q)) || [];
  if (mine !== palQuery) return; // you kept typing
  palRows = palBuild(q, library);
  palRender();
}

function palRun(i = palSel) {
  const r = palRows[i];
  const q = palInput.value.trim();
  hideOverlay();
  if (!r) { if (q) (palHere() ? B.tabs.navigate(q) : B.searchNewTab(q)); return; }
  if (r.kind === 'action') r.run();
  else if (r.kind === 'tab') B.tabs.activate(r.id);
  else if (r.kind === 'ask') B.ask(r.text, !palHere());
  else if (r.kind === 'search' || r.kind === 'go') (palHere() ? B.tabs.navigate(r.text) : B.searchNewTab(r.text));
  else B.library.open(r.url, !palHere());
}

async function openPalette() {
  if (!palEl.hidden) { palInput.select(); return; }
  palTabs = (await B.allTabs()) || [];
  palInput.value = '';
  showOverlay('palette');
  palInput.focus();
  palUpdate();
}
window.openPalette = openPalette;

palInput.addEventListener('input', palUpdate);
palInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!palRows.length) return;
    palSel = (palSel + (e.key === 'ArrowDown' ? 1 : -1) + palRows.length) % palRows.length;
    palRender();
  } else if (e.key === 'Enter') { e.preventDefault(); palRun(); }
  else if (e.key === 'Escape') { e.preventDefault(); hideOverlay(); }
});
palList.addEventListener('mousemove', (e) => {
  const row = e.target.closest('[data-i]');
  if (row && Number(row.dataset.i) !== palSel) { palSel = Number(row.dataset.i); palRender(); }
});
palList.addEventListener('mousedown', (e) => {
  const row = e.target.closest('[data-i]');
  if (!row) return;
  e.preventDefault();
  palRun(Number(row.dataset.i));
});

B.onPaletteOpen(openPalette);

(window.__loaded = window.__loaded || []).push('palette');
