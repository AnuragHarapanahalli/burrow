// "Report a bug" form on the new tab. Submitting opens GitHub's New issue page, already
// filled in, in a new tab; the reporter checks it and presses Submit there.
const bugScrim = $('bugScrim');
let bugOpener = null;

function openBugForm() {
  bugOpener = document.activeElement;
  bugScrim.hidden = false;
  $('bugError').textContent = '';
  $('bugTitle').focus();
}
function closeBugForm() {
  bugScrim.hidden = true;
  if (location.hash === '#report-bug') history.replaceState(null, '', location.pathname);
  bugOpener?.focus?.();
}

$('bugBtn').addEventListener('click', openBugForm);
$('bugClose').addEventListener('click', closeBugForm);
$('bugCancel').addEventListener('click', closeBugForm);
bugScrim.addEventListener('mousedown', (e) => { if (e.target === bugScrim) closeBugForm(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !bugScrim.hidden) closeBugForm(); });
$('bugTitle').addEventListener('input', () => { $('bugError').textContent = ''; });

// Keep Tab key focus inside the form while it's open.
bugScrim.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  const items = [...bugScrim.querySelectorAll('input, textarea, button')];
  const first = items[0], last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

$('bugForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const title = $('bugTitle').value.trim();
  if (!title) { $('bugError').textContent = 'Give the bug a short title first.'; $('bugTitle').focus(); return; }
  window.burrowPage.reportBug({
    title, what: $('bugWhat').value, steps: $('bugSteps').value, includeSystem: $('bugSystem').checked,
  });
  $('bugForm').reset();
  closeBugForm();
  pose = 'happy'; drawMochi();
  say('Thanks for helping squash bugs!', 3500);
  setTimeout(() => { pose = 'idle'; drawMochi(); }, 1500);
});

// Opened from the ☰ menu ("Report a bug").
if (location.hash === '#report-bug') openBugForm();
