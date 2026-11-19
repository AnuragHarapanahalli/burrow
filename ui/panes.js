// Phase 5 in the interface: split view divider, reader button, AI side panel, and notes.
// (Names start with sv / ai / nt so they can't clash with the other interface scripts.)

// =============== Shared geometry: where the web pages sit ===============
var aiState = { open: false, width: 420, provider: 'claude', name: 'Claude' }; // var: the ☰ menu reads window.aiState
function svGeom() {
  const top = chrome.offsetHeight;
  const left = sidebar.hidden ? 0 : sidebar.offsetWidth;
  const right = Math.max(panel.hidden ? 0 : panel.offsetWidth, aiState.open ? aiState.width : 0);
  return { top, left, width: Math.max(0, window.innerWidth - left - right) };
}
// Whenever the layout changes, redraw the divider and the AI panel too.
const svBaseLayout = sendLayout;
sendLayout = function () { svBaseLayout(); renderSplit(); renderAIPanel(); };
window.addEventListener('resize', () => { renderSplit(); renderAIPanel(); });

// =============== Split view ===============
const SV_GAP = 8, SV_TOP = 3; // must match Tabs.SPLIT_GAP / SPLIT_TOP in main/tabs.js
const svDivider = $('splitDivider');
const svBar = $('splitBar');

function renderSplit() {
  const sp = UI.state.split;
  const on = !!(sp && sp.shown);
  document.body.classList.toggle('split-on', on);
  $('splitBtn').setAttribute('aria-pressed', String(!!sp));
  $('splitBtn').title = sp ? 'Close split view (Ctrl+\\)' : 'Split view (Ctrl+\\)';
  svDivider.hidden = !on;
  svBar.hidden = !on;
  // Tabs that belong to the split pair get a bracket in the tab strip.
  document.querySelectorAll('#tabs [data-id], #sideTabs [data-id]').forEach((el) => {
    const id = Number(el.dataset.id);
    el.classList.toggle('paired', !!sp && (id === sp.a || id === sp.b));
    el.classList.toggle('paired-left', !!sp && id === sp.a);
  });
  if (!on) return;
  const g = svGeom();
  const lw = Math.round((g.width - SV_GAP) * sp.ratio);
  Object.assign(svDivider.style, { left: g.left + lw + 'px', top: g.top + 'px', width: SV_GAP + 'px' });
  // An accent bar over the side you're using.
  const leftActive = UI.state.activeId === sp.a;
  Object.assign(svBar.style, {
    top: g.top + 'px', height: SV_TOP + 'px',
    left: (leftActive ? g.left : g.left + lw + SV_GAP) + 'px',
    width: (leftActive ? lw : g.width - lw - SV_GAP) + 'px',
  });
}

// Choosing what goes on the right: a small list of this workspace's tabs, plus "New tab".
const svPick = $('splitPick');
FLOATERS.splitPick = svPick;
let svPickRows = [];
let svPickSel = 0;
function openSplitPicker() {
  if (UI.state.split) { B.split.off(); return; }
  svPickRows = [
    ...UI.state.tabs.filter((t) => t.id !== UI.state.activeId).map((t) => ({ id: t.id, title: t.title, url: t.url, favicon: t.favicon })),
    { id: 'new', title: 'New tab', url: '' },
  ];
  svPickSel = 0;
  renderSplitPicker();
  const r = $('splitBtn').getBoundingClientRect();
  svPick.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
  svPick.style.top = (r.bottom + 4) + 'px';
  showOverlay('splitPick');
  $('splitBtn').setAttribute('aria-expanded', 'true');
  svPick.focus();
}
window.openSplitPicker = openSplitPicker;
function renderSplitPicker() {
  const rows = svPickRows.map((t, i) => {
    const icon = t.id === 'new' ? '<span class="sp-plus">+</span>'
      : (/^(https?:|data:)/.test(t.favicon || '') ? `<img src="${esc(t.favicon)}" alt="">` : '<span class="sp-dot"></span>');
    const host = (t.url || '').replace(/^https?:\/\/(www\.)?/, '').split('/')[0];
    return `<div class="sp-row${i === svPickSel ? ' sel' : ''}${t.id === 'new' ? ' sp-new' : ''}" role="option" aria-selected="${i === svPickSel}" data-i="${i}">
      <span class="pixel sp-n">${t.id === 'new' ? '' : pad(i + 1)}</span><span class="sp-i">${icon}</span>
      <span class="sp-t">${esc(t.title)}</span><span class="sp-h">${esc(host)}</span></div>`;
  }).join('');
  svPick.innerHTML = `<div class="menu-label pixel"><span>SPLIT VIEW WITH&hellip;</span><span>&crarr; PICK</span></div>${rows}`;
}
function pickSplit(i = svPickSel) {
  const row = svPickRows[i];
  hideOverlay();
  if (row) B.split.with(row.id);
}
svPick.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    svPickSel = (svPickSel + (e.key === 'ArrowDown' ? 1 : -1) + svPickRows.length) % svPickRows.length;
    renderSplitPicker();
  } else if (e.key === 'Enter') { e.preventDefault(); pickSplit(); }
  else if (/^[1-9]$/.test(e.key) && Number(e.key) <= svPickRows.length) pickSplit(Number(e.key) - 1);
});
svPick.addEventListener('mousemove', (e) => {
  const row = e.target.closest('[data-i]');
  if (row && Number(row.dataset.i) !== svPickSel) { svPickSel = Number(row.dataset.i); renderSplitPicker(); }
});
svPick.addEventListener('mousedown', (e) => {
  const row = e.target.closest('[data-i]');
  if (row) { e.preventDefault(); pickSplit(Number(row.dataset.i)); }
});
B.split.onPick(openSplitPicker);
$('splitBtn').onclick = () => (svPick.hidden ? openSplitPicker() : hideOverlay());

// Drag the divider to resize; double-click to swap sides.
let svDrag = null;
let svFrame = 0;
svDivider.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  svDrag = { id: e.pointerId };
  svDivider.setPointerCapture(e.pointerId);
  document.body.classList.add('split-resizing');
});
svDivider.addEventListener('pointermove', (e) => {
  if (!svDrag || !UI.state.split) return;
  const g = svGeom();
  const r = Math.max(0.2, Math.min(0.8, (e.clientX - g.left - SV_GAP / 2) / Math.max(1, g.width - SV_GAP)));
  UI.state.split.ratio = r;
  renderSplit();
  cancelAnimationFrame(svFrame);
  svFrame = requestAnimationFrame(() => B.split.ratio(r));
});
const svEnd = () => { svDrag = null; document.body.classList.remove('split-resizing'); };
svDivider.addEventListener('pointerup', svEnd);
svDivider.addEventListener('pointercancel', svEnd);
svDivider.addEventListener('dblclick', () => B.split.swap());

// =============== Reader view button ===============
function renderReaderBtn() {
  const t = activeTab();
  const btn = $('readerBtn');
  const show = !!(t && (t.readerable || t.inReader));
  if (btn.hidden === show) { btn.hidden = !show; if (show) bump(btn, 'pop'); }
  btn.setAttribute('aria-pressed', String(!!t?.inReader));
  btn.title = t?.inReader ? 'Leave reader view (F9)' : 'Reader view (F9)';
}
async function svToggleReader() {
  const ok = await B.reader();
  if (!ok) { UI.stripClickOpens = null; stripMochi("Couldn't find an article on this page", 3500, 'oops'); }
}
window.toggleReader = svToggleReader;
$('readerBtn').onclick = svToggleReader;

// =============== AI side panel ===============
const aiPanelEl = $('aiPanel');
function renderAIPanel() {
  aiPanelEl.hidden = !aiState.open;
  $('aiBtn').setAttribute('aria-pressed', String(aiState.open));
  document.body.classList.toggle('ai-open', aiState.open);
  if (!aiState.open) return;
  aiPanelEl.style.top = chrome.offsetHeight + 'px';
  aiPanelEl.style.width = aiState.width + 'px';
  const list = UI.theme?.prefs.aiProviders || [];
  $('aiSeg').innerHTML = list.map((p) =>
    `<button role="radio" aria-checked="${p.id === aiState.provider}" data-ai="${p.id}">${esc(p.name)}</button>`).join('');
}
B.ai.onState((st) => {
  const opened = st.open && !aiState.open;
  aiState = st;
  if (st.open && !panel.hidden) { panel.hidden = true; svBaseLayout(); } // one right-side panel at a time
  if (opened) bump(aiPanelEl, 'slide-in');
  renderAIPanel();
  renderSplit();
});
$('aiBtn').onclick = () => B.ai.panel();
$('aiClose').onclick = () => B.ai.panel(false);
$('aiSeg').addEventListener('click', (e) => {
  const b = e.target.closest('[data-ai]');
  if (b) B.setPrefs({ aiProvider: b.dataset.ai });
});
$('aiPop').onclick = () => {
  const p = (UI.theme?.prefs.aiProviders || []).find((x) => x.id === aiState.provider);
  const home = { claude: 'https://claude.ai/new', chatgpt: 'https://chatgpt.com/', gemini: 'https://gemini.google.com/app' }[p?.id];
  if (home) B.library.open(home, true);
  B.ai.panel(false);
};
// Drag the panel's left edge to resize it.
let aiDrag = null;
let aiFrame = 0;
$('aiResize').addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  aiDrag = e.pointerId;
  $('aiResize').setPointerCapture(e.pointerId);
  document.body.classList.add('split-resizing');
});
$('aiResize').addEventListener('pointermove', (e) => {
  if (aiDrag === null) return;
  aiState.width = Math.max(320, Math.min(760, Math.round(window.innerWidth - e.clientX)));
  renderAIPanel();
  renderSplit();
  cancelAnimationFrame(aiFrame);
  aiFrame = requestAnimationFrame(() => B.ai.width(aiState.width));
});
const aiEnd = () => { aiDrag = null; document.body.classList.remove('split-resizing'); };
$('aiResize').addEventListener('pointerup', aiEnd);
$('aiResize').addEventListener('pointercancel', aiEnd);

// Opening Bookmarks/History/Notes/Settings closes the AI panel (one right-side panel at a time).
const ntBaseOpenPanel = openPanel;
openPanel = function (name) {
  if (aiState.open) B.ai.panel(false);
  ntBaseOpenPanel(name);
  if (name === 'notes') ntLoad();
};

// =============== Notes ===============
let ntHost = '';
let ntTimer = 0;
const ntText = $('noteText');

function ntSaveNow() {
  clearTimeout(ntTimer);
  if (ntHost && !ntText.hidden) B.notes.set(ntHost, ntText.value);
}
async function ntLoad(host) {
  ntSaveNow();
  const cur = await B.notes.get();
  const off = $('noteOff');
  if (cur.private || (!host && !cur.host)) {
    ntHost = '';
    ntText.hidden = true;
    off.hidden = false;
    off.textContent = cur.private ? 'Notes are off in private windows.' : 'Open a website to write a note for it.';
    $('noteHost').textContent = cur.private ? 'private window' : 'this tab';
  } else {
    ntHost = host || cur.host;
    ntText.hidden = false;
    off.hidden = true;
    ntText.value = host ? await B.notes.read(host) : cur.text;
    $('noteHost').textContent = ntHost;
  }
  $('noteSaved').textContent = '';
  ntRenderList();
}
ntText.addEventListener('input', () => {
  $('noteSaved').textContent = '';
  clearTimeout(ntTimer);
  ntTimer = setTimeout(() => { ntSaveNow(); $('noteSaved').textContent = 'SAVED'; }, 400);
});
ntText.addEventListener('blur', ntSaveNow);

async function ntRenderList() {
  const all = (await B.notes.all()) || [];
  $('noteList').innerHTML = all.length
    ? all.map((n) => `<div class="item${n.host === ntHost ? ' current' : ''}" data-host="${esc(n.host)}">
        <span class="meta pixel">&#9998;</span>
        <div class="main"><div>${esc(n.host)}</div><div class="sub">${esc(n.preview.replace(/\s+/g, ' '))}</div></div><span></span></div>`).join('')
    : '<div class="empty">No notes yet. Anything you write above is kept for that site.</div>';
  $('noteExport').hidden = !all.length;
}
$('noteList').addEventListener('click', (e) => {
  const row = e.target.closest('[data-host]');
  if (row) ntLoad(row.dataset.host);
});
$('noteExport').onclick = async () => {
  ntSaveNow();
  const r = await B.notes.exportAll();
  UI.stripClickOpens = null;
  if (r?.ok) stripMochi('Notes exported', 3500, 'celebrate');
};
B.notes.onChange(() => { if (!panel.hidden && section === 'notes') ntRenderList(); });

// =============== Keep everything in step with the tabs ===============
let svLastActive = null;
B.tabs.onChange(() => {
  renderSplit();
  renderReaderBtn();
  // Switching tabs with Notes open shows that site's note.
  if (UI.state.activeId !== svLastActive) {
    svLastActive = UI.state.activeId;
    if (!panel.hidden && section === 'notes') ntLoad();
  }
});
B.theme.onChange(() => renderAIPanel());

// =============== Palette + menu entries ===============
const svBasePalActions = palActions;
palActions = function () {
  const list = svBasePalActions();
  const A = (label, run, key = '', words = '') => ({ kind: 'action', label, run, key, words });
  const sp = UI.state.split;
  if (sp) {
    list.push(A('Close split view', () => B.split.off(), 'CTRL \\', 'unsplit side by side'));
    list.push(A('Swap split sides', () => B.split.swap(), '', 'side by side'));
  } else {
    list.push(A('Split view…', () => openSplitPicker(), 'CTRL \\', 'side by side two pages'));
    UI.state.tabs.forEach((t) => {
      if (t.id !== UI.state.activeId) list.push(A(`Split with ${t.title}`, () => B.split.with(t.id), '', 'side by side'));
    });
  }
  const t = activeTab();
  if (t?.readerable || t?.inReader) list.push(A(t.inReader ? 'Leave reader view' : 'Reader view', svToggleReader, 'F9', 'article read clean'));
  // Focus tools
  const sess = UI.focus?.session;
  list.push(sess
    ? A('End the focus session', () => B.focus.session('end'), '', 'focus pomodoro timer stop')
    : A('Start a focus session (25 min)', () => B.focus.session('start'), '', 'focus pomodoro timer work study'));
  list.push(A("What's new in Burrow", () => B.whatsNew.show(), '', 'changelog update release notes version new'));
  list.push(A(UI.full === 'browser' ? 'Exit full screen' : 'Full screen', () => B.fullscreen.toggle(), 'F11', 'fullscreen f11 hide bars kiosk'));
  list.push(A('Play Mochi Hop', () => B.fun.hop(), '', 'game play offline dino hop mochi fun'));
  if (!UI.state.isPrivate) list.push(A(UI.theme?.prefs.nightMode ? 'Night mode off' : 'Night mode on', () => B.fun.night(!UI.theme?.prefs.nightMode), '', 'bedtime warm dim dark sleep'));
  if (!UI.state.isPrivate) {
    list.push(A('Tidy up tabs (duplicates, forgotten)', () => window.crTidyNow?.(), '', 'clean close duplicate old tabs mochi'));
    for (const r of UI.reminders || []) {
      const when = new Date(r.at).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
      list.push(A(`Bring back now: ${r.title.slice(0, 40)} (due ${when})`, () => B.care.openReminder(r.id), '', 'reminder remind later tab ' + r.url));
      list.push(A(`Cancel reminder: ${r.title.slice(0, 40)}`, () => B.care.cancelReminder(r.id), '', 'reminder remind delete'));
    }
  }
  if (!UI.state.isPrivate) list.push(A('Weekly report', () => B.openReport(), '', 'stats week time screen report mochi'));
  if (!UI.state.isPrivate) list.push(A('Import bookmarks and history', () => { openPanel('settings'); setTimeout(() => { const d = $('importSect'); if (d) d.open = true; }, 50); }, '', 'import chrome edge firefox brave opera move switch browser'));
  list.push(A('Focus settings (time limits)', () => { openPanel('settings'); setTimeout(() => { const d = $('focusSect'); if (d) d.open = true; }, 50); }, '', 'limit time doomscroll'));
  if (t && /^https?:/.test(t.rawUrl || '')) {
    let host = '';
    try { host = new URL(t.rawUrl).host.replace(/^www\./, ''); } catch { host = ''; }
    if (host) list.push(A(`Limit ${host} to 30 min a day`, async () => { await B.focus.setLimit(host, 30); mochiSay(`I'll keep an eye on ${host}`, { pose: 'wave', essential: true }); }, '', 'focus limit time doomscroll'));
  }
  // Tab sleeping
  list.push(A('Put other tabs to sleep now', () => B.tabs.sleepNow(), '', 'sleep memory free ram slow zz'));
  if (t) {
    list.push(A(t.keepAwake ? 'Let this tab sleep normally' : 'Keep this tab awake', () => B.tabs.keepAwake(t.id), '', 'sleep zz'));
    let site = '';
    try { site = /^https?:/.test(t.rawUrl || '') ? new URL(t.rawUrl).host : ''; } catch { site = ''; }
    const never = UI.theme?.prefs.sleep?.never || [];
    if (site) {
      list.push(never.includes(site)
        ? A(`Let ${site} sleep`, () => B.setPrefs({ sleep: { allow: site } }), '', 'sleep zz')
        : A(`Never sleep ${site}`, () => B.setPrefs({ sleep: { never: site } }), '', 'sleep zz keep awake'));
    }
  }
  if (!UI.state.isPrivate) {
    list.push(A(aiState.open ? 'Close AI panel' : 'Open AI panel', () => B.ai.panel(), 'CTRL SHIFT A', 'claude chatgpt gemini assistant chat side'));
    list.push(A('Notes for this site', () => openPanel('notes'), 'CTRL SHIFT E', 'note write jot'));
    list.push(A('Export notes as Markdown', () => B.notes.exportAll(), '', 'md save notes'));
  }
  return list;
};

(window.__loaded = window.__loaded || []).push('panes');
