// Per-tab volume. Electron only offers mute, so Burrow sets the volume of the page's video/audio
// elements (YouTube, Netflix, Spotify Web, Twitch…). It runs in an isolated world the page can't touch.
// Above 100% the sound goes through Web Audio — only for media the page allows (same-origin or CORS);
// anything else stays at 100% instead of going silent.
const WORLD = 1002;

function script(volume) {
  return `(() => {
  const S = window.__burrowVol || (window.__burrowVol = { v: 1, ctx: null, gains: new WeakMap(), watching: false });
  S.v = ${Number(volume) / 100};
  const media = () => [...document.querySelectorAll('video, audio')];
  const canBoost = (el) => {
    try {
      const src = el.currentSrc || el.src || '';
      if (!src || src.startsWith('blob:') || src.startsWith('data:')) return true;
      return new URL(src, location.href).origin === location.origin || el.crossOrigin !== null;
    } catch { return false; }
  };
  const apply = (el) => {
    const g = S.gains.get(el);
    if (S.v <= 1 || !canBoost(el)) {
      el.volume = Math.min(1, S.v);
      if (g) g.gain.value = 1;
      return;
    }
    el.volume = 1;
    try {
      let gain = g;
      if (!gain) {
        S.ctx = S.ctx || new AudioContext();
        const src = S.ctx.createMediaElementSource(el);
        gain = S.ctx.createGain();
        src.connect(gain).connect(S.ctx.destination);
        S.gains.set(el, gain);
      }
      if (S.ctx.state === 'suspended') S.ctx.resume();
      gain.gain.value = S.v;
    } catch (e) { el.volume = 1; }
  };
  media().forEach(apply);
  if (!S.watching) {
    S.watching = true;
    new MutationObserver(() => media().forEach(apply)).observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('play', (e) => { if (e.target instanceof HTMLMediaElement) apply(e.target); }, true);
  }
  const list = media();
  return { media: list.length, boostOk: list.length ? list.some(canBoost) : true };
})()`;
}

async function apply(wc, volume) {
  try {
    const res = await wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code: script(volume) }]);
    return (Array.isArray(res) ? res[0] : res) || { media: 0, boostOk: true };
  } catch { return { media: 0, boostOk: true }; }
}

module.exports = { apply };
