// Side panel: Bookmarks, History, Downloads, Settings.
let section = 'bookmarks';
let lastLibrary = 'bookmarks';
let downloadsList = [];

function openPanel(name = section) {
  setTimeout(() => window.syncSettingsBtn?.(), 0);
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
B.onOpenPanel((name) => {
  const [p, sect] = String(name || '').split(':');
  openPanel(p);
  if (sect) setTimeout(() => { const d = $(sect + 'Sect'); if (d) { d.open = true; d.scrollIntoView({ block: 'start' }); } }, 80);
});
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
        <div class="main"><div>${esc(b.title || b.url)}</div><div class="sub">${b.folder ? `<span class="folder">${esc(b.folder)}</span> \u00b7 ` : ''}${esc(host(b.url))}</div></div>
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
      if (d.held) {
        status = `<span class="dl-warn">A program from ${esc(host(d.url))}. Keep it only if you trust this site.</span>`;
        actions = `<button class="text-btn" data-act="keep" data-id="${d.id}">Keep</button>
          <button class="text-btn" data-act="discard" data-id="${d.id}">Discard</button>`;
      } else if (d.state === 'progressing' || d.state === 'paused') {
        status = `${size(d.received)}${d.total ? ' of ' + size(d.total) : ''}${d.state === 'paused' ? ' &middot; paused' : ''}`;
        actions = `<button class="text-btn" data-act="pause" data-id="${d.id}">${d.state === 'paused' ? 'Resume' : 'Pause'}</button>
          <button class="text-btn" data-act="cancel" data-id="${d.id}">Cancel</button>`;
      } else if (d.state === 'completed') {
        status = d.exists ? `${size(d.total || d.received)} &middot; ${esc(host(d.url))}` : 'File moved or deleted';
        if (d.exists) actions = `<button class="text-btn" data-act="open" data-id="${d.id}">Open</button>
          <button class="text-btn" data-act="show" data-id="${d.id}">Show in folder</button>`;
      } else status = d.state === 'cancelled' ? 'Cancelled' : d.state === 'discarded' ? 'Discarded' : 'Failed';
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
  toast(`Saved ${d.filename}`, { kind: 'success', action: 'Show', onAction: () => openPanel('downloads') });
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
  const look = settings.look === 'classic' ? 'classic' : 'soft';
  const density = settings.density === 'compact' ? 'compact' : 'comfortable';
  document.querySelectorAll('#lookSeg button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.look === look)));
  document.querySelectorAll('#densitySeg button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.density === density)));
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
  $('sumTheme').textContent = `${look === 'classic' ? 'Classic' : 'Soft paper'} · ${cap(settings.mode)}`;
  $('sumColour').innerHTML = `<span class="chip-s" style="background:${tokens.accent}"></span>${settings.useWindowsAccent ? 'Windows accent' : esc(preset ? preset.name : 'Custom')}`;
  const sl = prefs.sleep || { on: true, minutes: 30, never: [] };
  const sleepVal = sl.on ? String(sl.minutes) : 'off';
  document.querySelectorAll('#sleepSeg [data-sleep]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.sleep === sleepVal)));
  $('neverList').innerHTML = (sl.never || []).length
    ? `<div class="pixel sect-sub">NEVER SLEEP</div>` + sl.never.map((h) => `<span class="never-chip">${esc(h)}<button data-allow="${esc(h)}" aria-label="Let ${esc(h)} sleep">&times;</button></span>`).join('')
    : '';
  const sleepLabel = sl.on ? ({ 15: '15m', 30: '30m', 60: '1h', 120: '2h' }[sl.minutes] || sl.minutes + 'm') : 'off';
  const mm = prefs.mochiMode || 'lively';
  document.querySelectorAll('#mochiSeg [data-mochi]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mochi === mm)));
  $('sumMochi').textContent = cap(mm);
  const eye = Number(prefs.eyeBreaks) || 0;
  document.querySelectorAll('#eyeSeg [data-eye]').forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.eye) === eye)));
  $('mochiNote').textContent = {
    lively: 'Mochi reacts to bookmarks, new workspaces, split view and more, at most every 25 seconds.',
    quiet: 'Mochi only speaks up for important things: finished downloads, tabs put to sleep, and problems.',
    off: "Mochi stays out of sight. (Still shows up in the welcome tour.)",
  }[mm];
  $('mochiGallery').innerHTML = ['idle', 'wave', 'happy', 'celebrate', 'sleepy', 'press', 'oops'].map((p) =>
    `<figure title="${p}">${window.Mochi.svg(tokens, p, 40)}<figcaption class="pixel">${p.toUpperCase()}</figcaption></figure>`).join('');
  renderFocusSettings();
  window.renderWardrobe?.();
  window.renderSitePerms?.();
  window.renderDefault?.();
  window.renderBedtime?.(prefs);
  $('sumTabs').textContent = `${cap(prefs.tabsMode)} \u00b7 sleep ${sleepLabel}`;
  $('sumLayout').textContent = [prefs.bookmarksBar ? 'Bookmarks bar' : '', settings.grid ? 'Grid' : ''].filter(Boolean).join(', ') || 'Minimal';
}
window.renderSettingsPane = renderSettingsPane;

$('engines').addEventListener('click', (e) => {
  const b = e.target.closest('[data-engine]');
  if (b) { B.setPrefs({ searchEngine: b.dataset.engine }); bump(b, 'pop'); }
});
$('bmbarToggle').addEventListener('change', (e) => B.setPrefs({ bookmarksBar: e.target.checked }));
// ---------- Settings → Focus (time limits) ----------
async function renderFocusSettings() {
  const info = await B.focus.info();
  if (!info) return;
  const opts = (sel) => info.budgets.map((m) => `<option value="${m}"${m === sel ? ' selected' : ''}>${m} min / day</option>`).join('');
  $('limitList').innerHTML = info.limits.length
    ? info.limits.map((l) => `<div class="limit-row" data-site="${esc(l.site)}">
        <div class="limit-name"><b>${esc(l.name)}</b><span>${esc(l.site)}</span></div>
        <span class="pixel limit-used${l.remainingSec <= 0 ? ' over' : ''}">${l.usedMin} / ${l.budget} MIN</span>
        <select data-budget aria-label="Daily limit for ${esc(l.name)}">${opts(l.budget)}</select>
        <button class="x" data-remove aria-label="Remove limit for ${esc(l.name)}">&times;</button></div>`).join('')
    : '<div class="empty">No limits yet. Add a site, or pick one below.</div>';
  if (!$('limitMin').options.length) $('limitMin').innerHTML = opts(30);
  $('limitSuggest').innerHTML = info.suggested.length
    ? '<span class="pixel">SUGGESTIONS</span>' + info.suggested.map((sname) => `<button data-suggest="${esc(sname)}">+ ${esc(sname)}</button>`).join('')
    : '';
  $('reportOn').checked = info.reportOn !== false;
  $('focusStart').textContent = info.session ? 'End the focus session' : 'Start a 25-minute focus session';
  $('sumFocus').textContent = info.limits.length ? `${info.limits.length} limit${info.limits.length === 1 ? '' : 's'}${info.streak ? ` \u00b7 ${info.streak}-day streak` : ''}` : 'Off';
}
window.renderFocusSettings = renderFocusSettings;
$('limitList').addEventListener('change', async (e) => {
  const row = e.target.closest('[data-site]');
  if (row && e.target.matches('[data-budget]')) { await B.focus.setLimit(row.dataset.site, Number(e.target.value)); renderFocusSettings(); }
});
$('limitList').addEventListener('click', async (e) => {
  const row = e.target.closest('[data-site]');
  if (row && e.target.closest('[data-remove]')) { await B.focus.setLimit(row.dataset.site, 0); renderFocusSettings(); }
});
$('limitAdd').addEventListener('submit', async (e) => {
  e.preventDefault();
  const ok = await B.focus.setLimit($('limitSite').value.trim(), Number($('limitMin').value));
  $('limitErr').hidden = ok;
  $('limitErr').textContent = ok ? '' : 'Enter a website like instagram.com';
  if (ok) { $('limitSite').value = ''; renderFocusSettings(); }
});
$('limitSite').addEventListener('input', () => { $('limitErr').hidden = true; });
$('limitSuggest').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-suggest]');
  if (b) { await B.focus.setLimit(b.dataset.suggest, 30); renderFocusSettings(); }
});
$('reportOn').addEventListener('change', (e) => B.setPrefs({ reportOn: e.target.checked }));
$('reportOpen').addEventListener('click', () => B.openReport());
let statsClearArmed = 0;
$('statsClear').addEventListener('click', () => {
  const b = $('statsClear');
  if (!statsClearArmed) { // two clicks, so it can't happen by accident
    statsClearArmed = setTimeout(() => { statsClearArmed = 0; b.textContent = 'Clear my stats'; b.classList.remove('armed'); }, 4000);
    b.textContent = 'Click again to clear everything';
    b.classList.add('armed');
    return;
  }
  clearTimeout(statsClearArmed);
  statsClearArmed = 0;
  B.stats.clear();
  b.textContent = 'Cleared';
  b.classList.remove('armed');
  setTimeout(() => { b.textContent = 'Clear my stats'; }, 2000);
});
$('focusStart').addEventListener('click', () => { B.focus.session(UI.focus?.session ? 'end' : 'start'); setTimeout(renderFocusSettings, 300); });

// ---------- Settings → Import (from Chrome, Edge, Firefox…) ----------
const impFmt = (n) => Number(n || 0).toLocaleString('en');
const impPl = (n, w) => `${impFmt(n)} ${w}${Number(n) === 1 ? '' : 's'}`;
let impTop = [];
async function renderImport() {
  $('impList').innerHTML = '<div class="empty">Looking for other browsers&hellip;</div>';
  const list = (await B.importer.sources()) || [];
  $('impList').innerHTML = list.length
    ? list.map((src) => `<div class="imp-row" data-src="${esc(src.id)}">
        <div class="imp-name"><b>${esc(src.label)}</b><span>${impPl(src.bookmarks, 'bookmark')} &middot; ${impPl(src.history, 'page')}</span></div>
        <button class="imp-go" data-import="${esc(src.id)}">Import</button></div>`).join('')
    : '<div class="empty">No other browsers found on this computer.</div>';
}
window.renderImport = renderImport;
$('importSect').addEventListener('toggle', () => { if ($('importSect').open) renderImport(); });
$('impList').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-import]');
  if (!b || b.disabled) return;
  b.disabled = true;
  b.textContent = 'Importing…';
  const r = await B.importer.run(b.dataset.import, { bookmarks: $('impBookmarks').checked, history: $('impHistory').checked });
  b.textContent = r && !r.error ? 'Done' : 'Try again';
  b.disabled = !!(r && !r.error);
  const out = $('impResult');
  out.hidden = false;
  if (!r || r.error) { out.textContent = "Couldn't read that browser's files."; return; }
  impTop = r.top || [];
  const skipped = r.bookmarks.skipped ? ` (${impFmt(r.bookmarks.skipped)} you already had)` : '';
  out.innerHTML = `<p><b>From ${esc(r.label)}:</b> ${impPl(r.bookmarks.added, 'bookmark')}${skipped} and ${impPl(r.history.added, 'page')} of history.</p>`
    + (impTop.length ? `<button class="text-btn" id="impLinks">Add ${esc(impTop.map((t) => t.name).join(', '))} to your new-tab quick links</button>` : '');
  $('sumImport').textContent = `From ${r.label}`;
  if (r.bookmarks.added || r.history.added) toast(`Moved in! ${impPl(r.bookmarks.added, 'bookmark')} unpacked`, { kind: 'success' });
  else toast('All of that was already here');
});
$('impResult').addEventListener('click', async (e) => {
  if (!e.target.closest('#impLinks')) return;
  await B.importer.addQuickLinks(impTop);
  e.target.closest('#impLinks').outerHTML = '<p class="sect-note">Added to your quick links.</p>';
});

$('mochiSeg').addEventListener('click', (e) => {
  const b = e.target.closest('[data-mochi]');
  if (!b) return;
  B.setPrefs({ mochiMode: b.dataset.mochi });
  if (b.dataset.mochi !== 'off') setTimeout(() => window.mochiSay?.(b.dataset.mochi === 'quiet' ? "I'll keep it short" : 'Yay, chatty me!', { pose: 'wave', essential: true, ms: 2500 }), 150);
});
$('eyeSeg').addEventListener('click', (e) => {
  const b = e.target.closest('[data-eye]');
  if (b) B.setPrefs({ eyeBreaks: Number(b.dataset.eye) });
});
$('sleepSeg').addEventListener('click', (e) => {
  const b = e.target.closest('[data-sleep]');
  if (!b) return;
  B.setPrefs({ sleep: b.dataset.sleep === 'off' ? { on: false } : { on: true, minutes: Number(b.dataset.sleep) } });
});
$('neverList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-allow]');
  if (b) B.setPrefs({ sleep: { allow: b.dataset.allow } });
});
$('aiList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-ai]');
  if (b) { B.setPrefs({ aiProvider: b.dataset.ai }); bump(b, 'pop'); }
});
$('askSeg').addEventListener('click', (e) => { const b = e.target.closest('[data-ask]'); if (b) B.setPrefs({ askMode: b.dataset.ask }); });

$('modeSeg').addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (b) B.theme.set({ mode: b.dataset.mode }); });
$('lookSeg').addEventListener('click', (e) => { const b = e.target.closest('[data-look]'); if (b) B.theme.set({ look: b.dataset.look }); });
$('densitySeg').addEventListener('click', (e) => { const b = e.target.closest('[data-density]'); if (b) B.theme.set({ density: b.dataset.density }); });
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

// The ⚙ button in the toolbar: opens Settings (or closes it if it's already showing).
$('settingsBtn').addEventListener('click', () => {
  if (!panel.hidden && section === 'settings') closePanel(); else openPanel('settings');
});
window.syncSettingsBtn = () => $('settingsBtn').setAttribute('aria-pressed', String(!panel.hidden && section === 'settings'));
new MutationObserver(() => window.syncSettingsBtn()).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
