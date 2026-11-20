// "What's new" popup: shown once after Burrow updates itself (and from Settings → About / Ctrl+K).
// Lists each version's new things, fixes, and the testers who helped. Names start with "wn".
const wnBox = $('whatsNew');
FLOATERS.whatsNew = wnBox;
UI.whatsNew = null; // (the self-test reads this)

function wnList(title, items) {
  return items?.length ? `<h4>${title}</h4><ul>${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
}
function wnShow({ from, to, entries }) {
  if (!entries?.length) return;
  UI.whatsNew = { from, to, versions: entries.map((e) => e.version) };
  $('wnKicker').textContent = from && from !== '0.0.0' ? `UPDATED · V${from} → V${to}` : `VERSION ${to}`;
  $('wnBody').innerHTML = entries.map((e) => {
    // "Harshad", "Harshad and Aaryan", "A, B and C"
    const people = (e.thanks || []).map((t) => `<b>${esc(t.name)}</b>${t.for ? ` (${esc(t.for)})` : ''}`);
    const names = people.length > 1 ? `${people.slice(0, -1).join(', ')} and ${people[people.length - 1]}` : people[0];
    const thanks = people.length ? `<p class="wn-thanks">♥ Thank you, ${names}, for testing!</p>` : '';
    return `<section class="wn-ver"><h3>${esc(e.title)} <span class="pixel">V${esc(e.version)}</span></h3>
      ${e.choose === 'look' ? wnLookPicker() : ''}${wnList('NEW', e.new)}${wnList('FIXED', e.fixed)}${thanks}</section>`;
  }).join('');
  wnSyncLook();
  $('wnMochi').innerHTML = UI.theme ? window.Mochi.svg(UI.theme.tokens, 'celebrate', 56) : '';
  showOverlay('whatsNew');
  $('wnClose').focus();
}
B.whatsNew.onShow(wnShow);

// 0.3.0 brought a new look: the note lets you pick Soft paper or keep Classic (also in Settings → Look).
function wnLookPicker() {
  return `<div class="wn-look"><p>Burrow has a calmer new look. Try both, keep the one you like — you can change it any time in Settings → Look.</p>
    <div class="seg seg-2 look-seg" id="wnLookSeg" role="radiogroup" aria-label="Look">
      <button data-look="soft" role="radio"><span class="look-swatch soft" aria-hidden="true"></span>Soft paper</button>
      <button data-look="classic" role="radio"><span class="look-swatch classic" aria-hidden="true"></span>Classic</button>
    </div></div>`;
}
function wnSyncLook() {
  const look = UI.theme?.settings?.look === 'classic' ? 'classic' : 'soft';
  document.querySelectorAll('#wnLookSeg [data-look]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.look === look)));
}
$('wnBody').addEventListener('click', (e) => {
  const b = e.target.closest('#wnLookSeg [data-look]');
  if (b) B.theme.set({ look: b.dataset.look });
});
B.theme.onChange(() => wnSyncLook());
$('wnClose').onclick = () => hideOverlay();
$('whatsNewBtn').onclick = () => B.whatsNew.show();

(window.__loaded = window.__loaded || []).push('whatsnew');
