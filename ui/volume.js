// The volume popover: click a tab's speaker → slider 0–200%, mute, and "remember for this site".
// (Names start with "vo" so they can't clash with the other interface scripts.)
const voPop = $('volPop');
FLOATERS.volPop = voPop;
let voTab = null;
let voTimer = 0;

function voRender(t, note) {
  const v = t.volume ?? 100;
  $('volSlider').value = String(v);
  $('volPct').textContent = t.muted ? 'MUTED' : `${v}%`;
  $('volMute').classList.toggle('muted', !!t.muted);
  $('volMute').setAttribute('aria-label', t.muted ? 'Unmute this tab' : 'Mute this tab');
  let host = '';
  try { host = /^https?:/.test(t.rawUrl || '') ? new URL(t.rawUrl).host.replace(/^www\./, '') : ''; } catch { host = ''; }
  $('volSite').textContent = host || 'this site';
  $('volRemember').disabled = !host;
  $('volRemember').checked = !!t.volumeRemembered;
  $('volTitle').textContent = `VOLUME · ${(t.title || '').slice(0, 22).toUpperCase()}`;
  const n = $('volNote');
  n.hidden = !note;
  n.textContent = note || '';
}

function openVolume(id, anchor) {
  const t = UI.state.tabs.find((x) => x.id === id);
  if (!t) return;
  voTab = id;
  voRender(t, v100Note(t));
  const r = anchor.getBoundingClientRect();
  voPop.style.left = Math.max(8, Math.min(window.innerWidth - 290, r.left - 12)) + 'px';
  voPop.style.top = (r.bottom + 8) + 'px';
  showOverlay('volPop');
  $('volSlider').focus();
}
window.openVolume = openVolume;
const v100Note = (t) => ((t.volume ?? 100) > 100 && t.boostOk === false ? "This site doesn't allow boosting, so it stays at 100%." : '');

async function voSet(volume, remember) {
  const r = await B.tabs.volume(voTab, volume, remember);
  if (!r) return;
  const t = UI.state.tabs.find((x) => x.id === voTab);
  if (t) voRender({ ...t, volume: r.volume, volumeRemembered: remember ?? t.volumeRemembered },
    r.volume > 100 && r.media && !r.boostOk ? "This site doesn't allow boosting, so it stays at 100%." : '');
}
$('volSlider').addEventListener('input', () => {
  const v = Number($('volSlider').value);
  $('volPct').textContent = `${v}%`;
  clearTimeout(voTimer);
  voTimer = setTimeout(() => voSet(v, $('volRemember').checked ? true : undefined), 60);
});
$('volMute').onclick = () => { B.tabs.mute(voTab); };
$('volRemember').addEventListener('change', (e) => voSet(Number($('volSlider').value), e.target.checked));
// Keep the popover in step if the tab changes underneath (mute, navigation).
B.tabs.onChange(() => {
  if (voPop.hidden || voTab === null) return;
  const t = UI.state.tabs.find((x) => x.id === voTab);
  if (!t) { hideOverlay(); return; }
  $('volMute').classList.toggle('muted', !!t.muted);
  $('volPct').textContent = t.muted ? 'MUTED' : `${$('volSlider').value}%`;
});

(window.__loaded = window.__loaded || []).push('volume');
