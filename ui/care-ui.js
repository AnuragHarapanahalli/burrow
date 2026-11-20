// Mochi, helpful: the 20-second eye break, tab tidy-up, "remind me about this tab", risky downloads.
// Names start with "cr" so they can't clash with the other interface scripts.

// =============== Eye break: look far away for 20 seconds ===============
let crEyeTimer = 0;
B.care.onEye(({ seconds = 20 } = {}) => {
  if (!mochiSay('Look at something far away for 20 seconds', { pose: 'idle', essential: true, ms: (seconds + 3) * 1000 })) return;
  UI.eyeBreak = { left: seconds, done: false }; // (the self-test reads this)
  clearInterval(crEyeTimer);
  const bubble = $('stripBubble');
  crEyeTimer = setInterval(() => {
    const st = UI.eyeBreak;
    st.left -= 1;
    if (st.left > 0) { bubble.textContent = `Look far away… ${st.left}`; return; }
    clearInterval(crEyeTimer);
    st.done = true;
    bubble.textContent = 'Nice. Your eyes thank you.';
    $('stripSprite').innerHTML = window.Mochi.svg(UI.theme.tokens, 'happy', 30);
    B.care.eyeDone();
  }, 1000);
});

// =============== Tab tidy-up ===============
const crTidy = $('tidyPop');
FLOATERS.tidyPop = crTidy;
UI.tidyOffer = null;
B.care.onTidy((offer) => {
  UI.tidyOffer = offer;
  mochiSay(offer.text, { pose: 'idle', essential: true, ms: 12000, opens: 'tidy' });
});
function openTidy(offer = UI.tidyOffer) {
  if (!offer) return;
  UI.tidyOffer = offer;
  $('tidyTitle').textContent = offer.kind === 'dupes' ? 'DUPLICATE TABS' : 'FORGOTTEN TABS';
  $('tidyList').innerHTML = offer.tabs.map((t) => `<label class="tidy-row"><input type="checkbox" checked data-tab="${t.id}">
    <span><b>${esc(t.title)}</b><small>${esc(t.url)}</small></span></label>`).join('');
  crTidy.style.right = '12px';
  crTidy.style.top = '52px';
  showOverlay('tidyPop');
  $('tidyClose').focus();
}
window.openTidy = openTidy;
B.care.onTidyOpen((offer) => openTidy(offer));
$('tidyClose').onclick = () => {
  const ids = [...crTidy.querySelectorAll('[data-tab]:checked')].map((c) => Number(c.dataset.tab));
  hideOverlay();
  if (!ids.length) return;
  B.care.closeTabs(ids); // (a toast says how many closed, with Undo)
};
$('tidyLater').onclick = () => hideOverlay();
async function crTidyNow() {
  const offer = await B.care.tidy();
  if (offer) openTidy(offer);
  else mochiSay('All tidy! No duplicates or forgotten tabs.', { pose: 'happy', essential: true });
}
window.crTidyNow = crTidyNow;

// =============== Remind me about this tab ===============
UI.reminders = [];
B.care.reminders().then((list) => { UI.reminders = list || []; });
B.care.onReminders((list) => { UI.reminders = list || []; });
const crAt = (h, m = 0, addDays = 0) => { const d = new Date(); d.setDate(d.getDate() + addDays); d.setHours(h, m, 0, 0); return d.getTime(); };
const crClock = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
// The choices in the tab menu's "Remind me" submenu.
function crRemindItems() {
  const evening = new Date().getHours() < 17;
  return [
    { id: 'remind:1h', label: 'In 1 hour' },
    { id: evening ? 'remind:evening' : 'remind:tomorrow-evening', label: evening ? 'This evening (18:00)' : 'Tomorrow evening (18:00)' },
    { id: 'remind:morning', label: 'Tomorrow morning (09:00)' },
    { sep: true },
    { id: 'remind:pick', label: 'Pick a time…' },
  ];
}
window.crRemindItems = crRemindItems;
async function crRemind(tabId, kind, x, y) {
  const at = { '1h': Date.now() + 3600e3, evening: crAt(18), 'tomorrow-evening': crAt(18, 0, 1), morning: crAt(9, 0, 1) }[kind];
  if (kind === 'pick') { crPickTime(tabId, x, y); return; }
  const r = await B.care.remind(tabId, at);
  if (r) mochiSay(`I'll bring it back ${new Date(at).toDateString() === new Date().toDateString() ? 'at' : 'tomorrow at'} ${crClock(at)}`, { pose: 'wave', essential: true });
}
window.crRemind = crRemind;
const crPick = $('remindPop');
FLOATERS.remindPop = crPick;
let crPickTab = null;
function crPickTime(tabId, x = 200, y = 60) {
  crPickTab = tabId;
  const d = new Date(Date.now() + 2 * 3600e3);
  d.setMinutes(0, 0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  $('remindAt').value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  $('remindErr').hidden = true;
  showOverlay('remindPop');
  crPick.style.left = Math.max(8, Math.min(window.innerWidth - crPick.offsetWidth - 8, x)) + 'px';
  crPick.style.top = Math.max(8, y) + 'px';
  $('remindAt').focus();
}
$('remindForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const at = new Date($('remindAt').value).getTime();
  const r = await B.care.remind(crPickTab, at);
  if (!r) { $('remindErr').hidden = false; return; }
  hideOverlay();
  mochiSay(`I'll bring it back on ${new Date(at).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} at ${crClock(at)}`, { pose: 'wave', essential: true });
});
$('remindCancel').onclick = () => hideOverlay();

// =============== Risky downloads ===============
B.downloads.onRisky((d) => {
  toast(`${d.filename} is a program. Keep it only if you trust where it came from`, { kind: 'warning', action: 'Review', ms: 12000, onAction: () => openPanel('downloads') });
});

(window.__loaded = window.__loaded || []).push('care-ui');
