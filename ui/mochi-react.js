// Mochi's little reactions to what you do. Each one says something only when there's a reason,
// and most only once per session. (Names start with "mr" so they can't clash with other scripts.)
// Settings → Mochi: Lively shows all of these; Quiet and Off show none (they aren't "essential").
const mrSaid = new Set(); // reactions already used this session
const mrOnce = (key, text, pose) => {
  if (mrSaid.has(key)) return;
  if (mochiSay(text, { pose })) mrSaid.add(key);
};

let mrPrev = null;
B.tabs.onChange((s) => {
  const prev = mrPrev;
  mrPrev = {
    activeId: s.activeId,
    bookmarked: !!s.tabs.find((t) => t.id === s.activeId)?.bookmarked,
    workspaces: s.workspaces.length,
    tabs: s.tabs.length,
    split: !!s.split?.shown,
    reader: !!s.tabs.find((t) => t.id === s.activeId)?.inReader,
  };
  if (!prev || s.isPrivate) return;
  const now = mrPrev;

  // You bookmarked the page you're on.
  if (now.activeId === prev.activeId && now.bookmarked && !prev.bookmarked) {
    mochiSay('Saved for later!', { pose: 'happy' });
  }
  // A new workspace appeared.
  if (now.workspaces > prev.workspaces) {
    const name = s.workspaces.find((w) => w.id === s.currentWs)?.name || 'new space';
    mochiSay(`A fresh burrow: ${name}`, { pose: 'celebrate' });
  }
  // Lots of tabs: a one-time tip.
  if (now.tabs >= 20 && prev.tabs < 20) mrOnce('many-tabs', "That's a lot of tabs. Ctrl+K finds any of them", 'wave');
  // First split view / reader view of the session.
  if (now.split && !prev.split) mrOnce('split', 'Two at once! Drag the middle to resize', 'happy');
  if (now.reader && !prev.reader) mrOnce('reader', 'Comfy reading mode', 'happy');
});

// Late at night (1–5 am), once per night.
function mrLateCheck() {
  const h = new Date().getHours();
  if (h >= 1 && h < 5) mrOnce(`late-${new Date().toDateString()}`, "It's late. Your tabs will wait till morning", 'sleepy');
}
setTimeout(mrLateCheck, 20000);
setInterval(mrLateCheck, 15 * 60 * 1000);

(window.__loaded = window.__loaded || []).push('mochi-react');
