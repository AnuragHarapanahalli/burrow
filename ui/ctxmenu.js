// Right-click menus, Burrow-styled: one menu component used for web pages (items come from the
// main process), tabs, the tab strip, the bookmarks bar, and Burrow's own text boxes.
// Names start with "cm" so they can't clash with the other interface scripts.
const cmBox = $('ctxMenu');
FLOATERS.ctx = cmBox;
let cmPick = null;     // what to do with a chosen item id
let cmOnClose = null;  // told when the menu closes without a choice
let cmPicked = false;

const cmItemHtml = (it, i) => {
  if (it.sep) return '<div class="cm-sep" role="separator"></div>';
  const sub = it.sub && it.sub.length;
  return `<div class="cm-cell${sub ? ' has-sub' : ''}">
    <button class="cm-item${it.strong ? ' strong' : ''}" role="menuitem" data-i="${i}" ${it.disabled ? 'disabled aria-disabled="true"' : ''} ${sub ? 'aria-haspopup="menu"' : ''}>
      <span class="cm-label">${esc(it.label)}</span>${it.key ? `<span class="pixel cm-key">${esc(it.key)}</span>` : ''}${sub ? '<span class="cm-arrow" aria-hidden="true">&#9656;</span>' : ''}
    </button>${sub ? `<div class="cm-sub menu" role="menu" hidden>${it.sub.map((s, j) => cmItemHtml(s, `${i}.${j}`)).join('')}</div>` : ''}
  </div>`;
};
// Find an item by its "2" or "2.1" path.
const cmItemAt = (items, path) => String(path).split('.').reduce((list, k, n, all) => (n === all.length - 1 ? list[Number(k)] : list[Number(k)]?.sub), items);

let cmItems = [];
function cmOpen(items, x, y, onPick, onClose) {
  cmItems = items;
  cmPick = onPick;
  cmOnClose = onClose || null;
  cmPicked = false;
  cmBox.innerHTML = items.map(cmItemHtml).join('');
  showOverlay('ctx');
  // At the pointer; flipped left / up when it would run off the window.
  cmBox.style.left = '0px';
  cmBox.style.top = '0px';
  const w = cmBox.offsetWidth, h = cmBox.offsetHeight;
  const left = x + w > window.innerWidth - 6 ? Math.max(6, x - w) : x;
  const top = y + h > window.innerHeight - 6 ? Math.max(6, y - h) : y;
  cmBox.style.left = left + 'px';
  cmBox.style.top = top + 'px';
  cmBox.classList.toggle('subs-left', left + w * 2 > window.innerWidth);
  cmBox.focus();
}
window.cmOpen = cmOpen;

// Closing: tell whoever opened it (a page menu gives focus back to the page).
const cmHideOverlay = hideOverlay;
hideOverlay = function () {
  const wasOpen = openFloater === 'ctx';
  cmHideOverlay();
  if (wasOpen && !cmPicked) cmOnClose?.();
  if (wasOpen) cmOnClose = null;
};
window.hideOverlay = hideOverlay;

function cmChoose(btn) {
  if (!btn || btn.disabled) return;
  const it = cmItemAt(cmItems, btn.dataset.i);
  if (!it || it.sub) { cmOpenSub(btn); return; }
  cmPicked = true;
  const pick = cmPick;
  hideOverlay();
  pick?.(it.id, it);
}
function cmOpenSub(btn) {
  const cell = btn.closest('.cm-cell');
  cmBox.querySelectorAll('.cm-sub').forEach((s) => { if (!s.contains(btn) && !cell.contains(s)) s.hidden = true; });
  const sub = cell.querySelector(':scope > .cm-sub');
  if (!sub) return null;
  sub.hidden = false;
  return sub;
}
cmBox.addEventListener('click', (e) => cmChoose(e.target.closest('.cm-item')));
cmBox.addEventListener('mouseover', (e) => {
  const btn = e.target.closest('.cm-item');
  if (!btn) return;
  const cell = btn.closest('.cm-cell');
  // Hovering an item opens its submenu and closes the others at that level.
  [...cell.parentElement.children].forEach((c) => { if (c !== cell) c.querySelector(':scope > .cm-sub')?.setAttribute('hidden', ''); });
  if (cell.classList.contains('has-sub')) cmOpenSub(btn);
  btn.focus({ preventScroll: true });
});
cmBox.addEventListener('mousedown', (e) => e.preventDefault()); // keep text selections where they are
cmBox.addEventListener('keydown', (e) => {
  const cur = document.activeElement?.closest?.('.cm-item');
  const level = cur ? cur.closest('.cm-cell').parentElement : cmBox;
  const btns = [...level.children].map((c) => c.querySelector?.(':scope > .cm-item')).filter((b) => b && !b.disabled);
  const i = btns.indexOf(cur);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = btns.length;
    if (n) btns[(i + (e.key === 'ArrowDown' ? 1 : -1) + n + (i < 0 && e.key === 'ArrowUp' ? 1 : 0)) % n].focus();
  } else if (e.key === 'ArrowRight' && cur?.closest('.cm-cell').classList.contains('has-sub')) {
    e.preventDefault();
    cmOpenSub(cur)?.querySelector('.cm-item:not([disabled])')?.focus();
  } else if (e.key === 'ArrowLeft' && level !== cmBox) {
    e.preventDefault();
    level.hidden = true;
    level.closest('.cm-cell').querySelector(':scope > .cm-item').focus();
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    cmChoose(cur);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    hideOverlay();
  }
});

// =============== Web pages: the main process sends the items ===============
B.ctx.onMenu(({ token, x, y, items }) => {
  UI.lastPageMenu = { token, items }; // (the self-test reads this)
  cmOpen(items, x, y, (id) => B.ctx.run(token, id), () => B.ctx.closed(token));
});

// =============== Tabs ===============
async function cmTabMenu(id, x, y) {
  const t = UI.state.tabs.find((x2) => x2.id === id);
  if (!t) return;
  const vis = UI.state.tabs;
  const i = vis.findIndex((x2) => x2.id === id);
  const active = id === UI.state.activeId;
  const priv = !!UI.state.isPrivate;
  const others = priv ? [] : await B.otherWindows();
  const spaces = (UI.state.workspaces || []).filter((w) => w.id !== UI.state.currentWs);
  const items = [
    { id: 'new-right', label: 'New tab to the right' },
    { id: 'reload', label: 'Reload', key: active ? 'CTRL R' : '' },
    { id: 'duplicate', label: 'Duplicate' },
    { sep: true },
    { id: 'mute', label: t.muted ? 'Unmute tab' : 'Mute tab' },
    { id: 'volume', label: 'Volume…' },
    { id: 'awake', label: t.keepAwake ? 'Let this tab sleep' : 'Keep this tab awake' },
    ...(!active && !t.asleep ? [{ id: 'sleep', label: 'Put to sleep now' }] : []),
    { sep: true },
    active
      ? { id: 'split', label: UI.state.split ? 'Close split view' : 'Split with…', key: 'CTRL \\' }
      : { id: 'split-with', label: 'Show beside the current tab' },
    ...(priv ? [] : [{ id: 'ws', label: 'Move to workspace', sub: [
      ...spaces.map((w) => ({ id: `ws:${w.id}`, label: w.name })),
      ...(spaces.length ? [{ sep: true }] : []),
      { id: 'ws:new', label: 'New workspace' },
    ] }]),
    ...(priv ? [] : [{ id: 'win', label: 'Move to window', sub: [
      ...others.map((w) => ({ id: `win:${w.id}`, label: w.name })),
      ...(others.length ? [{ sep: true }] : []),
      { id: 'win:new', label: 'New window' },
    ] }]),
    { sep: true },
    { id: 'close', label: 'Close tab', key: active ? 'CTRL W' : '' },
    { id: 'close-others', label: 'Close other tabs', disabled: vis.length < 2 },
    { id: 'close-right', label: 'Close tabs to the right', disabled: i === vis.length - 1 },
    { sep: true },
    { id: 'reopen', label: 'Reopen closed tab', key: 'CTRL SHIFT T' },
  ];
  cmOpen(items, x, y, (cmd) => {
    const [k, v] = cmd.split(':');
    if (k === 'new-right') B.tabs.newAfter(id);
    else if (k === 'reload') B.tabs.reload(id);
    else if (k === 'duplicate') B.tabs.duplicate(id);
    else if (k === 'mute') B.tabs.mute(id);
    else if (k === 'volume') {
      const el = document.querySelector(`#tabs [data-id="${id}"], #sideTabs [data-id="${id}"]`);
      if (el) setTimeout(() => window.openVolume?.(id, el.querySelector('[data-mute]:not([hidden])') || el), 0);
    } else if (k === 'awake') B.tabs.keepAwake(id);
    else if (k === 'sleep') B.tabs.sleep(id);
    else if (k === 'split') setTimeout(() => window.openSplitPicker?.(), 0);
    else if (k === 'split-with') B.split.with(id);
    else if (k === 'ws') B.tabs.moveToWorkspace(id, v === 'new' ? 'new' : Number(v));
    else if (k === 'win') B.tabs.moveToWindow(id, v === 'new' ? 'new' : Number(v));
    else if (k === 'close') B.tabs.close(id);
    else if (k === 'close-others') B.tabs.closeOthers(id);
    else if (k === 'close-right') B.tabs.closeRight(id);
    else if (k === 'reopen') B.tabs.reopen();
  });
}
window.cmTabMenu = cmTabMenu;

// =============== Bookmarks bar ===============
function cmBookmarkMenu(b, x, y) {
  cmOpen([
    { id: 'open', label: 'Open' },
    { id: 'open-tab', label: 'Open in new tab' },
    { sep: true },
    { id: 'edit', label: 'Edit…' },
    { id: 'delete', label: 'Delete' },
  ], x, y, (cmd) => {
    if (cmd === 'open') B.library.open(b.url, false);
    else if (cmd === 'open-tab') B.library.open(b.url, true);
    else if (cmd === 'edit') setTimeout(() => cmEditBookmark(b, x, y), 0);
    else if (cmd === 'delete') B.library.removeBookmark(b.id);
  });
}
// A small form to rename a bookmark or change its address.
const cmEdit = $('bmEdit');
FLOATERS.bmEdit = cmEdit;
let cmEditing = null;
function cmEditBookmark(b, x, y) {
  cmEditing = b;
  $('bmEditName').value = b.title || '';
  $('bmEditUrl').value = b.url;
  $('bmEditErr').hidden = true;
  showOverlay('bmEdit');
  cmEdit.style.left = Math.max(8, Math.min(window.innerWidth - cmEdit.offsetWidth - 8, x)) + 'px';
  cmEdit.style.top = Math.max(8, y) + 'px';
  $('bmEditName').focus();
  $('bmEditName').select();
}
window.cmEditBookmark = cmEditBookmark;
$('bmEditForm').addEventListener('submit', (e) => {
  e.preventDefault();
  let url = $('bmEditUrl').value.trim();
  if (url && !/^[a-z]+:/i.test(url)) url = 'https://' + url;
  if (!/^https?:\/\/[^\s]+\.[^\s]+/i.test(url) && !/^https?:\/\/(localhost|127\.0\.0\.1)/i.test(url)) {
    $('bmEditErr').hidden = false;
    return;
  }
  B.library.editBookmark(cmEditing.id, $('bmEditName').value.trim(), url);
  hideOverlay();
});
$('bmEditCancel').onclick = () => hideOverlay();

// =============== Burrow's own text boxes (address bar, search fields, settings) ===============
function cmEditMenu(el, x, y) {
  const ro = el.readOnly || el.disabled;
  const hasSel = el.selectionStart !== el.selectionEnd;
  const isAddress = el.id === 'address';
  const sel = [el.selectionStart, el.selectionEnd];
  const items = [
    { id: 'undo', label: 'Undo', key: 'CTRL Z', disabled: ro },
    { id: 'redo', label: 'Redo', key: 'CTRL Y', disabled: ro },
    { sep: true },
    { id: 'cut', label: 'Cut', key: 'CTRL X', disabled: ro || !hasSel },
    { id: 'copy', label: 'Copy', key: 'CTRL C', disabled: !hasSel },
    { id: 'paste', label: 'Paste', key: 'CTRL V', disabled: ro },
    ...(isAddress ? [{ id: 'paste-go', label: 'Paste and go' }] : []),
    { id: 'delete', label: 'Delete', disabled: ro || !hasSel },
    { sep: true },
    { id: 'select-all', label: 'Select all', key: 'CTRL A', disabled: !el.value },
  ];
  cmOpen(items, x, y, async (cmd) => {
    el.focus();
    try { el.setSelectionRange(sel[0], sel[1]); } catch { /* not a text field */ }
    if (cmd === 'paste' || cmd === 'paste-go') {
      const text = await B.readClipboard();
      if (cmd === 'paste-go') {
        const t = String(text || '').trim();
        if (t) { el.value = t; B.tabs.navigate(t); el.blur(); }
        return;
      }
      if (text) document.execCommand('insertText', false, text);
    } else if (cmd === 'select-all') el.select();
    else document.execCommand({ undo: 'undo', redo: 'redo', cut: 'cut', copy: 'copy', delete: 'delete' }[cmd]);
  });
}
window.cmEditMenu = cmEditMenu;

// One handler for every right-click in Burrow's interface.
document.addEventListener('contextmenu', (e) => {
  e.preventDefault(); // never Chromium's own menu
  const x = e.clientX, y = e.clientY;
  const field = e.target.closest('input:not([type=checkbox]):not([type=radio]):not([type=range]), textarea');
  if (field) { cmEditMenu(field, x, y); return; }
  const tab = e.target.closest('#tabs [data-id], #sideTabs [data-id]');
  if (tab && !tab.classList.contains('closing')) { cmTabMenu(Number(tab.dataset.id), x, y); return; }
  const mark = e.target.closest('#bmItems [data-i]');
  if (mark) { const b = barMarks[Number(mark.dataset.i)]; if (b) cmBookmarkMenu(b, x, y); return; }
  if (e.target.closest('#tabs, #sideTabs, .strip, #newTab')) {
    cmOpen([
      { id: 'new', label: 'New tab', key: 'CTRL T' },
      { id: 'reopen', label: 'Reopen closed tab', key: 'CTRL SHIFT T' },
    ], x, y, (cmd) => (cmd === 'new' ? B.tabs.create() : B.tabs.reopen()));
  }
});

// =============== Dropping a tab dragged from another window ===============
// Which visible slot is under (x, y)? Used by the main process when a tab is dropped here.
window.dropIndexAt = (x, y) => {
  const side = !$('sidebar').hidden;
  const els = [...document.querySelectorAll(side ? '#sideTabs [data-id]' : '#tabs [data-id]')].filter((el) => !el.classList.contains('closing'));
  let i = 0;
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (side ? y > r.top + r.height / 2 : x > r.left + r.width / 2) i++;
  }
  return i;
};
const cmMarker = $('dropMarker');
B.onDropMarker((pos) => {
  if (!pos) { cmMarker.hidden = true; return; }
  const side = !$('sidebar').hidden;
  const els = [...document.querySelectorAll(side ? '#sideTabs [data-id]' : '#tabs [data-id]')].filter((el) => !el.classList.contains('closing'));
  const i = window.dropIndexAt(pos.x, pos.y);
  const ref = els[i] || els[els.length - 1];
  if (!ref) { cmMarker.hidden = true; return; }
  const r = ref.getBoundingClientRect();
  const after = !els[i];
  cmMarker.hidden = false;
  cmMarker.classList.toggle('side', side);
  if (side) {
    cmMarker.style.left = r.left + 'px';
    cmMarker.style.top = (after ? r.bottom : r.top) - 1 + 'px';
    cmMarker.style.width = r.width + 'px';
    cmMarker.style.height = '';
  } else {
    cmMarker.style.left = (after ? r.right : r.left) - 1 + 'px';
    cmMarker.style.top = r.top + 'px';
    cmMarker.style.height = r.height + 'px';
    cmMarker.style.width = '';
  }
});

(window.__loaded = window.__loaded || []).push('ctxmenu');
