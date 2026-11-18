// Mochi, fun: the wardrobe (carrots → outfits), bedtime / night mode, and Mochi Hop.
// Names start with "fn" so they can't clash with the other interface scripts.

// Mochi wears the outfit you picked, everywhere in the interface.
B.theme.onChange((p) => { window.Mochi.wear = p?.prefs?.outfit || null; });

// =============== Wardrobe (Settings → Mochi) ===============
async function renderWardrobe() {
  const box = $('wardrobe');
  if (!box || !UI.theme) return;
  const st = await B.fun.state();
  if (!st) return;
  $('carrotCount').textContent = `· ${st.carrots} CARROT${st.carrots === 1 ? '' : 'S'}`;
  const was = window.Mochi.wear;
  const tile = (id, name, html) => `<div class="wr-item${st.outfit === id || (!id && !st.outfit) ? ' on' : ''}" data-outfit="${id || ''}">${html}<span class="wr-name">${esc(name)}</span>`;
  const items = [];
  window.Mochi.wear = null;
  items.push(tile(null, 'Just Mochi', window.Mochi.svg(UI.theme.tokens, 'idle', 44)) + `<button class="wr-btn" data-wear="">${!st.outfit ? 'Wearing' : 'Wear'}</button></div>`);
  for (const o of st.outfits) {
    window.Mochi.wear = o.id;
    const owned = st.owned.includes(o.id);
    const btn = owned
      ? `<button class="wr-btn" data-wear="${o.id}">${st.outfit === o.id ? 'Wearing' : 'Wear'}</button>`
      : `<button class="wr-btn buy" data-buy="${o.id}" ${st.carrots < o.price ? 'disabled' : ''}>${o.price} carrots</button>`;
    items.push(tile(o.id, o.name, window.Mochi.svg(UI.theme.tokens, 'idle', 44)) + btn + '</div>');
  }
  window.Mochi.wear = was;
  box.innerHTML = items.join('');
}
window.renderWardrobe = renderWardrobe;
$('wardrobe').addEventListener('click', async (e) => {
  const buy = e.target.closest('[data-buy]');
  const wear = e.target.closest('[data-wear]');
  if (buy && !buy.disabled) {
    if (await B.fun.buy(buy.dataset.buy)) mochiSay('Ooh, how do I look?', { pose: 'celebrate', essential: true });
  } else if (wear) await B.fun.wear(wear.dataset.wear || null);
  setTimeout(renderWardrobe, 150);
});

// =============== Bedtime / night mode ===============
(function fnBedtimeOptions() {
  const opts = ['<option value="">Off</option>'];
  for (let m = 21 * 60; m <= 25 * 60; m += 30) {
    const h = Math.floor(m / 60) % 24;
    const v = `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    opts.push(`<option value="${v}">${v}</option>`);
  }
  $('bedtime').innerHTML = opts.join('');
})();
function renderBedtime(prefs) {
  $('bedtime').value = prefs.bedtime || '';
  $('nightTint').checked = prefs.nightTint !== false;
  $('nightNow').textContent = prefs.nightMode ? 'Turn night mode off' : 'Night mode now';
}
window.renderBedtime = renderBedtime;
$('bedtime').addEventListener('change', (e) => B.setPrefs({ bedtime: e.target.value }));
$('nightTint').addEventListener('change', (e) => B.setPrefs({ nightTint: e.target.checked }));
$('nightNow').addEventListener('click', () => B.fun.night(!UI.theme?.prefs.nightMode));
B.theme.onChange((p) => { if (p?.prefs) renderBedtime(p.prefs); });

(window.__loaded = window.__loaded || []).push('fun-ui');
