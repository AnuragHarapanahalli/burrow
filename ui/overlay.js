// Things that float above websites: menus and address-bar suggestions.
// While one is open, the UI view is raised above the page (B.setOverlay(true)).
const overlay = $('overlay');
const wsMenu = $('wsMenu');
const suggestBox = $('suggest');
const mainMenu = $('mainMenu');
const bmMenu = $('bmMenu');
const FLOATERS = { ws: wsMenu, main: mainMenu, bm: bmMenu, suggest: suggestBox };
let openFloater = null;

function showOverlay(which) {
  overlay.hidden = false;
  for (const [k, el] of Object.entries(FLOATERS)) el.hidden = k !== which;
  if (openFloater !== which) bump(FLOATERS[which], 'pop-in');
  openFloater = which;
  B.setOverlay(true);
}
function hideOverlay() {
  if (overlay.hidden) return;
  overlay.hidden = true;
  openFloater = null;
  Object.values(FLOATERS).forEach((el) => { el.hidden = true; });
  ['wsBtn', 'menuBtn', 'bmMore'].forEach((id) => $(id).setAttribute('aria-expanded', 'false'));
  address.setAttribute('aria-expanded', 'false');
  B.setOverlay(false);
}
window.hideOverlay = hideOverlay;
$('backdrop').addEventListener('mousedown', (e) => { e.preventDefault(); hideOverlay(); if (UI.editing) address.blur(); });

// =============== Workspace menu ===============
let wsEditing = null;     // id being renamed, or 'new'
let wsConfirmDelete = null;

function renderWorkspaceMenu() {
  if (wsMenu.hidden) return;
  const { workspaces, currentWs } = UI.state;
  const rows = workspaces.map((w, i) => {
    const cur = w.id === currentWs;
    const name = wsEditing === w.id
      ? `<input data-rename="${w.id}" value="${esc(w.name)}" maxlength="24" aria-label="Workspace name">`
      : `<span class="name">${esc(w.name)}</span>`;
    const del = workspaces.length > 1
      ? `<button class="act${wsConfirmDelete === w.id ? ' confirm' : ''}" data-del="${w.id}" title="Delete workspace and its tabs">${wsConfirmDelete === w.id ? 'Delete?' : '&times;'}</button>`
      : '<span></span>';
    return `<div class="ws-row${cur ? ' current' : ''}" role="menuitem" data-ws="${w.id}">
      <span class="num pixel">${pad(i + 1)}</span>${name}
      <span class="count">${w.count} tab${w.count === 1 ? '' : 's'}</span>
      <button class="act" data-edit="${w.id}" title="Rename">&#9998;</button>${del}</div>`;
  }).join('');
  const add = wsEditing === 'new'
    ? `<div class="ws-new"><span class="pixel">+</span><input data-newws placeholder="Name it, e.g. College" maxlength="24" aria-label="New workspace name"></div>`
    : `<button class="ws-new" data-add><span class="pixel">+</span> New workspace</button>`;
  wsMenu.innerHTML = `<div class="menu-label pixel"><span>WORKSPACES</span><span>CTRL SHIFT 1-9</span></div>${rows}${add}`;
  const input = wsMenu.querySelector('input');
  if (input) { input.focus(); input.select(); }
}
window.renderWorkspaceMenu = renderWorkspaceMenu;

function openWorkspaceMenu() {
  const r = $('wsBtn').getBoundingClientRect();
  wsMenu.style.left = r.left + 'px';
  wsMenu.style.top = r.bottom + 'px';
  wsEditing = null; wsConfirmDelete = null;
  showOverlay('ws');
  $('wsBtn').setAttribute('aria-expanded', 'true');
  renderWorkspaceMenu();
}
$('wsBtn').addEventListener('click', () => {
  if (UI.state.isPrivate) return; // private windows have no workspaces
  wsMenu.hidden ? openWorkspaceMenu() : hideOverlay();
});
// Keep the zoom number in the open menu up to date.
B.tabs.onChange(() => { const z = $('mmZoom'); if (z) z.textContent = `${activeTab()?.zoom || 100}%`; });

// =============== Main menu (☰): a compact control centre ===============
// Search, new tab/window, zoom, page tools, library, and small links — nothing hidden, 5 rows.
const CC_ICON = {
  "find": "<path d=\"M7 2.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zM10.5 10.5 14 14\"/>",
  "split": "<path d=\"M2 3h12v10H2zM8 3v10\"/>",
  "reader": "<path d=\"M2 3.5h4.5c.8 0 1.5.7 1.5 1.5v8c0-.8-.7-1.5-1.5-1.5H2zM14 3.5H9.5C8.7 3.5 8 4.2 8 5v8c0-.8.7-1.5 1.5-1.5H14z\"/>",
  "pip": "<path d=\"M2 3h12v10H2z\"/><path class=\"fill\" d=\"M8 8h5v4H8z\"/>",
  "notes": "<path d=\"M3 13l1-3.5L11 2.5l2.5 2.5L6.5 12zM9.5 4l2.5 2.5\"/>",
  "ai": "<path d=\"M8 1.5l1.6 4.9L14.5 8l-4.9 1.6L8 14.5l-1.6-4.9L1.5 8l4.9-1.6z\"/>",
  "focus": "<path d=\"M8 3.5a5 5 0 1 1 0 10 5 5 0 0 1 0-10zM8 6v3l2 1.5M6 1.5h4\"/>",
  "bmbar": "<path d=\"M2 4h12M4 4v9l4-3 4 3V4\"/>",
  "bookmarks": "<path d=\"M8 2l1.8 3.8 4.2.5-3.1 2.9.8 4.1L8 11.3 4.3 13.3l.8-4.1L2 6.3l4.2-.5z\"/>",
  "history": "<path d=\"M8 2.5a5.5 5.5 0 1 1-5.2 3.8M2.5 2.5v3.5H6M8 5v3.5l2.5 1.5\"/>",
  "downloads": "<path d=\"M8 2v7M5 6.5 8 9.5l3-3M2.5 10.5v3h11v-3\"/>",
  "newtab": "<path d=\"M8 3v10M3 8h10\"/>",
  "window": "<path d=\"M2 3h12v10H2zM2 6h12\"/>",
  "private": "<path d=\"M2 7c1.5-2 3.5-3 6-3s4.5 1 6 3M3.5 9.5a2 2 0 1 0 4 0 2 2 0 0 0-4 0zM8.5 9.5a2 2 0 1 0 4 0 2 2 0 0 0-4 0z\"/>"
};
const ccIcon = (name) => `<svg viewBox="0 0 16 16" aria-hidden="true">${CC_ICON[name]}</svg>`;
function ccTool(cmd, label, on, title) {
  return `<button class="cc-tool${on ? ' on' : ''}" data-cmd="${cmd}" title="${title || label}" aria-pressed="${!!on}">${ccIcon(cmd)}<span>${label}</span></button>`;
}
function openMainMenu() {
  const t = activeTab();
  const priv = !!UI.state.isPrivate;
  const sess = UI.focus?.session;
  const tools = [
    ccTool('find', 'Find', false, 'Find in page (Ctrl+F)'),
    ccTool('split', 'Split', !!UI.state.split, 'Split view (Ctrl+\\)'),
    ccTool('reader', 'Reader', !!t?.inReader, 'Reader view (F9)'),
    ccTool('pip', 'PiP', false, 'Picture in picture'),
    priv ? '' : ccTool('notes', 'Notes', false, 'Notes for this site (Ctrl+Shift+E)'),
    priv ? '' : ccTool('ai', 'AI', !!window.aiState?.open, 'AI panel (Ctrl+Shift+A)'),
    ccTool('focus', sess ? 'End focus' : 'Focus', !!sess, sess ? 'End the focus session' : 'Start a 25-minute focus session'),
    ccTool('bmbar', 'Bar', !!UI.theme?.prefs.bookmarksBar, 'Bookmarks bar (Ctrl+Shift+B)'),
  ].join('');
  mainMenu.innerHTML = `
    <button class="cc-search" data-cmd="palette">${ccIcon('find')}<span>Search actions, tabs, history&hellip;</span><span class="pixel">CTRL K</span></button>
    <div class="cc-row cc-new">
      <button data-cmd="newtab" title="New tab (Ctrl+T)">${ccIcon('newtab')}<span>Tab</span></button>
      <button data-cmd="window" title="New window (Ctrl+N)">${ccIcon('window')}<span>Window</span></button>
      <button data-cmd="private" title="New private window (Ctrl+Shift+N)">${ccIcon('private')}<span>Private</span></button>
    </div>
    <div class="cc-zoom" role="group" aria-label="Zoom">
      <span>Zoom</span>
      <button class="mm-zbtn" data-cmd="zoomout" aria-label="Zoom out">&minus;</button>
      <button class="mm-zval pixel" data-cmd="zoomreset" id="mmZoom" title="Reset (Ctrl+0)">${t?.zoom || 100}%</button>
      <button class="mm-zbtn" data-cmd="zoomin" aria-label="Zoom in">+</button>
    </div>
    <div class="cc-grid">${tools}</div>
    <div class="cc-row cc-lib">
      <button data-cmd="bookmarks" title="Bookmarks (Ctrl+Shift+O)">${ccIcon('bookmarks')}<span>Bookmarks</span></button>
      <button data-cmd="history" title="History (Ctrl+H)">${ccIcon('history')}<span>History</span></button>
      <button data-cmd="downloads" title="Downloads (Ctrl+J)">${ccIcon('downloads')}<span>Downloads</span></button>
    </div>
    <div class="cc-foot">
      <button data-cmd="settings">Settings</button><span>&middot;</span>
      <button data-cmd="welcome">Tour</button><span>&middot;</span>
      <button data-cmd="bug">Report a bug</button>
    </div>`;
  const r = $('menuBtn').getBoundingClientRect();
  mainMenu.style.right = (window.innerWidth - r.right) + 'px';
  mainMenu.style.top = (r.bottom + 4) + 'px';
  showOverlay('main');
  $('menuBtn').setAttribute('aria-expanded', 'true');
}
$('menuBtn').addEventListener('click', () => (mainMenu.hidden ? openMainMenu() : hideOverlay()));
mainMenu.addEventListener('click', (e) => {
  const row = e.target.closest('[data-cmd]');
  if (!row) return;
  const cmd = row.dataset.cmd;
  if (cmd === 'newws') { openWorkspaceMenu(); wsEditing = 'new'; renderWorkspaceMenu(); return; }
  // Zoom buttons keep the menu open so you can click several times.
  if (cmd.startsWith('zoom')) { B.zoom(cmd === 'zoomin' ? 1 : cmd === 'zoomout' ? -1 : 0); return; }
  hideOverlay();
  if (cmd === 'newtab') B.tabs.create();
  else if (cmd === 'palette') window.openPalette();
  else if (cmd === 'private') B.openPrivate();
  else if (cmd === 'window') B.openWindow();
  else if (cmd === 'bug') B.tabs.navigate('burrow://newtab/#report-bug');
  else if (cmd === 'welcome') B.tabs.navigate('burrow://welcome/');
  else if (cmd === 'find') window.openFind();
  else if (cmd === 'pip') window.popOut();
  else if (cmd === 'split') window.openSplitPicker();
  else if (cmd === 'reader') window.toggleReader();
  else if (cmd === 'ai') B.ai.panel();
  else if (cmd === 'reopen') B.tabs.reopen();
  else if (cmd === 'bmbar') B.setPrefs({ bookmarksBar: !UI.theme?.prefs.bookmarksBar });
  else if (cmd === 'focus') B.focus.session(UI.focus?.session ? 'end' : 'start');
  else window.openPanel(cmd);
});

wsMenu.addEventListener('click', (e) => {
  const t = e.target;
  if (t.closest('input')) return;
  const edit = t.closest('[data-edit]');
  const del = t.closest('[data-del]');
  if (edit) { wsEditing = Number(edit.dataset.edit); wsConfirmDelete = null; return renderWorkspaceMenu(); }
  if (del) {
    const id = Number(del.dataset.del);
    if (wsConfirmDelete === id) { B.workspaces.remove(id); wsConfirmDelete = null; }
    else { wsConfirmDelete = id; renderWorkspaceMenu(); }
    return;
  }
  if (t.closest('[data-add]')) { wsEditing = 'new'; return renderWorkspaceMenu(); }
  const row = t.closest('[data-ws]');
  if (row && wsEditing === null) { B.workspaces.switchTo(Number(row.dataset.ws)); hideOverlay(); }
});

wsMenu.addEventListener('keydown', (e) => {
  const input = e.target.closest('input');
  if (!input) return;
  if (e.key === 'Escape') { wsEditing = null; renderWorkspaceMenu(); return; }
  if (e.key !== 'Enter') return;
  const name = input.value.trim();
  if (input.dataset.rename && name) B.workspaces.rename(Number(input.dataset.rename), name);
  if (input.hasAttribute('data-newws') && name) { B.workspaces.create(name); hideOverlay(); }
  wsEditing = null;
  renderWorkspaceMenu();
});

// =============== Address bar + suggestions ===============
let suggestions = [];   // [{ kind, url, title }]; the first rows are always "what you typed"
let sel = 0;
let suggestTimer;
const looksLikeUrl = (s) => /^(https?:\/\/|localhost|burrow:\/\/)/i.test(s) || (!/\s/.test(s) && /^[^\s/]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(s));
const aiName = () => {
  const p = UI.theme?.prefs;
  return p?.aiProviders.find((x) => x.id === p.aiProvider)?.name || 'AI';
};

// Should "Ask AI" come before "Search"? (Settings → AI assistant)
function askFirst(q) {
  const mode = UI.theme?.prefs.askMode || 'smart';
  return mode === 'ai' || (mode === 'smart' && window.BurrowAI.isQuestion(q));
}

// The rows for what you typed: Go (an address) or Search + Ask AI, in the right order.
function typedRows(q) {
  if (looksLikeUrl(q)) return [{ kind: 'go', text: q }];
  const search = { kind: 'search', text: q };
  const ask = { kind: 'ask', text: q };
  return askFirst(q) ? [ask, search] : [search, ask];
}

function renderSuggest() {
  if (!suggestions.length) { if (!suggestBox.hidden) hideOverlay(); return; }
  const r = $('addressForm').getBoundingClientRect();
  suggestBox.style.left = r.left + 'px';
  suggestBox.style.top = (r.bottom + 4) + 'px';
  suggestBox.style.width = r.width + 'px';
  suggestBox.innerHTML = suggestions.map((s, i) => {
    const kind = { go: 'GO', search: 'FIND', ask: 'ASK', bookmark: '&#9733; SAVED', history: 'PAST' }[s.kind];
    let main;
    if (s.kind === 'go') main = `Go to <b>${esc(s.text)}</b>`;
    else if (s.kind === 'search') main = `Search ${esc(engineName())} for <b>${esc(s.text)}</b>`;
    else if (s.kind === 'ask') main = `Ask ${esc(aiName())}: <b>${esc(s.text)}</b>`;
    else main = `${esc(s.title)}<span class="u">${esc(s.url.replace(/^https?:\/\/(www\.)?/, ''))}</span>`;
    return `<div class="sg sg-${s.kind}${i === sel ? ' sel' : ''}" role="option" aria-selected="${i === sel}" data-i="${i}">
      <span class="kind pixel">${kind}</span><span class="main">${main}</span></div>`;
  }).join('');
  if (suggestBox.hidden) showOverlay('suggest');
  address.setAttribute('aria-expanded', 'true');
}

address.addEventListener('input', () => {
  const q = address.value.trim();
  clearTimeout(suggestTimer);
  if (!q) { suggestions = []; renderSuggest(); return; }
  // Show the typed rows straight away; add bookmarks/history a moment later.
  suggestions = typedRows(q);
  sel = 0;
  renderSuggest();
  suggestTimer = setTimeout(async () => {
    const found = (await B.library.suggest(q)) || [];
    if (address.value.trim() !== q) return; // you kept typing
    suggestions = [...typedRows(q), ...found];
    renderSuggest();
  }, 70);
});

function go(i = sel) {
  const q = address.value.trim();
  const s = suggestions[i] || typedRows(q)[0];
  suggestions = [];
  hideOverlay();
  UI.editing = false;
  address.blur();
  if (!q && !s?.url) return;
  if (s?.kind === 'ask') B.ask(s.text, false);
  else B.tabs.navigate(s?.url || s?.text || q);
}

address.addEventListener('focus', () => { UI.editing = true; address.select(); });
address.addEventListener('blur', () => {
  UI.editing = false;
  suggestions = [];
  if (!suggestBox.hidden) hideOverlay();
  renderToolbar();
});
address.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { suggestions = []; hideOverlay(); UI.editing = false; renderToolbar(); address.blur(); return; }
  if (!suggestions.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length;
    renderSuggest();
  }
});
$('addressForm').addEventListener('submit', (e) => { e.preventDefault(); go(); });
suggestBox.addEventListener('mousedown', (e) => {
  const row = e.target.closest('[data-i]');
  if (!row) return;
  e.preventDefault(); // keep focus in the address bar until we navigate
  go(Number(row.dataset.i));
});
B.onFocusAddress(() => { address.focus(); address.select(); });

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openFloater && openFloater !== 'suggest') hideOverlay();
});

(window.__loaded = window.__loaded || []).push('overlay');
