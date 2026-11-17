// Find in page (Ctrl+F): a bar under the toolbar. Enter = next, Shift+Enter = previous, Esc = close.
const findbar = $('findbar');
const findInput = $('findInput');
let matchCase = false;
let lastQuery = '';
let findTimer;

function openFind() {
  const wasHidden = findbar.hidden;
  findbar.hidden = false;
  if (wasHidden) { bump(findbar, 'drop-in'); sendLayout(); }
  findInput.focus();
  findInput.select();
  if (findInput.value) runFind(true);
}
function closeFind() {
  if (findbar.hidden) return;
  findbar.hidden = true;
  B.find.stop();
  lastQuery = '';
  $('findCount').textContent = '';
  sendLayout();
}
window.closeFind = closeFind;

// A new search starts from the top; pressing Enter again moves to the next match.
function runFind(fresh, forward = true) {
  const text = findInput.value;
  const findNext = !fresh && text === lastQuery;
  lastQuery = text;
  B.find.query({ text, forward, findNext, matchCase });
}

findInput.addEventListener('input', () => {
  clearTimeout(findTimer);
  findTimer = setTimeout(() => runFind(true), 120);
});
findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); runFind(false, !e.shiftKey); }
  else if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
});
$('findNext').onclick = () => { runFind(false, true); findInput.focus(); };
$('findPrev').onclick = () => { runFind(false, false); findInput.focus(); };
$('findClose').onclick = closeFind;
$('findCase').onclick = () => {
  matchCase = !matchCase;
  $('findCase').setAttribute('aria-pressed', String(matchCase));
  lastQuery = '';
  runFind(true);
  findInput.focus();
};

B.find.onOpen(openFind);
B.find.onStep((dir) => { if (findbar.hidden) openFind(); else runFind(false, dir > 0); });
B.find.onResult(({ active, matches }) => {
  const count = $('findCount');
  if (!findInput.value) { count.textContent = ''; return; }
  count.textContent = matches ? `${active}/${matches}` : 'NONE';
  findbar.classList.toggle('no-match', !matches);
  if (!matches) bump(findInput, 'shake');
});

// Switching tabs closes the bar (its matches belonged to the old page).
B.tabs.onChange((s) => { if (UI.findTab !== s.activeId) { UI.findTab = s.activeId; closeFind(); } });

(window.__loaded = window.__loaded || []).push('find');
