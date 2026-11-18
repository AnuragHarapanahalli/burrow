// Site permission bar, Settings → Site permissions / Clear browsing data / About Burrow (updates,
// default browser). Names start with "st" so they can't clash with the other interface scripts.

// =============== "example.com wants to use your camera — Allow / Block" ===============
const stAsks = []; // waiting questions: { id, tabId, host, kinds, text }
UI.permAsks = stAsks; // (the self-test reads this)
function stRender() {
  const bar = $('permBar');
  const ask = stAsks.find((a) => a.tabId === null || a.tabId === UI.state.activeId) || null;
  bar.hidden = !ask;
  if (!ask) return;
  bar.dataset.id = ask.id;
  $('permText').innerHTML = `<b>${esc(ask.host)}</b> wants to ${esc(ask.text)}${UI.state.isPrivate ? ' <span class="perm-note">(private window: asked again next time)</span>' : ''}`;
  $('permIco').dataset.kind = ask.kinds[0];
}
B.perms.onAsk((ask) => { stAsks.push(ask); stRender(); if (!$('permBar').hidden) bump($('permBar'), 'drop-in'); });
B.perms.onDone(({ id }) => {
  const i = stAsks.findIndex((a) => a.id === id);
  if (i >= 0) stAsks.splice(i, 1);
  stRender();
});
B.tabs.onChange(() => stRender());
function stAnswer(allow) {
  const id = Number($('permBar').dataset.id);
  if (!id) return;
  B.perms.answer(id, allow);
}
$('permAllow').onclick = () => stAnswer(true);
$('permBlock').onclick = () => stAnswer(false);

// =============== Settings → Site permissions ===============
const ST_KIND = { camera: 'Camera', microphone: 'Microphone', location: 'Location', notifications: 'Notifications' };
async function renderSitePerms() {
  const list = (await B.perms.list()) || [];
  $('permList').innerHTML = list.length
    ? list.map((site) => `<div class="perm-site" data-origin="${esc(site.origin)}"><b>${esc(site.host)}</b>
        ${Object.entries(site.kinds).map(([k, v]) => `<label class="perm-row"><span>${ST_KIND[k] || esc(k)}</span>
          <select data-kind="${esc(k)}" aria-label="${ST_KIND[k] || esc(k)} for ${esc(site.host)}">
            <option value="allow"${v === 'allow' ? ' selected' : ''}>Allow</option>
            <option value="block"${v === 'block' ? ' selected' : ''}>Block</option>
            <option value="">Ask next time</option>
          </select></label>`).join('')}</div>`).join('')
    : '<div class="empty">No sites have asked yet. When one does, your answer shows up here.</div>';
  $('sumPerms').textContent = list.length ? `${list.length} site${list.length === 1 ? '' : 's'}` : 'None yet';
}
window.renderSitePerms = renderSitePerms;
$('permList').addEventListener('change', async (e) => {
  const sel = e.target.closest('[data-kind]');
  const site = e.target.closest('[data-origin]');
  if (!sel || !site) return;
  await B.perms.set(site.dataset.origin, sel.dataset.kind, sel.value || null);
  renderSitePerms();
});

// =============== Settings → Clear browsing data ===============
$('clearGo').addEventListener('click', async () => {
  const what = { history: $('clrHistory').checked, cookies: $('clrCookies').checked, cache: $('clrCache').checked, downloads: $('clrDownloads').checked };
  if (!Object.values(what).some(Boolean)) { $('clearResult').textContent = 'Tick at least one thing to clear.'; return; }
  $('clearGo').disabled = true;
  $('clearGo').textContent = 'Clearing…';
  const done = await B.clearData($('clearRange').value, what);
  $('clearGo').disabled = false;
  $('clearGo').textContent = 'Clear data';
  if (!done) return;
  const parts = [];
  if ('history' in done) parts.push(`${done.history} page${done.history === 1 ? '' : 's'} of history`);
  if (done.cookies) parts.push('cookies and site data');
  if (done.cache) parts.push('cached files');
  if ('downloads' in done) parts.push(`${done.downloads} download${done.downloads === 1 ? '' : 's'} from the list`);
  $('clearResult').textContent = `Cleared ${parts.join(', ')}.`;
  mochiSay('Squeaky clean!', { pose: 'happy', essential: true });
});

// =============== Settings → About Burrow (updates, default browser) ===============
const ST_STATUS = {
  dev: 'Updates work in the installed app (not while developing).',
  portable: 'This is the portable copy: download new versions from GitHub.',
  idle: 'Checks for updates automatically.',
  checking: 'Checking for updates…',
  latest: 'You have the latest version.',
  downloading: 'Downloading an update…',
  ready: 'Update downloaded. Restart Burrow to finish.',
  error: "Couldn't check for updates right now.",
};
function renderUpdate(st) {
  if (!st) return;
  $('aboutVersion').textContent = `v${st.current}`;
  $('updateStatus').textContent = st.status === 'ready' && st.version ? `Version ${st.version} is ready. Restart Burrow to finish.` : (ST_STATUS[st.status] || '');
  $('updateCheck').hidden = !['idle', 'latest', 'error'].includes(st.status);
  $('updateRestart').hidden = st.status !== 'ready';
  UI.update = st;
}
B.updates.state().then(renderUpdate);
B.updates.onState(renderUpdate);
$('updateCheck').onclick = () => B.updates.check().then(renderUpdate);
$('updateRestart').onclick = () => B.updates.install();
async function renderDefault() {
  const st = await B.defaultBrowser.state();
  $('defaultState').textContent = st?.isDefault ? 'Burrow is your default browser.' : 'Links from other apps open in another browser.';
  $('makeDefault').hidden = !!st?.isDefault;
}
window.renderDefault = renderDefault;
$('makeDefault').onclick = () => B.defaultBrowser.make();

(window.__loaded = window.__loaded || []).push('site-ui');
