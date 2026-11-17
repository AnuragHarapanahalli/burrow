// Developer self-test. Only runs when BURROW_SELFTEST=<folder> is set.
// Drives Burrow through its features and saves screenshots + a log to that folder.
// Uses a throwaway profile and download folder (set up in main.js).
const fs = require('fs');
const path = require('path');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function run({ app, ui, tabs, library, downloads, setTheme, setPrefs, store, dir, mainWin, openWindow, windows, session }) {
  fs.mkdirSync(dir, { recursive: true });
  const log = [];
  let failures = 0;
  const note = (s) => { log.push(s); console.log('[selftest]', s); };
  const check = (ok, what) => { if (!ok) failures++; note(`${ok ? 'PASS' : 'FAIL'} ${what}`); };
  const js = async (code) => {
    const body = code.includes(';') ? `(() => { ${code} })()` : `(${code})`;
    const r = await ui.webContents.executeJavaScript(`(() => { try { return { v: ${body} }; } catch (e) { return { e: e.message }; } })()`);
    if (r.e) throw new Error(`UI script "${code.slice(0, 60)}" threw: ${r.e}`);
    return r.v;
  };

  async function capture(wc, file) {
    wc.invalidate(); // background windows paint lazily; force a fresh frame
    await wait(250);
    for (let i = 0; i < 5; i++) {
      try { fs.writeFileSync(file, (await wc.capturePage()).toPNG()); return; } catch { await wait(700); }
    }
    note(`could not capture ${path.basename(file)}`);
  }
  const shot = async (name, page = false) => {
    await capture(ui.webContents, path.join(dir, `${name}-ui.png`));
    if (page && tabs.active) await capture(tabs.active.view.webContents, path.join(dir, `${name}-page.png`));
  };

  try {
    await wait(2500);
    setTheme({ mode: 'light', seed: '#E63027' });
    const loaded = await js('window.__loaded || []');
    check(['ui', 'overlay', 'panel', 'bmbar', 'find', 'drag'].every((n) => loaded.includes(n)), `all interface scripts loaded (${loaded.join(', ')})`);

    // --- Search engine chooser on the new tab ---
    const page = tabs.active.view.webContents;
    const pjs = (code) => page.executeJavaScript(code);
    check(store.get('searchEngine') === 'google', 'default search engine is Google until you choose');
    check(await pjs("!document.getElementById('chooser').hidden"), 'new tab asks you to pick a search engine');
    check(await pjs("document.querySelectorAll('#engineGrid button').length") === 6, 'six search engines offered');
    await shot('00-chooser', true);
    await pjs("document.querySelector('[data-engine=duckduckgo]').click()");
    await wait(700);
    check(store.get('searchEngine') === 'duckduckgo' && store.get('searchChosen'), 'picking an engine saves it');
    check(await pjs("document.getElementById('q').placeholder").then((p) => p.includes('DuckDuckGo')), 'search box names the chosen engine');
    check(!(await js("document.getElementById('dlBtn').hidden")) === false, 'downloads button hidden until you download something');

    // --- Editable quick links ---
    check(await pjs("document.querySelectorAll('#links a').length") === 4, 'four default quick links');
    check(await pjs("document.getElementById('version').textContent") === 'v' + app.getVersion(), `footer shows the version (v${app.getVersion()})`);
    check((await pjs("document.querySelector('.made').textContent")).includes('Anurag'), 'footer says Made with love by Anurag');
    await pjs("document.getElementById('linksEdit').click()");
    await wait(200);
    check(await pjs("document.querySelectorAll('#links .ql').length") === 4, 'Edit shows editable links');
    await pjs("document.querySelector('[data-edit=\"0\"]').click(); document.getElementById('lfName').value='Gmail'; document.getElementById('lfUrl').value='mail.google.com'; document.getElementById('linkForm').requestSubmit()");
    await wait(400);
    check(store.get('quickLinks')[0].name === 'Gmail', 'renaming a link saves it');
    await pjs("document.querySelector('[data-add]').click(); document.getElementById('lfName').value=''; document.getElementById('lfUrl').value='not a url'; document.getElementById('linkForm').requestSubmit()");
    await wait(200);
    check((await pjs("document.getElementById('lfError').textContent")).length > 0, 'a bad address shows an error');
    await pjs("document.getElementById('lfName').value='Moodle'; document.getElementById('lfUrl').value='moodle.org'; document.getElementById('linkForm').requestSubmit()");
    await wait(400);
    check(store.get('quickLinks').length === 5 && store.get('quickLinks')[4].url === 'https://moodle.org/', 'adding a link saves it');
    await shot('00b-links-edit', true);
    await pjs("document.querySelector('[data-rm=\"1\"]').click()");
    await wait(600);
    check(store.get('quickLinks').length === 4 && !store.get('quickLinks').some((l) => l.name === 'Drive'), 'removing a link saves it');
    await pjs("window.burrowPage.setQuickLinks([{ name: 'evil', url: 'javascript:alert(1)' }, { name: 'ok', url: 'https://ok.example/' }])");
    await wait(400);
    check(store.get('quickLinks').length === 1 && store.get('quickLinks')[0].name === 'ok', 'non-web links (javascript:) are refused');
    await pjs("document.getElementById('linksEdit').click()");

    // --- Browsing + history + bookmarks ---
    tabs.navigate('example.com');
    await wait(4000);
    check(library.searchHistory('example').length > 0, 'visit is recorded in history');
    await js("document.getElementById('star').click()");
    await wait(500);
    check(library.isBookmarked('https://example.com/'), 'star button bookmarks the page');
    check(await js("document.getElementById('star').getAttribute('aria-pressed')") === 'true', 'star shows as filled');

    // --- Address suggestions ---
    tabs.create();
    await wait(60);
    check(await js("!!document.querySelector('.tab.opening')"), 'new tab slides open');
    await wait(1200);
    await js("const a=document.getElementById('address'); a.focus(); a.value='examp'; a.dispatchEvent(new Event('input'))");
    await wait(800);
    const rows = await js("document.querySelectorAll('#suggest .sg').length");
    check(rows >= 2, `address suggestions appear (${rows} rows)`);
    await shot('01-suggest');
    await js("document.getElementById('address').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
    await wait(300);
    check(await js("document.getElementById('overlay').hidden"), 'Escape closes suggestions');
    await js("const a=document.getElementById('address'); a.focus(); a.value='examp'; a.dispatchEvent(new Event('input'))");
    await wait(600);
    await js("openPanel('bookmarks')");
    await wait(300);
    check(await js("document.getElementById('overlay').hidden"), 'opening a panel closes suggestions');
    await js("closePanel()");

    // --- Library panel ---
    // --- Main menu ---
    await js("document.getElementById('menuBtn').click()");
    await wait(300);
    check(await js("document.querySelectorAll('#mainMenu .mm-row').length") >= 8, 'menu opens with its items');
    await shot('01b-menu');
    await js("document.querySelector('#mainMenu [data-cmd=bookmarks]').click()");
    await wait(700);
    check(await js("document.querySelectorAll('#bmList .item').length") === 1, 'bookmarks panel lists the bookmark');
    await shot('02-bookmarks');
    await js("openPanel('history')");
    await wait(700);
    check(await js("document.querySelectorAll('#histList .item').length") >= 1, 'history panel lists visits');
    await shot('03-history');

    // --- Downloads ---
    tabs.active.view.webContents.downloadURL('https://example.com/');
    await wait(5000);
    const done = downloads.state().find((d) => d.state === 'completed');
    check(!!done, `download completes (${done ? done.filename : 'none'})`);
    await js("openPanel('downloads')");
    await wait(500);
    await shot('04-downloads');
    check(!(await js("document.getElementById('dlBtn').hidden")), 'downloads button appears after a download');
    await js("openPanel('settings')");
    await wait(500);
    check(await js("document.querySelectorAll('#engines .engine').length") === 6, 'settings lists search engines');
    check(await js("document.querySelectorAll('#panel details.sect').length") === 5, 'settings has five dropdown sections');
    check(await js("document.getElementById('sumEngine').textContent") === 'DuckDuckGo', 'closed dropdown shows the current engine');
    await js("document.querySelector('#panel details.sect').open = true");
    await wait(400);
    await shot('04b-settings');
    await js("document.getElementById('panelClose').click()");

    // --- Bookmarks bar ---
    check(await js("!document.getElementById('bmbar').hidden"), 'bookmarks bar is shown by default');
    check(await js("document.querySelectorAll('#bmItems .bm').length") === 1, 'bookmarks bar shows the bookmark');
    setPrefs({ bookmarksBar: false });
    await wait(300);
    check(await js("document.getElementById('bmbar').hidden"), 'bookmarks bar can be hidden');
    setPrefs({ bookmarksBar: true });
    await wait(300);

    // --- Workspaces ---
    await js("document.getElementById('wsBtn').click()");
    await wait(500);
    await shot('05-ws-menu');
    await js("document.getElementById('backdrop').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))");
    const homeTabs = tabs.visible.length;
    tabs.createWorkspace('College');
    await wait(800);
    check(tabs.visible.length === 1 && tabs.workspaces.length === 2, 'new workspace starts with one tab');
    // Quick link only for this workspace
    await wait(1200);
    const cpage = tabs.active.view.webContents;
    const cjs = (code) => cpage.executeJavaScript(code);
    await cjs("document.getElementById('linksEdit').click(); document.querySelector('[data-add]').click()");
    await wait(200);
    check((await cjs("document.getElementById('scopeWs').textContent")) === 'Only College', 'link form offers "Only College"');
    await cjs("document.querySelector('[data-scope=ws]').click(); document.getElementById('lfName').value='Lectures'; document.getElementById('lfUrl').value='lectures.example.edu'; document.getElementById('linkForm').requestSubmit()");
    await wait(500);
    const collegeId = tabs.currentWs;
    const lect = store.get('quickLinks').find((l) => l.name === 'Lectures');
    check(lect && lect.ws === collegeId, 'link is saved for College only');
    if (!lect || lect.ws !== collegeId) note('debug: ' + JSON.stringify(store.get('quickLinks')) + ' ws=' + collegeId + ' err=' + await cjs("document.getElementById('lfError').textContent"));
    await shot('05b-ws-link', true);
    await cjs("document.getElementById('linksEdit').click()");
    // A new tab in Home must not show it.
    tabs.switchWorkspaceIndex(0);
    const homeNew = tabs.create();
    await wait(1500);
    check((await homeNew.view.webContents.executeJavaScript("document.getElementById('links').textContent")).includes('Lectures') === false, 'Home new tab does not show the College-only link');
    tabs.close(homeNew.id);
    tabs.switchWorkspace(collegeId);
    await wait(300);
    check(await js("document.getElementById('wsName').textContent") === 'COLLEGE', 'strip shows the workspace name');
    tabs.switchWorkspaceIndex(0);
    await wait(500);
    check(tabs.visible.length === homeTabs, 'switching back restores Home tabs');

    // --- Reopen closed tab ---
    const before = tabs.visible.length;
    const web = tabs.visible.find((t) => t.url.startsWith('https://'));
    tabs.close(web.id);
    await wait(40);
    check(await js("!!document.querySelector('.closing')"), 'closed tab shrinks away');
    await wait(300);
    check(tabs.visible.length === before - 1, 'closing a tab removes it');
    await wait(300);
    tabs.reopenClosed();
    await wait(800);
    check(tabs.visible.length === before, 'Ctrl+Shift+T reopens the closed tab');

    // ================= Phase 3 =================
    // --- Find in page ---
    const ex = tabs.create('https://example.com/');
    await wait(4000);
    mainWin.send('find-open');
    await wait(300);
    check(await js("!document.getElementById('findbar').hidden"), 'Ctrl+F opens the find bar');
    await js("const f=document.getElementById('findInput'); f.value='domain'; f.dispatchEvent(new Event('input'))");
    await wait(900);
    const c1 = await js("document.getElementById('findCount').textContent");
    check(/^1\/[2-9]/.test(c1), `find counts matches (${c1})`);
    await js("document.getElementById('findNext').click()");
    await wait(600);
    const c2 = await js("document.getElementById('findCount').textContent");
    check(c2.startsWith('2/'), `next match moves on (${c2})`);
    await shot('07-find', true);
    await js("document.getElementById('findClose').click()");
    await wait(200);
    check(await js("document.getElementById('findbar').hidden"), 'find bar closes');

    // --- Zoom, remembered per site ---
    tabs.stepZoom(1);
    await wait(400);
    check(Math.abs(ex.view.webContents.getZoomFactor() - 1.1) < 0.01, 'Ctrl+= zooms to 110%');
    check(await js("document.getElementById('zoomBtn').textContent") === '110%', 'address bar shows 110%');
    check((store.get('zoom') || {})['example.com'] === 1.1, 'zoom is remembered for example.com');
    const ex2 = tabs.create('https://example.com/');
    await wait(3500);
    check(Math.abs(ex2.view.webContents.getZoomFactor() - 1.1) < 0.01, 'another example.com tab opens at 110%');
    tabs.stepZoom(0);
    await wait(300);
    check(!(store.get('zoom') || {})['example.com'] && await js("document.getElementById('zoomBtn').hidden"), 'Ctrl+0 resets and forgets the zoom');
    tabs.close(ex2.id);

    // --- Picture-in-picture + tab sound ---
    const media = 'data:text/html,' + encodeURIComponent(`<body style="margin:0;background:#222"><video id=v muted autoplay playsinline width=480 height=270></video><script>
      const c=document.createElement('canvas');c.width=320;c.height=180;const x=c.getContext('2d');let n=0;
      setInterval(()=>{x.fillStyle='hsl('+(n++*20%360)+',70%,50%)';x.fillRect(0,0,320,180)},100);
      v.srcObject=c.captureStream(10);v.play();
      const a=new AudioContext();const o=a.createOscillator();const g=a.createGain();g.gain.value=0.02;o.connect(g).connect(a.destination);o.start();
    </script></body>`);
    const mt = tabs.create(media);
    await wait(3000);
    const ms = tabs.state().tabs.find((t) => t.id === mt.id);
    check(ms.media, 'playing video shows the picture-in-picture button');
    check(ms.audible, 'tab playing sound shows a speaker');
    const pipResult = await mainWin.pip();
    await wait(800);
    check(pipResult === 'ok' && await mt.view.webContents.executeJavaScript('!!document.pictureInPictureElement'), `picture-in-picture pops the video out (${pipResult})`);
    await shot('08-media', true);
    await mainWin.pip(); // bring it back
    tabs.toggleMute(mt.id);
    await wait(300);
    check(tabs.state().tabs.find((t) => t.id === mt.id).muted, 'clicking the speaker mutes the tab');
    tabs.close(mt.id);

    // --- Private window ---
    const histBefore = library.history.length;
    const pw = openWindow({ isPrivate: true });
    await wait(2500);
    check(windows.size === 2 && pw.tabs.visible.length === 1, 'Ctrl+Shift+N opens a private window');
    const pPage = pw.tabs.active.view.webContents;
    check((await pPage.executeJavaScript("document.querySelector('h1').textContent")).includes('privately'), 'private new tab says "Browsing privately"');
    check(pPage.session !== session.defaultSession, 'private window uses its own session');
    await shot('09-private-page-from-main'); // main window unaffected
    await capture(pw.ui.webContents, path.join(dir, '09-private-ui.png'));
    await capture(pPage, path.join(dir, '09-private-page.png'));
    pw.tabs.navigate('https://example.com/');
    await wait(3500);
    check(library.history.length === histBefore, 'private browsing adds nothing to history');
    await pPage.session.cookies.set({ url: 'https://example.com/', name: 'burrow_private_test', value: '1' });
    const leaked = await session.defaultSession.cookies.get({ name: 'burrow_private_test' });
    check(leaked.length === 0, "private cookies don't leak into normal browsing");
    pw.win.close();
    await wait(800);
    check(windows.size === 1, 'closing the private window leaves the main window open');

    // ================= Windows + dragging tabs =================
    // Real mouse input, the same path your mouse takes.
    const mouse = async (wc, type, x, y) => {
      const held = type !== 'mouseUp' ? ['leftButtonDown'] : [];
      wc.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, modifiers: held });
      await wait(30);
    };
    const dragMouse = async (wc, from, to, steps = 12) => {
      await mouse(wc, 'mouseDown', from.x, from.y);
      for (let i = 1; i <= steps; i++) await mouse(wc, 'mouseMove', from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps);
      await mouse(wc, 'mouseUp', to.x, to.y);
      await wait(600);
    };
    const tabCenters = () => js("[...document.querySelectorAll('#tabs .tab:not(.closing)')].map((t) => [t, t.getBoundingClientRect()]).map(([t, r]) => ({ id: +t.dataset.id, x: r.left + r.width / 2, y: r.top + r.height / 2 }))");

    // --- Ctrl+N opens a new normal window ---
    ui.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'N', modifiers: ['control'] });
    await wait(2000);
    const normals = () => [...windows].filter((w) => !w.isPrivate);
    check(normals().length === 2, 'Ctrl+N opens a new window');
    const w2 = normals().find((w) => w !== mainWin);
    check(w2 && w2.tabs.visible.length === 1 && w2.tabs.active.url.startsWith('burrow://newtab'), 'new window starts with a new tab');
    check((store.get('session').windows || []).length === 2, 'both windows are saved for next time');

    // --- Drag to reorder ---
    while (tabs.visible.length < 4) tabs.create(undefined, { activate: false });
    await wait(800);
    let cs = await tabCenters();
    const draggedId = cs[0].id;
    mainWin.win.focus();
    await wait(300);
    await dragMouse(ui.webContents, cs[0], { x: cs[2].x + 20, y: cs[2].y });
    check(tabs.visible.findIndex((t) => t.id === draggedId) === 2, 'dragging the first tab past two others moves it to third');
    cs = await tabCenters();
    check(cs[2].id === draggedId, 'tab strip shows the new order');

    // --- Drag a tab out into its own window (page keeps running) ---
    cs = await tabCenters();
    const pulled = tabs.get(cs[1].id);
    const pulledWc = pulled.view.webContents;
    const winsBefore = normals().length;
    await dragMouse(ui.webContents, cs[1], { x: cs[1].x + 60, y: cs[1].y + 220 }, 16);
    await wait(1500);
    const w3 = normals().find((w) => w !== mainWin && w !== w2);
    check(normals().length === winsBefore + 1 && w3, 'pulling a tab down opens it in a new window');
    check(w3 && w3.tabs.tabs.length === 1 && w3.tabs.tabs[0].view.webContents === pulledWc, 'the same live page moved (nothing reloaded)');
    check(!tabs.get(pulled.id), 'the tab left the original window');
    if (w3) await capture(w3.ui.webContents, path.join(dir, '10-torn-off-ui.png'));

    // --- Drop a tab onto another window: it moves there ---
    if (w3) {
      const t = w3.tabs.tabs[0];
      w3.tabs.create(); // the window keeps one tab after giving this one away
      await wait(500);
      const moved = w3.tabs.detach(t.id);
      mainWin.tabs.adopt(moved);
      await wait(500);
      check(mainWin.tabs.get(t.id) && t.owner === mainWin.tabs, 'a tab dropped on another window joins it');
      w3.win.close();
    }
    w2.win.close();
    await wait(800);
    check(normals().length === 1 && (store.get('session').windows || []).length === 1, 'closing extra windows forgets their tabs (like Chrome)');

    // --- Sidebar beyond 8 tabs ---
    for (let i = 0; i < 8; i++) tabs.create(undefined, { activate: i === 7 });
    await wait(1500);
    check(await js("!document.getElementById('sidebar').hidden"), `sidebar appears with ${tabs.visible.length} tabs`);
    setTheme({ mode: 'dark', seed: '#6E9A4A' });
    await wait(600);
    await shot('06-sidebar-dark', true);
  } catch (err) {
    failures++;
    note('ERROR ' + (err && err.stack || err));
  }
  note(failures ? `${failures} problem(s)` : 'ALL PASSED');
  fs.writeFileSync(path.join(dir, 'log.txt'), log.join('\n'));
  app.quit();
}

module.exports = { run };
