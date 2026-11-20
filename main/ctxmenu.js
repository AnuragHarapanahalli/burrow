// Right-click menus for web pages. The page only tells Burrow *what* was clicked (Electron's
// context-menu params); Burrow builds the menu and runs the chosen action itself, from the params
// it kept — the interface only sends back "item X of menu N", so a page can't fake an action.
const { clipboard } = require('electron');
const { ENGINES, DEFAULT_ENGINE } = require('./url');
const AI = require('../shared/ai');

const web = (u) => /^https?:\/\//i.test(u || '');
const short = (s, n = 26) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};
const SEP = { sep: true };

// Tidy a menu: no separators at the ends or twice in a row.
function tidy(items) {
  const out = [];
  for (const it of items) {
    if (it.sep && (!out.length || out[out.length - 1].sep)) continue;
    out.push(it);
  }
  while (out.length && out[out.length - 1].sep) out.pop();
  return out;
}

/**
 * The menu for what was right-clicked.
 * env: { canBack, canForward, isBurrowPage, isPrivate, engine, aiProvider }
 */
function build(p, env) {
  const items = [];
  const f = p.editFlags || {};
  const engineName = (ENGINES[env.engine] || ENGINES[DEFAULT_ENGINE]).name;
  const aiName = AI.PROVIDERS[env.aiProvider]?.name || 'AI';
  const sel = (p.selectionText || '').trim();

  if (p.linkURL) {
    if (web(p.linkURL)) {
      items.push({ id: 'link-tab', label: 'Open link in new tab' });
      items.push({ id: 'link-window', label: 'Open link in new window' });
      items.push({ id: 'link-private', label: 'Open link in private window' });
      items.push({ id: 'link-split', label: 'Open link in split view' });
      items.push(SEP);
    }
    items.push({ id: 'link-copy', label: 'Copy link address' });
    if (web(p.linkURL) && !env.isPrivate) items.push({ id: 'link-bookmark', label: 'Bookmark link' });
    items.push(SEP);
  }

  if (p.mediaType === 'image' && p.srcURL) {
    if (web(p.srcURL)) items.push({ id: 'img-open', label: 'Open image in new tab' });
    items.push({ id: 'img-save', label: 'Save image as…' });
    items.push({ id: 'img-copy', label: 'Copy image' });
    if (!p.srcURL.startsWith('data:')) items.push({ id: 'img-addr', label: 'Copy image address' });
    items.push(SEP);
  }

  if (p.mediaType === 'video' || p.mediaType === 'audio') {
    const m = p.mediaFlags || {};
    items.push({ id: 'media-play', label: m.isPaused ? 'Play' : 'Pause' });
    if (m.hasAudio !== false) items.push({ id: 'media-mute', label: m.isMuted ? 'Unmute' : 'Mute' });
    if (m.canLoop !== false) items.push({ id: 'media-loop', label: m.isLooping ? 'Stop looping' : 'Loop' });
    if (p.mediaType === 'video') items.push({ id: 'media-pip', label: 'Picture in picture' });
    items.push(SEP);
  }

  if (p.isEditable) {
    if (p.misspelledWord) {
      (p.dictionarySuggestions || []).slice(0, 4).forEach((w, i) => items.push({ id: `spell-${i}`, label: w, strong: true }));
      if (!(p.dictionarySuggestions || []).length) items.push({ id: 'spell-none', label: 'No spelling suggestions', disabled: true });
      items.push({ id: 'spell-add', label: 'Add to dictionary' });
      items.push(SEP);
    }
    items.push({ id: 'undo', label: 'Undo', key: 'CTRL Z', disabled: !f.canUndo });
    items.push({ id: 'redo', label: 'Redo', key: 'CTRL Y', disabled: !f.canRedo });
    items.push(SEP);
    items.push({ id: 'cut', label: 'Cut', key: 'CTRL X', disabled: !f.canCut });
    items.push({ id: 'copy', label: 'Copy', key: 'CTRL C', disabled: !f.canCopy });
    items.push({ id: 'paste', label: 'Paste', key: 'CTRL V', disabled: !f.canPaste });
    items.push({ id: 'paste-plain', label: 'Paste as plain text', key: 'CTRL SHIFT V', disabled: !f.canPaste });
    items.push({ id: 'select-all', label: 'Select all', key: 'CTRL A', disabled: f.canSelectAll === false });
    items.push(SEP);
  } else if (sel) {
    items.push({ id: 'copy', label: 'Copy', key: 'CTRL C' });
    items.push({ id: 'search', label: `Search ${engineName} for “${short(sel)}”` });
    if (!env.isPrivate) items.push({ id: 'ask', label: `Ask ${aiName} about “${short(sel)}”` });
    if (!env.isPrivate && !env.isBurrowPage) items.push({ id: 'note', label: 'Add to notes' });
    items.push(SEP);
  }

  // Plain page: nothing more specific was clicked.
  if (!p.linkURL && !sel && !p.isEditable && (!p.mediaType || p.mediaType === 'none')) {
    items.push({ id: 'back', label: 'Back', key: 'ALT ←', disabled: !env.canBack });
    items.push({ id: 'forward', label: 'Forward', key: 'ALT →', disabled: !env.canForward });
    items.push({ id: 'reload', label: 'Reload', key: 'CTRL R' });
    items.push(SEP);
    items.push({ id: 'select-all', label: 'Select all', key: 'CTRL A' });
    if (!env.isBurrowPage) items.push({ id: 'source', label: 'View page source' });
    items.push(SEP);
  }
  items.push({ id: 'inspect', label: 'Inspect', key: 'F12' });
  return tidy(items);
}

// Media controls run in an isolated world the page can't touch; they find the clicked element.
function mediaScript(p, zoom, action) {
  const x = Math.round(p.x / zoom), y = Math.round(p.y / zoom);
  return `(() => {
    const src = ${JSON.stringify(p.srcURL || '')};
    const all = [...document.querySelectorAll('video, audio')];
    const hit = document.elementFromPoint(${x}, ${y});
    const m = (hit && hit.closest && hit.closest('video, audio')) || all.find((e) => src && e.currentSrc === src) || (all.length === 1 ? all[0] : null);
    if (!m) return false;
    ${action}
    return true;
  })()`;
}

/**
 * Run a menu action. c: { w, tab, wc, p, id, h } where h holds Burrow's helpers:
 * openWindowWith(url), openPrivateWith(url), library, notes, engine, ask(text)
 */
async function run(c) {
  const { w, tab, wc, p, id, h } = c;
  const after = { after: tab.id, ws: tab.ws, activate: false };
  const sel = (p.selectionText || '').trim();
  switch (id) {
    case 'link-tab': if (web(p.linkURL)) w.tabs.create(p.linkURL, after); break;
    case 'link-window': if (web(p.linkURL)) h.openWindowWith(p.linkURL); break;
    case 'link-private': if (web(p.linkURL)) h.openPrivateWith(p.linkURL); break;
    case 'link-split': {
      if (!web(p.linkURL)) break;
      if (w.tabs.activeId !== tab.id) w.tabs.activate(tab.id);
      const t = w.tabs.create(p.linkURL, after);
      w.tabs.splitWith(t.id);
      break;
    }
    case 'link-copy': clipboard.writeText(p.linkURL || ''); break;
    case 'link-bookmark':
      if (web(p.linkURL) && !h.library.isBookmarked(p.linkURL)) h.library.toggleBookmark(p.linkURL, short(p.linkText, 80) || p.linkURL, null);
      break;
    case 'img-open': if (web(p.srcURL)) w.tabs.create(p.srcURL, after); break;
    case 'img-save': if (p.srcURL) wc.downloadURL(p.srcURL); break;
    case 'img-copy': wc.copyImageAt(p.x, p.y); break;
    case 'img-addr': clipboard.writeText(p.srcURL || ''); break;
    case 'media-play': case 'media-mute': case 'media-loop': case 'media-pip': {
      const act = {
        'media-play': 'm.paused ? m.play() : m.pause();',
        'media-mute': 'm.muted = !m.muted;',
        'media-loop': 'm.loop = !m.loop;',
        'media-pip': 'document.pictureInPictureElement === m ? document.exitPictureInPicture() : m.requestPictureInPicture();',
      }[id];
      const frame = p.frame && !p.frame.isDestroyed?.() ? p.frame : null;
      const code = mediaScript(p, wc.getZoomFactor(), act);
      try {
        if (frame && frame !== wc.mainFrame) await frame.executeJavaScript(code, true);
        else await wc.executeJavaScriptInIsolatedWorld(1003, [{ code }], true);
      } catch { /* the page went away */ }
      break;
    }
    case 'spell-add': if (p.misspelledWord) wc.session.addWordToSpellCheckerDictionary(p.misspelledWord); break;
    case 'undo': wc.undo(); break;
    case 'redo': wc.redo(); break;
    case 'cut': wc.cut(); break;
    case 'copy': wc.copy(); break;
    case 'paste': wc.paste(); break;
    case 'paste-plain': wc.pasteAndMatchStyle(); break;
    case 'select-all': wc.selectAll(); break;
    case 'search': if (sel) w.tabs.create((ENGINES[h.engine] || ENGINES[DEFAULT_ENGINE]).url + encodeURIComponent(sel), { after: tab.id, ws: tab.ws }); break;
    case 'ask': if (sel) h.ask(sel); break;
    case 'note': {
      let host = '';
      try { host = new URL(wc.getURL()).host; } catch { /* not a website */ }
      if (!host || !sel) break;
      const prev = h.notes.get(host);
      h.notes.set(host, `${prev ? prev.replace(/\s+$/, '') + '\n\n' : ''}> ${sel.replace(/\n/g, '\n> ')}`);
      w.toasts.show({ text: 'Added to your notes for this site', kind: 'success' });
      break;
    }
    case 'back': if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); break;
    case 'forward': if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); break;
    case 'reload': wc.reload(); break;
    case 'source': if (web(wc.getURL())) w.tabs.create('view-source:' + wc.getURL(), { after: tab.id, ws: tab.ws }); break;
    case 'inspect': wc.inspectElement(p.x, p.y); break;
    default: {
      const m = /^spell-(\d)$/.exec(id);
      if (m && p.dictionarySuggestions?.[m[1]]) wc.replaceMisspelling(p.dictionarySuggestions[m[1]]);
    }
  }
}

module.exports = { build, run };
