// Bookmarks bar: your saved pages under the address bar. Ctrl+Shift+B shows/hides it.
// Pages that don't fit go into the » menu.
const bmbar = $('bmbar');
const bmItems = $('bmItems');
let barMarks = [];

// (host() comes from panel.js)
const shortTitle = (b) => (b.title && b.title !== b.url ? b.title : host(b.url));

function bmIcon(b) {
  return /^https?:/i.test(b.favicon || '')
    ? `<img src="${esc(b.favicon)}" alt="">`
    : `<span class="bm-dot pixel" aria-hidden="true">${esc(host(b.url).charAt(0).toUpperCase())}</span>`;
}

function renderBookmarksBar() {
  const show = !!UI.theme?.prefs.bookmarksBar;
  if (bmbar.hidden === show) {
    bmbar.hidden = !show;
    document.body.classList.toggle('bmbar-on', show);
    if (show) bump(bmbar, 'drop-in');
    sendLayout();
  }
  if (!show) return;
  bmItems.innerHTML = barMarks.length
    ? barMarks.map((b, i) => `<button class="bm" data-i="${i}" title="${esc(b.title)}&#10;${esc(b.url)}">${bmIcon(b)}<span>${esc(shortTitle(b))}</span></button>`).join('')
    : '<span class="bm-empty">Press Ctrl+D or the star to keep pages here.</span>';
  fitBar();
}
window.renderBookmarksBar = renderBookmarksBar;

// Hide bookmarks that overflow and offer them in the » menu instead.
function fitBar() {
  const items = [...bmItems.querySelectorAll('.bm')];
  items.forEach((el) => { el.hidden = false; });
  $('bmMore').hidden = true;
  const limit = bmItems.clientWidth;
  let overflow = false;
  for (const el of items) {
    if (el.offsetLeft + el.offsetWidth > limit) { el.hidden = true; overflow = true; }
  }
  $('bmMore').hidden = !overflow;
}
new ResizeObserver(() => { if (!bmbar.hidden) fitBar(); }).observe(bmItems);

function openMark(e, i) {
  const b = barMarks[Number(i)];
  if (b) B.library.open(b.url, e.ctrlKey || e.metaKey || e.button === 1);
}
bmItems.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
bmItems.addEventListener('mouseup', (e) => {
  const el = e.target.closest('[data-i]');
  if (el && (e.button === 0 || e.button === 1)) openMark(e, el.dataset.i);
});

$('bmMore').addEventListener('click', () => {
  if (!bmMenu.hidden) return hideOverlay();
  const hidden = [...bmItems.querySelectorAll('.bm[hidden]')];
  bmMenu.innerHTML = hidden.map((el) => {
    const b = barMarks[Number(el.dataset.i)];
    return `<button class="mm-row" role="menuitem" data-i="${el.dataset.i}"><span class="mm-check">${bmIcon(b)}</span><span>${esc(shortTitle(b))}</span><span></span></button>`;
  }).join('');
  const r = $('bmMore').getBoundingClientRect();
  bmMenu.style.right = (window.innerWidth - r.right) + 'px';
  bmMenu.style.top = (r.bottom + 2) + 'px';
  showOverlay('bm');
  $('bmMore').setAttribute('aria-expanded', 'true');
});
bmMenu.addEventListener('mouseup', (e) => {
  const el = e.target.closest('[data-i]');
  if (!el) return;
  hideOverlay();
  openMark(e, el.dataset.i);
});

B.onBookmarks((list) => { barMarks = list || []; renderBookmarksBar(); });

(window.__loaded = window.__loaded || []).push('bmbar');
