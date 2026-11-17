// Drag tabs: along the strip (or sidebar) to reorder; pull one out to open it in its own window,
// or drop it on another Burrow window's tabs to move it there.
const TEAR = 40;      // how far (px) you pull a tab off the strip before it lifts free
const START = 4;      // movement before a press becomes a drag

let drag = null;

function liveTabs(box) { return [...box.children].filter((el) => el.dataset.id && !el.classList.contains('closing')); }

function onPointerDown(e) {
  if (e.button !== 0 || e.target.closest('[data-close],[data-mute]')) return;
  const el = e.target.closest('[data-id]');
  if (!el || el.classList.contains('closing')) return;
  const box = el.parentElement;
  const side = box.id === 'sideTabs';
  drag = {
    el, box, side, id: Number(el.dataset.id), pointerId: e.pointerId,
    startX: e.clientX, startY: e.clientY, started: false, tearing: false,
    from: 0, to: 0, items: [], boxRect: null,
  };
}

function begin() {
  const d = drag;
  d.started = true;
  d.items = liveTabs(d.box).map((el) => ({ el, rect: el.getBoundingClientRect() }));
  d.from = d.items.findIndex((x) => x.el === d.el);
  d.to = d.from;
  d.size = d.side ? d.items[d.from].rect.height : d.items[d.from].rect.width;
  d.boxRect = d.box.getBoundingClientRect();
  try { d.el.setPointerCapture(d.pointerId); } catch { /* keep dragging without capture */ }
  d.el.classList.add('dragging');
  document.body.classList.add('tab-dragging');
  d.items.forEach((x) => { if (x.el !== d.el) x.el.classList.add('shifting'); });
}

function onPointerMove(e) {
  const d = drag;
  if (!d || e.pointerId !== d.pointerId) return;
  const dx = e.clientX - d.startX;
  const dy = e.clientY - d.startY;
  if (!d.started) {
    if (Math.hypot(dx, dy) < START) return;
    begin();
  }

  // Pulled far enough away from the tabs — up, down, or out of the window sideways? Lift it free
  // (not in private windows). A window's only tab can lift too: drop it on another window.
  const out = (v, lo, hi) => Math.max(lo - v, v - hi, 0);
  const away = d.side
    ? Math.max(out(e.clientX, d.boxRect.left, d.boxRect.right), out(e.clientY, 0, window.innerHeight))
    : Math.max(out(e.clientY, d.boxRect.top, d.boxRect.bottom), out(e.clientX, 0, window.innerWidth));
  const canTear = !UI.state.isPrivate;
  const tearing = canTear && away > TEAR;
  if (tearing !== d.tearing) {
    d.tearing = tearing;
    document.body.classList.toggle('tab-tearing', tearing);
    B.setOverlay(tearing); // lift Burrow's UI above the page so the tab stays visible
    if (tearing) d.items.forEach((x) => { if (x.el !== d.el) x.el.style.transform = ''; });
    else B.tabs.dragHover(null, null);
  }

  if (d.tearing) {
    d.el.style.transform = `translate(${dx}px, ${dy}px) rotate(-2deg)`;
    B.tabs.dragHover(e.screenX, e.screenY); // another window shows where it would land
    const hint = $('tearHint');
    hint.textContent = UI.state.tabs.length > 1 ? 'DROP TO OPEN IN A NEW WINDOW' : 'DROP ON ANOTHER WINDOW';
    hint.hidden = false;
    hint.style.left = e.clientX + 14 + 'px';
    hint.style.top = e.clientY + 14 + 'px';
    return;
  }
  $('tearHint').hidden = true;

  // Reorder: the dragged tab follows the pointer along one axis; the others slide aside.
  const delta = d.side ? dy : dx;
  d.el.style.transform = d.side ? `translateY(${delta}px)` : `translateX(${delta}px)`;
  const r = d.items[d.from].rect;
  const center = (d.side ? r.top + r.height / 2 : r.left + r.width / 2) + delta;
  let to = 0;
  d.items.forEach((x, i) => {
    if (i === d.from) return;
    const c = d.side ? x.rect.top + x.rect.height / 2 : x.rect.left + x.rect.width / 2;
    if (c < center) to++;
  });
  d.to = to;
  d.items.forEach((x, i) => {
    if (i === d.from) return;
    let shift = 0;
    if (d.from < to && i > d.from && i <= to) shift = -d.size;
    if (d.from > to && i < d.from && i >= to) shift = d.size;
    x.el.style.transform = shift ? (d.side ? `translateY(${shift}px)` : `translateX(${shift}px)`) : '';
  });
}

function finish(e, cancelled) {
  const d = drag;
  drag = null;
  if (!d || !d.started) return;
  $('tearHint').hidden = true;
  document.body.classList.remove('tab-dragging', 'tab-tearing');
  // Put elements in their new order right away so nothing jumps back while Burrow catches up.
  if (!cancelled && !d.tearing && d.to !== d.from) {
    const others = d.items.filter((x) => x.el !== d.el).map((x) => x.el);
    d.box.insertBefore(d.el, others[d.to] || null);
  }
  d.items.forEach((x) => { x.el.classList.remove('shifting'); x.el.style.transform = ''; });
  d.el.classList.remove('dragging');
  if (d.tearing) B.tabs.dragHover(null, null);
  if (cancelled) { if (d.tearing) B.setOverlay(false); return; }
  if (d.tearing) {
    B.setOverlay(false);
    B.tabs.detach(d.id, e.screenX, e.screenY);
  } else if (d.to !== d.from) {
    B.tabs.move(d.id, d.to);
  }
}

for (const box of [$('tabs'), $('sideTabs')]) {
  box.addEventListener('pointerdown', onPointerDown);
  box.addEventListener('pointermove', onPointerMove);
  box.addEventListener('pointerup', (e) => finish(e, false));
  box.addEventListener('pointercancel', (e) => finish(e, true));
  box.addEventListener('lostpointercapture', (e) => { if (drag?.started && e.pointerId === drag.pointerId) finish(e, false); });
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && drag?.started) finish(e, true); });

(window.__loaded = window.__loaded || []).push('drag');
