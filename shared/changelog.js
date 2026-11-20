// What changed in each version — shown in the "What's new" popup the first time Burrow opens after an
// update (newest first). Add an entry here before each release (npm version patch → git push --follow-tags).
//   thanks: testers to credit in that version's popup, e.g. { name: 'Priya', for: 'found the fullscreen bug' }
(function (root) {
  const CHANGES = [
    {
      version: '0.3.1',
      title: 'Google sign-in, a new approach',
      new: [
        'If Google says “Couldn’t sign you in”, Burrow offers another way to sign in, right there. You can also pick one in Ctrl+K → “Google sign-in method”.',
      ],
      fixed: [
        'Google sign-in: Burrow no longer pretends to be Firefox (Google could tell, and refused). It now looks like Chrome, with the small built-in pieces real Chrome has.',
      ],
      thanks: [],
    },
    {
      version: '0.3.0',
      title: 'A calmer look',
      choose: 'look', // the popup shows a Soft paper / Classic picker
      new: [
        '“Soft paper”: warm greys, hairlines, rounded corners and softer colours, in light and dark. Prefer the old look? Pick Classic above or in Settings → Look.',
        'Compact density for small screens (Settings → Look).',
        'Closing tabs shows “Tab closed · Undo” instead of asking first; tidy-up and “close others” can be undone too.',
        'The address bar shows the site clearly: a lock for secure sites, “Not secure” for others, the domain in full ink.',
        'A thin loading bar under the toolbar; hover a tab to see its full title, site and what it’s doing.',
        'Downloads, updates and warnings appear as small messages at the bottom left, whatever Mochi’s mood setting.',
      ],
      fixed: [],
      thanks: [],
    },
    {
      version: '0.2.2',
      title: 'Full screen, fixed',
      new: [
        'F11 full screen, like Chrome: the page fills the screen; touch the top edge for a ✕ to exit.',
        'Settings has its own button in the toolbar, next to the menu (and Ctrl+,).',
        "Your mouse's side buttons go back and forward; Alt+Home opens a new tab page.",
        "This “What's new” note after every update.",
      ],
      fixed: [
        'Videos (YouTube, Netflix…) now really go full screen.',
      ],
      thanks: [{ name: 'Harshad' }, { name: 'Aaryan' }],
    },
    {
      version: '0.2.1',
      title: 'Google sign-in works',
      new: [],
      fixed: [
        "Signing in to Google no longer says “This browser or app may not be secure”.",
        'New versions are published more reliably.',
      ],
      thanks: [],
    },
    {
      version: '0.2.0',
      title: 'The first release',
      new: [
        'Right-click menus everywhere, and tabs you can drag between windows.',
        'Bring your bookmarks and history from Chrome, Edge, Firefox and more.',
        'Mochi helps: eye breaks, tab tidy-up, "remind me about this tab", safety warnings.',
        'Mochi Hop, carrots and outfits, reading time, and a bedtime wind-down.',
        'A weekly report, site permissions, clear browsing data, and automatic updates.',
      ],
      fixed: [],
      thanks: [],
    },
  ];

  // Versions compared as numbers: '0.10.0' is newer than '0.9.3'.
  function newer(a, b) {
    const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
    for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
    return false;
  }
  // Everything after `from`, up to and including `to` (newest first).
  function between(from, to) {
    return CHANGES.filter((c) => newer(c.version, from) && !newer(c.version, to));
  }

  const api = { CHANGES, newer, between };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BurrowChangelog = api;
})(typeof window !== 'undefined' ? window : globalThis);
