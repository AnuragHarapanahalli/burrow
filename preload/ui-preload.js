// Bridge for Burrow's own interface (tab strip, toolbar, panels).
// Exposes a small, fixed API as window.burrow. No Node.js access leaks to the page.
const { contextBridge, ipcRenderer } = require('electron');

const send = (ch) => (...args) => ipcRenderer.send(ch, ...args);
const listen = (channel) => (cb) => {
  const fn = (_e, data) => cb(data);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};

contextBridge.exposeInMainWorld('burrow', {
  ready: send('ui:ready'),
  setLayout: (top, right, left) => ipcRenderer.send('ui:layout', { top, right, left }),
  setOverlay: (open) => ipcRenderer.send('ui:overlay', !!open),
  setPrefs: send('prefs:set'),
  openPrivate: send('window:private'),
  openWindow: send('window:new'),
  zoom: send('zoom:step'),
  find: {
    query: send('find:query'),
    stop: send('find:stop'),
    onResult: listen('find-result'),
    onOpen: listen('find-open'),
    onStep: listen('find-step'),
  },
  onBookmarks: listen('bookmarks'),
  tabs: {
    create: send('tab:new'),
    close: send('tab:close'),
    activate: send('tab:activate'),
    navigate: send('tab:navigate'),
    reopen: send('tab:reopen'),
    mute: send('tab:mute'),
    move: send('tab:move'),
    detach: send('tab:detach'),
    pip: () => ipcRenderer.invoke('tab:pip'),
    onChange: listen('tabs'),
  },
  workspaces: {
    create: send('ws:new'),
    rename: send('ws:rename'),
    remove: send('ws:delete'),
    switchTo: send('ws:switch'),
  },
  nav: {
    back: send('nav:back'),
    forward: send('nav:forward'),
    reload: send('nav:reload'),
    stop: send('nav:stop'),
  },
  library: {
    toggleBookmark: send('bookmark:toggle'),
    removeBookmark: send('bookmark:remove'),
    removeHistory: send('history:remove'),
    clearHistory: send('history:clear'),
    open: send('open:url'),
    bookmarks: (q) => ipcRenderer.invoke('lib:bookmarks', q),
    history: (q) => ipcRenderer.invoke('lib:history', q),
    suggest: (q) => ipcRenderer.invoke('lib:suggest', q),
    onChange: listen('library-changed'),
  },
  downloads: {
    open: send('dl:open'),
    show: send('dl:show'),
    cancel: send('dl:cancel'),
    pause: send('dl:pause'),
    clear: send('dl:clear'),
    onChange: listen('downloads'),
    onDone: listen('download-done'),
  },
  theme: {
    set: send('theme:set'),
    onChange: listen('theme'),
  },
  onFocusAddress: listen('focus-address'),
  onOpenPanel: listen('open-panel'),
});
