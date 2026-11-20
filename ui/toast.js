// The toast view: draws the system messages main/toasts.js sends, and reports its size back so the
// view can be exactly as big as the toasts (the page around them stays clickable).
const T = window.burrowToast;
const stack = document.getElementById('stack');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const shown = new Map(); // id → element (so existing toasts don't re-animate)

// (Measured straight away, not in requestAnimationFrame: a view that is still 0×0 never paints a frame.)
function report() {
  const r = stack.getBoundingClientRect();
  T.size(shown.size ? r.width : 0, shown.size ? r.height : 0);
}
document.fonts?.ready.then(report); // the text may get wider once the font has loaded

T.onToasts((list) => {
  const ids = new Set(list.map((t) => t.id));
  for (const [id, el] of shown) if (!ids.has(id)) { el.remove(); shown.delete(id); }
  for (const t of list) {
    if (shown.has(t.id)) continue;
    const el = document.createElement('div');
    el.className = `toast ${t.kind}`;
    el.dataset.id = t.id;
    el.innerHTML = `<span class="dot" aria-hidden="true"></span><span class="text">${esc(t.text)}</span>`
      + (t.action ? `<button class="act" data-act>${esc(t.action)}</button>` : '')
      + '<button class="x" data-x title="Dismiss" aria-label="Dismiss"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8"/></svg></button>';
    stack.appendChild(el);
    shown.set(t.id, el);
  }
  report();
});

stack.addEventListener('click', (e) => {
  const el = e.target.closest('.toast');
  if (!el) return;
  const id = Number(el.dataset.id);
  if (e.target.closest('[data-act]')) T.act(id);
  else if (e.target.closest('[data-x]')) T.dismiss(id);
});
stack.addEventListener('mouseenter', () => T.hover(true));
stack.addEventListener('mouseleave', () => T.hover(false));
T.onTheme((p) => { if (p?.tokens) { window.BurrowTheme.apply(p.tokens); report(); } });
