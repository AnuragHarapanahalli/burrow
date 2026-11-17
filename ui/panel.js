// Side panel: Bookmarks, History, Downloads, Settings.
let section = 'bookmarks';
let lastLibrary = 'bookmarks';
let downloadsList = [];

function openPanel(name = section) {
  hideOverlay();
  section = name;
  if (name !== 'settings') lastLibrary = name;
  const wasHidden = panel.hidden;
  panel.hidden = false;
  if (wasHidden) bump(panel, 'slide-in');
  document.querySelectorAll('#panelNav [data-section]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.section === name)));
  document.querySelectorAll('.pane').forEach((p) => { p.hidden = p.dataset.pane !== name; });
  sendLayout();
  renderSection();
  if (name === 'downloads') $('dlBtn').classList.remove('fresh');
  const search = { bookmarks: 'bmSearch', history: 'histSearch' }[name];
  if (search) $(search).focus();
}
function closePanel() {
  panel.hidden = true;
  sendLayout();
}
window.openPanel = openPanel;
$('dlBtn').onclick = () => (!panel.hidden && section === 'downloads' ? closePanel() : openPanel('downloads'));
$('panelClose').onclick = closePanel;
$('panelNav').addEventListener('click', (e) => { const b = e.target.closest('[data-section]'); if (b) openPanel(b.dataset.section); });
B.onOpenPanel((name) => openPanel(name));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !panel.hidden && !UI.editing && overlay.hidden) closePanel();
});

function renderSection() {
  if (panel.hidden) return;
  if (section === 'bookmarks') renderBookmarks();
  else if (section === 'history') renderHistory();
  else if (section === 'downloads') renderDownloads();
  else renderSettingsPane();
}
B.library.onChange((what) => { if (what === section) renderSection(); });

const host = (u) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return u; } };
// Clicking a link opens it here; Ctrl+click or middle-click opens a new tab.
function openFromList(e, url) { B.library.open(url, e.ctrlKey || e.metaKey || e.button === 1); }

// ---------- Bookmarks ----------
async function renderBookmarks() {
  const items = (await B.library.bookmarks($('bmSearch').value)) || [];
  $('bmList').innerHTML = items.length
    ? items.map((b) => `<div class="item" data-url="${esc(b.url)}" title="${esc(b.url)}">
        <span class="meta pixel">&#9733;</span>
        <div class="main"><div>${esc(b.title || b.url)}</div><div class="sub">${esc(host(b.url))}</div></div>
        <button class="x" data-rm="${b.id}" aria-label="Remove bookmark">&times;</button></div>`).join('')
    : `<div class="empty">${$('bmSearch').value ? 'No bookmarks match that.' : 'No bookmarks yet. Press Ctrl+D or the star in the address bar on any page.'}</div>`;
}
$('bmSearch').addEventListener('input', renderBookmarks);
$('bmList').addEventListener('mousedown', (e) => {
  const rm = e.target.closest('[data-rm]');
  if (rm) { e.preventDefault(); B.library.removeBookmark(Number(rm.dataset.rm)); return; }
  const row = e.target.closest('[data-url]');
  if (row && e.button !== 2) openFromList(e, row.dataset.url);
});

// ---------- History ----------
function dayLabel(ts) {
  const d = new Date(ts), now = new Date();
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(now) - start(d)) / 864e5);
  if (diff === 0) return 'TODAY';
  if (diff === 1) return 'YESTERDAY';
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}
async function renderHistory() {
  const items = (await B.library.history($('histSearch').value)) || [];
  let last = '';
  $('histList').innerHTML = items.length
    ? items.map((h) => {
      const label = dayLabel(h.last);
      const group = label !== last ? `<div class="group pixel">${label}</div>` : '';
      last = label;
      const d = new Date(h.last);
      return `${group}<div class="item" data-url="${esc(h.url)}" title="${esc(h.url)}">
        <span class="meta pixel">${pad(d.getHours())}:${pad(d.getMinutes())}</span>
        <div class="main"><div>${esc(h.title || h.url)}</div><div class="sub">${esc(host(h.url))}</div></div>
        <button class="x" data-rm="${esc(h.url)}" aria-label="Remove from history">&times;</button></div>`;
    }).join('')
    : `<div class="empty">${$('histSearch').value ? 'Nothing in your history matches that.' : 'Pages you visit will show up here.'}</div>`;
  $('histClear').hidden = !items.length || !!$('histSearch').value;
}
$('histSearch').addEventListener('input', renderHistory);
$('histList').addEventListener('mousedown', (e) => {
  const rm = e.target.closest('[data-rm]');
  if (rm) { e.preventDefault(); B.library.removeHistory(rm.dataset.rm); return; }
  const row = e.target.closest('[data-url]');
  if (row && e.button !== 2) openFromList(e, row.dataset.url);
});
// Two clicks to clear, so it can't happen by accident.
let clearTimer;
$('histClear').addEventListener('click', (e) => {
  const b = e.currentTarget;
  if (b.classList.contains('confirm')) {
    B.library.clearHistory();
    b.classList.remove('confirm'); b.textContent = 'Clear all history';
    return;
  }
  b.classList.add('confirm'); b.textContent = 'Click again to clear everything';
  clearTimeout(clearTimer);
  clearTimer = setTimeout(() => { b.classList.remove('confirm'); b.textContent = 'Clear all history'; }, 4000);
});

// ---------- Downloads ----------
function size(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}
function renderDownloads() {
  const list = downloadsList;
  $('dlList').innerHTML = list.length
    ? list.map((d) => {
      const pct = d.total ? Math.round((d.received / d.total) * 100) : 0;
      let status, actions = '';
      if (d.state === 'progressing' || d.state === 'paused') {
        status = `${size(d.received)}${d.total ? ' of ' + size(d.total) : ''}${d.state === 'paused' ? ' &middot; paused' : ''}`;
        actions = `<button class="text-btn" data-act="pause" data-id="${d.id}">${d.state === 'paused' ? 'Resume' : 'Pause'}</button>
          <button class="text-btn" data-act="cancel" data-id="${d.id}">Cancel</button>`;
      } else if (d.state === 'completed') {
        status = d.exists ? `${size(d.total || d.received)} &middot; ${esc(host(d.url))}` : 'File moved or deleted';
        if (d.exists) actions = `<button class="text-btn" data-act="open" data-id="${d.id}">Open</button>
          <button class="text-btn" data-act="show" data-id="${d.id}">Show in folder</button>`;
      } else status = d.state === 'cancelled' ? 'Cancelled' : 'Failed';
      const bar = d.state === 'progressing' || d.state === 'paused' ? `<div class="bar"><span style="width:${pct}%"></span></div>` : '';
      return `<div class="dl${d.state === 'completed' && !d.exists ? ' gone' : ''}">
        <div class="name" title="${esc(d.path)}">${esc(d.filename)}</div>${bar}
        <div class="status">${status}</div>${actions ? `<div class="actions">${actions}</div>` : ''}</div>`;
    }).join('')
    : '<div class="empty">Nothing downloaded yet. Files go straight to your Downloads folder.</div>';
  $('dlClear').hidden = !list.some((d) => d.state !== 'progressing' && d.state !== 'paused');
}
$('dlList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (b) B.downloads[b.dataset.act](Number(b.dataset.id));
});
$('dlClear').onclick = () => B.downloads.clear();

function renderDlBadge() {
  const active = downloadsList.filter((d) => d.state === 'progressing');
  const badge = $('dlBadge');
  const btn = $('dlBtn');
  btn.hidden = !downloadsList.length;   // the button appears once you have downloads
  btn.classList.toggle('busy', active.length > 0);
  if (active.length) {
    const total = active.reduce((a, d) => a + (d.total || 0), 0);
    const got = active.reduce((a, d) => a + d.received, 0);
    badge.textContent = total ? `${Math.round((got / total) * 100)}%` : '...';
  } else badge.textContent = $('dlBtn').classList.contains('fresh') ? 'NEW' : '';
}
B.downloads.onChange((list) => {
  downloadsList = list || [];
  renderDlBadge();
  if (!panel.hidden && section === 'downloads') renderDownloads();
});
B.downloads.onDone((d) => {
  if (panel.hidden || section !== 'downloads') $('dlBtn').classList.add('fresh');
  renderDlBadge();
  bump($('dlBtn'), 'pop');
  UI.stripClickOpens = 'downloads';
  stripMochi(`Saved ${d.filename}`);
});

// ---------- Settings ----------
const MOCHI_LINES = ['Ooh, new colours!', 'That one suits you.', 'Fancy!', 'I feel brand new.', 'Cozy choice.'];
let lineIdx = 0;
function renderSettingsPane() {
  if (!UI.theme || panel.hidden || section !== 'settings') return;
  const { settings, tokens, presets, prefs } = UI.theme;
  $('engines').innerHTML = prefs.engines.map((e) => `
    <button class="engine" role="radio" aria-checked="${e.id === prefs.searchEngine}" data-engine="${e.id}">
      <span class="radio" aria-hidden="true"></span><span class="en-name">${esc(e.name)}</span><span class="en-host">${esc(e.host)}</span>
    </button>`).join('');
  document.querySelectorAll('#modeSeg button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === settings.mode)));
  document.querySelectorAll('#tabsSeg button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.tabs === prefs.tabsMode)));
  $('bmbarToggle').checked = prefs.bookmarksBar;
  $('swatches').innerHTML = presets.map((p) => `
    <button role="radio" aria-checked="${!settings.useWindowsAccent && p.hex === settings.seed}" data-seed="${p.hex}" title="${p.name}">
      <span class="chip" style="background:${p.hex}"></span>${p.name}
    </button>`).join('');
  $('customColor').value = settings.seed.toLowerCase();
  $('winAccent').checked = settings.useWindowsAccent;
  $('gridToggle').checked = settings.grid;
  $('panelMochi').innerHTML = window.Mochi.svg(tokens, 'happy', 64);

  // Closed dropdowns show their current value on the right.
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const preset = presets.find((p) => p.hex === settings.seed);
  $('sumEngine').textContent = prefs.engines.find((e) => e.id === prefs.searchEngine)?.name || '';
  $('aiList').innerHTML = prefs.aiProviders.map((p) => `
    <button class="engine" role="radio" aria-checked="${p.id === prefs.aiProvider}" data-ai="${p.id}">
      <span class="radio" aria-hidden="true"></span><span class="en-name">${esc(p.name)}</span>
      <span class="en-host">${esc(p.host)}${p.prefill ? '' : ' &middot; you paste'}</span>
    </button>`).join('');
  document.querySelectorAll('#askSeg button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.ask === prefs.askMode)));
  const aiName = prefs.aiProviders.find((p) => p.id === prefs.aiProvider)?.name || '';
  $('sumAI').textContent = `${aiName} \u00b7 ${{ smart: 'Smart', search: 'Search first', ai: 'AI first' }[prefs.askMode]}`;
  $('sumTheme').textContent = cap(settings.mode);
  $('sumColour').innerHTML = `<span class="chip-s" style="background:${tokens.accent}"></span>${settings.useWindowsAccent ? 'Windows accent' : esc(preset ? preset.name : 'Custom')}`;
  $('sumTabs').textContent = cap(prefs.tabsMode);
  $('sumLayout').textContent = [prefs.bookmarksBar ? 'Bookmarks bar' : '', settings.grid ? 'Grid' : ''].filter(Boolean).join(', ') || 'Minimal';
}
window.renderSettingsPane = renderSettingsPane;

$('engines').addEventListener('click', (e) => {
  const b = e.target.closest('[data-engine]');
  if (b) { B.setPrefs({ searchEngine: b.dataset.engine }); bump(b, 'pop'); }
});
$('bmbarToggle').addEventListener('change', (e) => B.setPrefs({ bookmarksBar: e.target.checked }));
$('aiList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-ai]');
  if (b) { B.setPrefs({ aiProvider: b.dataset.ai }); bump(b, 'pop'); }
});
$('askSeg').addEventListener('click', (e) => { const b = e.target.closest('[data-ask]'); if (b) B.setPrefs({ askMode: b.dataset.ask }); });

$('modeSeg').addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (b) B.theme.set({ mode: b.dataset.mode }); });
$('tabsSeg').addEventListener('click', (e) => { const b = e.target.closest('[data-tabs]'); if (b) B.setPrefs({ tabsMode: b.dataset.tabs }); });
$('swatches').addEventListener('click', (e) => {
  const b = e.target.closest('[data-seed]');
  if (!b) return;
  B.theme.set({ seed: b.dataset.seed, useWindowsAccent: false });
  $('panelBubble').textContent = MOCHI_LINES[lineIdx++ % MOCHI_LINES.length];
});
$('customColor').addEventListener('input', (e) => B.theme.set({ seed: e.target.value, useWindowsAccent: false }));
$('winAccent').addEventListener('change', (e) => B.theme.set({ useWindowsAccent: e.target.checked }));
$('gridToggle').addEventListener('change', (e) => B.theme.set({ grid: e.target.checked }));

(window.__loaded = window.__loaded || []).push('panel');
