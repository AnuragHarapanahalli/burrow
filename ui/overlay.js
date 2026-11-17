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

// =============== Main menu (☰) ===============
const MENU = [
  { cmd: 'newtab', label: 'New tab', key: 'CTRL T' },
  { cmd: 'window', label: 'New window', key: 'CTRL N' },
  { cmd: 'private', label: 'New private window', key: 'CTRL SHIFT N' },
  { cmd: 'newws', label: 'New workspace', hideInPrivate: true },
  { cmd: 'reopen', label: 'Reopen closed tab', key: 'CTRL SHIFT T' },
  null,
  'zoom',
  { cmd: 'find', label: 'Find in page', key: 'CTRL F' },
  { cmd: 'pip', label: 'Picture in picture' },
  null,
  { cmd: 'bookmarks', label: 'Bookmarks', key: 'CTRL SHIFT O' },
  { cmd: 'history', label: 'History', key: 'CTRL H' },
  { cmd: 'downloads', label: 'Downloads', key: 'CTRL J' },
  { cmd: 'bmbar', label: 'Show bookmarks bar', key: 'CTRL SHIFT B', check: () => !!UI.theme?.prefs.bookmarksBar },
  null,
  { cmd: 'settings', label: 'Settings', key: 'THEME, SEARCH' },
  { cmd: 'bug', label: 'Report a bug' },
];
const zoomRow = () => `<div class="mm-zoom" role="group" aria-label="Zoom">
    <span class="mm-check"></span><span>Zoom</span>
    <button class="mm-zbtn" data-cmd="zoomout" aria-label="Zoom out">&minus;</button>
    <button class="mm-zval pixel" data-cmd="zoomreset" id="mmZoom" title="Reset (Ctrl+0)">${activeTab()?.zoom || 100}%</button>
    <button class="mm-zbtn" data-cmd="zoomin" aria-label="Zoom in">+</button></div>`;
function openMainMenu() {
  mainMenu.innerHTML = MENU.filter((m) => !(m && m.hideInPrivate && UI.state.isPrivate)).map((m) => {
    if (m === 'zoom') return zoomRow();
    if (!m) return '<div class="mm-sep" role="separator"></div>';
    return `<button class="mm-row" role="menuitem" data-cmd="${m.cmd}">
        <span class="mm-check">${m.check ? (m.check() ? '&#10003;' : '') : ''}</span>
        <span>${m.label}</span><span class="pixel mm-key">${m.key || ''}</span></button>`;
  }).join('');
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
  else if (cmd === 'private') B.openPrivate();
  else if (cmd === 'window') B.openWindow();
  else if (cmd === 'bug') B.tabs.navigate('burrow://newtab/#report-bug');
  else if (cmd === 'find') window.openFind();
  else if (cmd === 'pip') window.popOut();
  else if (cmd === 'reopen') B.tabs.reopen();
  else if (cmd === 'bmbar') B.setPrefs({ bookmarksBar: !UI.theme?.prefs.bookmarksBar });
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
let suggestions = [];   // [{ kind, url, title }]; index 0 is always "what you typed"
let sel = 0;
let suggestTimer;
const looksLikeUrl = (s) => /^(https?:\/\/|localhost|burrow:\/\/)/i.test(s) || (!/\s/.test(s) && /^[^\s/]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(s));

function renderSuggest() {
  if (!suggestions.length) { if (!suggestBox.hidden) hideOverlay(); return; }
  const r = $('addressForm').getBoundingClientRect();
  suggestBox.style.left = r.left + 'px';
  suggestBox.style.top = (r.bottom + 4) + 'px';
  suggestBox.style.width = r.width + 'px';
  suggestBox.innerHTML = suggestions.map((s, i) => {
    const kind = { typed: looksLikeUrl(s.url) ? 'GO' : 'FIND', bookmark: '&#9733; SAVED', history: 'PAST' }[s.kind];
    const main = s.kind === 'typed'
      ? (looksLikeUrl(s.url) ? `Go to <b>${esc(s.url)}</b>` : `Search ${esc(engineName())} for <b>${esc(s.url)}</b>`)
      : `${esc(s.title)}<span class="u">${esc(s.url.replace(/^https?:\/\/(www\.)?/, ''))}</span>`;
    return `<div class="sg${i === sel ? ' sel' : ''}" role="option" aria-selected="${i === sel}" data-i="${i}">
      <span class="kind pixel">${kind}</span><span class="main">${main}</span></div>`;
  }).join('');
  if (suggestBox.hidden) showOverlay('suggest');
  address.setAttribute('aria-expanded', 'true');
}

address.addEventListener('input', () => {
  const q = address.value.trim();
  clearTimeout(suggestTimer);
  if (!q) { suggestions = []; renderSuggest(); return; }
  suggestTimer = setTimeout(async () => {
    const found = (await B.library.suggest(q)) || [];
    if (address.value.trim() !== q) return; // you kept typing
    suggestions = [{ kind: 'typed', url: q }, ...found];
    sel = 0;
    renderSuggest();
  }, 70);
});

function go(i = sel) {
  const s = suggestions[i];
  const text = s && s.kind !== 'typed' ? s.url : address.value;
  suggestions = [];
  hideOverlay();
  if (!text.trim()) return;
  B.tabs.navigate(text);
  UI.editing = false;
  address.blur();
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
