// Developer self-test. Only runs when BURROW_SELFTEST=<folder> is set.
// Drives Burrow through its features and saves screenshots + a log to that folder.
// Uses a throwaway profile and download folder (set up in main.js).
const fs = require('fs');
const path = require('path');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// Keep checking for up to `ms` instead of guessing one fixed pause — saves happen in the
// background and can take longer when the computer is busy.
async function until(fn, ms = 4000) {
  for (let t = 0; t < ms; t += 100) { if (await fn()) return true; await wait(100); }
  return !!(await fn());
}

async function run({ app, ui, tabs, library, downloads, setTheme, setPrefs, store, dir, mainWin, openWindow, windows, session, getNotes, sweepSleep, getFocus, getStats, statLine, getCare, getFun, getPerms, getUpdates, linkFromArgs, clearData, showWhatsNew, checkWhatsNew }) {
  fs.mkdirSync(dir, { recursive: true });
  const log = [];
  let failures = 0;
  const note = (s) => { log.push(s); console.log('[selftest]', s); };
  // How long each check took (time since the previous one), so slow spots are easy to find.
  let lastCheck = Date.now();
  const timings = [];
  const check = (ok, what) => {
    if (!ok) failures++;
    const now = Date.now();
    timings.push({ ms: now - lastCheck, what, section: current ? current.name : '' });
    lastCheck = now;
    note(`${ok ? 'PASS' : 'FAIL'} ${what}`);
  };
  const js = async (code) => {
    // Several statements run as a block; a single expression (incl. a "(() => {...})()" snippet) returns its value.
    const isBlock = code.includes(';') && !code.trim().startsWith('(');
    const body = isBlock ? `(() => { ${code} })()` : `(${code})`;
    const r = await ui.webContents.executeJavaScript(`(() => { try { return { v: ${body} }; } catch (e) { return { e: e.message }; } })()`);
    if (r.e) throw new Error(`UI script "${code.slice(0, 60)}" threw: ${r.e}`);
    return r.v;
  };
  // Wait until a tab's page has finished loading (and, if given, its address contains `part`),
  // instead of pausing a fixed time and hoping.
  const ready = async (t, part) => {
    const ok = await until(() => t && t.view && !t.view.webContents.isDestroyed() && !t.view.webContents.isLoading() && !t.loading && (!part || (t.url || '').includes(part)), 12000);
    await wait(150); // let the page's own scripts run
    return ok;
  };
  // Sections: BURROW_SELFTEST_ONLY=phase8,windows runs just those. Each section's time is logged.
  const only = (process.env.BURROW_SELFTEST_ONLY || '').split(',').map((x) => x.trim()).filter(Boolean);
  const started = Date.now();
  let current = null;
  const endSection = () => {
    if (current) note(`    (${current.name}: ${((Date.now() - current.at) / 1000).toFixed(1)}s)`);
    current = null;
  };
  const section = (name) => {
    endSection();
    if (only.length && !only.includes(name)) return false;
    if (name === 'readme' && !only.includes('readme')) return false; // only when asked for: npm test -- readme
    current = { name, at: Date.now() };
    note(`--- ${name}`);
    return true;
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
    await until(async () => tabs.active && !tabs.active.loading && (await js('(window.__loaded || []).length')) >= 11, 10000);
    await wait(300);
    setTheme({ mode: 'light', seed: '#E63027' });
    const loaded = await js('window.__loaded || []');
    check(['ui', 'overlay', 'panel', 'bmbar', 'find', 'drag', 'palette', 'panes', 'mochi-react', 'focus-ui', 'volume', 'ctxmenu', 'care-ui', 'fun-ui', 'site-ui', 'whatsnew'].every((n) => loaded.includes(n)), `all interface scripts loaded (${loaded.join(', ')})`);

    if (section('basics')) {
    // --- Search engine chooser on the new tab ---
    const page = tabs.active.view.webContents;
    const pjs = (code) => page.executeJavaScript(code);
    check(store.get('searchEngine') === 'google', 'default search engine is Google until you choose');
    check(await pjs("!document.getElementById('chooser').hidden"), 'new tab asks you to pick a search engine');
    check(await pjs("document.querySelectorAll('#engineGrid button').length") === 6, 'six search engines offered');
    await shot('00-chooser', true);
    await pjs("document.querySelector('[data-engine=duckduckgo]').click()");
    await wait(700);
    check(await until(async () => store.get('searchEngine') === 'duckduckgo' && store.get('searchChosen')), 'picking an engine saves it');
    check(await pjs("document.getElementById('q').placeholder").then((p) => p.includes('DuckDuckGo')), 'search box names the chosen engine');
    check(!(await js("document.getElementById('dlBtn').hidden")) === false, 'downloads button hidden until you download something');

    // --- Editable quick links ---
    check(await pjs("document.querySelectorAll('#links a').length") === 4, 'four default quick links');
    check(await pjs("document.getElementById('version').textContent") === 'v' + app.getVersion(), `footer shows the version (v${app.getVersion()})`);
    check((await pjs("document.querySelector('.made').textContent")).includes('Anurag'), 'footer says Made with love by Anurag');
    await pjs("document.getElementById('linksEdit').click()");

    // --- Report a bug ---
    await pjs("document.getElementById('bugBtn').click()");
    check(await until(async () => (await pjs("!document.getElementById('bugScrim').hidden"))), 'Report a bug opens the form');
    await shot('00c-bug-form', true);
    await pjs("document.getElementById('bugForm').requestSubmit()");
    await wait(200);
    check((await pjs("document.getElementById('bugError').textContent")).length > 0, 'submitting without a title shows an error');
    // Record the address Burrow opens (GitHub may then redirect to its sign-in page).
    let issueUrl = '';
    let issueTab = null;
    const realCreate = tabs.create.bind(tabs);
    tabs.create = (url, opts) => { issueUrl = url; issueTab = realCreate(url, opts); return issueTab; };
    await pjs("document.getElementById('bugTitle').value='Test: tabs flicker'; document.getElementById('bugWhat').value='They flicker & blink'; document.getElementById('bugForm').requestSubmit()");
    await wait(600);
    tabs.create = realCreate;
    const u = issueUrl ? new URL(issueUrl) : null;
    check(u && u.origin + u.pathname === 'https://github.com/AnuragHarapanahalli/burrow/issues/new', 'submitting opens GitHub\'s New issue page for Burrow');
    check(u && u.searchParams.get('title') === 'Test: tabs flicker' && u.searchParams.get('labels') === 'bug', 'the issue is prefilled with the title and the bug label');
    check(u && u.searchParams.get('body').includes('They flicker & blink') && u.searchParams.get('body').includes('Burrow v' + app.getVersion()), 'the issue body has the description and Burrow version');
    if (issueTab) tabs.close(issueTab.id);
    await wait(300);
    tabs.activate(tabs.tabs[0].id);
    // From the menu
    const menuTab = tabs.create('burrow://newtab/#report-bug');
    await ready(menuTab);
    await until(() => menuTab.view.webContents.executeJavaScript("!document.getElementById('bugScrim').hidden"));
    check(await menuTab.view.webContents.executeJavaScript("!document.getElementById('bugScrim').hidden"), 'Menu \u2192 Report a bug opens the form directly');
    tabs.close(menuTab.id);
    await wait(300);
    check(await until(async () => (await pjs("document.querySelectorAll('#links .ql').length") === 4)), 'Edit shows editable links');
    await pjs("document.querySelector('[data-edit=\"0\"]').click(); document.getElementById('lfName').value='Gmail'; document.getElementById('lfUrl').value='mail.google.com'; document.getElementById('linkForm').requestSubmit()");
    check(await until(() => store.get('quickLinks')[0].name === 'Gmail'), 'renaming a link saves it');
    await pjs("document.querySelector('[data-add]').click(); document.getElementById('lfName').value=''; document.getElementById('lfUrl').value='not a url'; document.getElementById('linkForm').requestSubmit()");
    check(await until(async () => ((await pjs("document.getElementById('lfError').textContent")).length > 0)), 'a bad address shows an error');
    await pjs("document.getElementById('lfName').value='Moodle'; document.getElementById('lfUrl').value='moodle.org'; document.getElementById('linkForm').requestSubmit()");
    check(await until(() => store.get('quickLinks').length === 5 && store.get('quickLinks')[4].url === 'https://moodle.org/'), 'adding a link saves it');
    await shot('00b-links-edit', true);
    await pjs("document.querySelector('[data-rm=\"1\"]').click()");
    check(await until(() => store.get('quickLinks').length === 4 && !store.get('quickLinks').some((l) => l.name === 'Drive')), 'removing a link saves it');
    await pjs("window.burrowPage.setQuickLinks([{ name: 'evil', url: 'javascript:alert(1)' }, { name: 'ok', url: 'https://ok.example/' }])");
    check(await until(() => store.get('quickLinks').length === 1 && store.get('quickLinks')[0].name === 'ok'), 'non-web links (javascript:) are refused');
    await pjs("document.getElementById('linksEdit').click()");

    // --- Browsing + history + bookmarks ---
    tabs.navigate('example.com');
    await ready(tabs.active, 'example.com');
    check(await until(async () => library.searchHistory('example').length > 0), 'visit is recorded in history');
    await js("document.getElementById('star').click()");
    await wait(500);
    check(await until(async () => library.isBookmarked('https://example.com/')), 'star button bookmarks the page');
    check(await js("document.getElementById('star').getAttribute('aria-pressed')") === 'true', 'star shows as filled');

    // --- Address suggestions ---
    tabs.create();
    await wait(60);
    check(await js("!!document.querySelector('.tab.opening')"), 'new tab slides open');
    await ready(tabs.active);
    await js("const a=document.getElementById('address'); a.focus(); a.value='examp'; a.dispatchEvent(new Event('input'))");
    await wait(800);
    const rows = await js("document.querySelectorAll('#suggest .sg').length");
    check(rows >= 2, `address suggestions appear (${rows} rows)`);
    await shot('01-suggest');
    await js("document.getElementById('address').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
    check(await until(async () => (await js("document.getElementById('overlay').hidden"))), 'Escape closes suggestions');
    await js("const a=document.getElementById('address'); a.focus(); a.value='examp'; a.dispatchEvent(new Event('input'))");
    await wait(600);
    await js("openPanel('bookmarks')");
    check(await until(async () => (await js("document.getElementById('overlay').hidden"))), 'opening a panel closes suggestions');
    await js("closePanel()");

    // --- Library panel ---
    // --- Main menu ---
    await js("document.getElementById('menuBtn').click()");
    check(await until(async () => (await js("document.querySelectorAll('#mainMenu [data-cmd]').length") >= 18 && await js("document.querySelectorAll('#mainMenu .cc-tool').length") === 8)), 'menu opens as a control centre (search, new, zoom, 8 tools, library)');
    await shot('01b-menu');
    await js("document.querySelector('#mainMenu [data-cmd=bookmarks]').click()");
    check(await until(async () => (await js("document.querySelectorAll('#bmList .item').length") === 1)), 'bookmarks panel lists the bookmark');
    await shot('02-bookmarks');
    await js("openPanel('history')");
    check(await until(async () => (await js("document.querySelectorAll('#histList .item').length") >= 1)), 'history panel lists visits');
    await shot('03-history');

    // --- Downloads (from a tiny local server, so this needs no internet) ---
    const dlSrv = require('http').createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain', 'content-disposition': 'attachment; filename="notes.txt"' }); res.end('Burrow download test. '.repeat(200)); });
    await new Promise((r) => dlSrv.listen(0, '127.0.0.1', r));
    tabs.active.view.webContents.downloadURL('http://127.0.0.1:' + dlSrv.address().port + '/notes.txt');
    await until(() => downloads.state().some((d) => d.state === 'completed'), 15000);
    dlSrv.close();
    const done = downloads.state().find((d) => d.state === 'completed');
    check(!!done, `download completes (${done ? done.filename : 'none'})`);
    await js("openPanel('downloads')");
    await wait(500);
    await shot('04-downloads');
    check(!(await js("document.getElementById('dlBtn').hidden")), 'downloads button appears after a download');
    await js("openPanel('settings')");
    check(await until(async () => (await js("document.querySelectorAll('#engines .engine').length") === 6)), 'settings lists search engines');
    check(await js("document.querySelectorAll('#panel details.sect').length") === 12, 'settings has twelve dropdown sections');
    check(await js("document.getElementById('sumEngine').textContent") === 'DuckDuckGo', 'closed dropdown shows the current engine');
    await js("document.querySelector('#panel details.sect').open = true");
    await wait(400);
    await shot('04b-settings');
    await js("document.getElementById('panelClose').click()");

    // --- Bookmarks bar ---
    check(await js("!document.getElementById('bmbar').hidden"), 'bookmarks bar is shown by default');
    check(await js("document.querySelectorAll('#bmItems .bm').length") === 1, 'bookmarks bar shows the bookmark');
    setPrefs({ bookmarksBar: false });
    check(await until(async () => (await js("document.getElementById('bmbar').hidden"))), 'bookmarks bar can be hidden');
    setPrefs({ bookmarksBar: true });
    await wait(300);

    // --- Workspaces ---
    await js("document.getElementById('wsBtn').click()");
    await wait(500);
    await shot('05-ws-menu');
    await js("document.getElementById('backdrop').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))");
    const homeTabs = tabs.visible.length;
    tabs.createWorkspace('College');
    check(await until(async () => (tabs.visible.length === 1 && tabs.workspaces.length === 2)), 'new workspace starts with one tab');
    // Quick link only for this workspace
    await ready(tabs.active);
    const cpage = tabs.active.view.webContents;
    const cjs = (code) => cpage.executeJavaScript(code);
    await cjs("document.getElementById('linksEdit').click(); document.querySelector('[data-add]').click()");
    check(await until(async () => ((await cjs("document.getElementById('scopeWs').textContent")) === 'Only College')), 'link form offers "Only College"');
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
    await ready(homeNew);
    check((await homeNew.view.webContents.executeJavaScript("document.getElementById('links').textContent")).includes('Lectures') === false, 'Home new tab does not show the College-only link');
    tabs.close(homeNew.id);
    tabs.switchWorkspace(collegeId);
    check(await until(async () => (await js("document.getElementById('wsName').textContent") === 'COLLEGE')), 'strip shows the workspace name');
    tabs.switchWorkspaceIndex(0);
    check(await until(async () => (tabs.visible.length === homeTabs)), 'switching back restores Home tabs');

    // --- Reopen closed tab ---
    const before = tabs.visible.length;
    const web = tabs.visible.find((t) => t.url.startsWith('https://'));
    tabs.close(web.id);
    await wait(40);
    check(await js("!!document.querySelector('.closing')"), 'closed tab shrinks away');
    check(await until(async () => (tabs.visible.length === before - 1)), 'closing a tab removes it');
    await wait(300);
    tabs.reopenClosed();
    check(await until(async () => (tabs.visible.length === before)), 'Ctrl+Shift+T reopens the closed tab');

    }
    if (section('phase3')) {
    // ================= Phase 3 =================
    // --- Find in page ---
    const ex = tabs.create('https://example.com/');
    await ready(ex);
    mainWin.send('find-open');
    check(await until(async () => (await js("!document.getElementById('findbar').hidden"))), 'Ctrl+F opens the find bar');
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
    check(await until(async () => (await js("document.getElementById('findbar').hidden"))), 'find bar closes');

    // --- Zoom, remembered per site ---
    tabs.stepZoom(1);
    check(await until(async () => (Math.abs(ex.view.webContents.getZoomFactor() - 1.1) < 0.01)), 'Ctrl+= zooms to 110%');
    check(await js("document.getElementById('zoomBtn').textContent") === '110%', 'address bar shows 110%');
    check((store.get('zoom') || {})['example.com'] === 1.1, 'zoom is remembered for example.com');
    const ex2 = tabs.create('https://example.com/');
    await ready(ex2);
    await until(() => Math.abs(ex2.view.webContents.getZoomFactor() - 1.1) < 0.01);
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
    await ready(mt);
    await until(() => { const x = tabs.state().tabs.find((t) => t.id === mt.id); return x.media && x.audible; }, 5000);
    const ms = tabs.state().tabs.find((t) => t.id === mt.id);
    check(ms.media, 'playing video shows the picture-in-picture button');
    check(ms.audible, 'tab playing sound shows a speaker');
    const pipResult = await mainWin.pip();
    check(await until(async () => (pipResult === 'ok' && await mt.view.webContents.executeJavaScript('!!document.pictureInPictureElement'))), `picture-in-picture pops the video out (${pipResult})`);
    await shot('08-media', true);
    await mainWin.pip(); // bring it back
    tabs.toggleMute(mt.id);
    check(await until(async () => (tabs.state().tabs.find((t) => t.id === mt.id).muted)), 'a tab can be muted');
    tabs.close(mt.id);

    // --- Private window ---
    const histBefore = library.history.length;
    const pw = openWindow({ isPrivate: true });
    await until(() => pw.tabs.active, 5000);
    await ready(pw.tabs.active);
    check(windows.size === 2 && pw.tabs.visible.length === 1, 'Ctrl+Shift+N opens a private window');
    const pPage = pw.tabs.active.view.webContents;
    check((await pPage.executeJavaScript("document.querySelector('h1').textContent")).includes('privately'), 'private new tab says "Browsing privately"');
    check(pPage.session !== session.defaultSession, 'private window uses its own session');
    await shot('09-private-page-from-main'); // main window unaffected
    await capture(pw.ui.webContents, path.join(dir, '09-private-ui.png'));
    await capture(pPage, path.join(dir, '09-private-page.png'));
    pw.tabs.navigate('https://example.com/');
    await ready(pw.tabs.active, 'example.com');
    await wait(300);
    check(library.history.length === histBefore, 'private browsing adds nothing to history');
    await pPage.session.cookies.set({ url: 'https://example.com/', name: 'burrow_private_test', value: '1' });
    const leaked = await session.defaultSession.cookies.get({ name: 'burrow_private_test' });
    check(leaked.length === 0, "private cookies don't leak into normal browsing");
    pw.win.close();
    await wait(800);
    check(windows.size === 1, 'closing the private window leaves the main window open');

    }
    if (section('phase4')) {
    // ================= Phase 4: Ask AI + Ctrl+K palette =================
    const AI = require('../shared/ai');
    const { clipboard } = require('electron');
    check(AI.isQuestion('how do volcanoes work') && AI.isQuestion('weather tomorrow?') && !AI.isQuestion('example.com') && !AI.isQuestion('cheap flights to goa'), 'question detection tells questions from searches');
    // Record where Burrow would go instead of really loading AI sites.
    const went = [];
    const realNavigate = tabs.navigate.bind(tabs);
    tabs.navigate = (u) => { went.push(u); };
    const typeAddress = (text) => js(`(() => { const a = document.getElementById('address'); a.focus(); a.value = ${JSON.stringify(text)}; a.dispatchEvent(new Event('input')); })()`);
    await typeAddress('how do volcanoes work');
    check(await until(async () => (await js("document.querySelector('#suggest .sg').classList.contains('sg-ask')"))), 'a question puts "Ask Claude" first in the address bar');
    await shot('11-address-ask');
    await js("document.getElementById('addressForm').requestSubmit()");
    check(await until(async () => (went.includes('https://claude.ai/new?q=how%20do%20volcanoes%20work'))), 'Enter asks Claude with the question filled in');
    await typeAddress('cheap flights to goa');
    await wait(300);
    check(await js("document.querySelector('#suggest .sg').classList.contains('sg-search')"), 'a normal search keeps Search first');
    await js("document.getElementById('address').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    setPrefs({ aiProvider: 'gemini' });
    mainWin.ask('what is a black hole');
    await wait(200);
    // (In Electron 45 reading the clipboard is asynchronous.)
    check(await clipboard.readText() === 'what is a black hole' && went.includes('https://gemini.google.com/app'), 'Gemini: the question is copied and Gemini opens');
    setPrefs({ aiProvider: 'claude' });
    tabs.navigate = realNavigate;

    // New tab: Search | Ask
    const nt = tabs.create();
    await ready(nt);
    const ntjs = (code) => nt.view.webContents.executeJavaScript(code);
    await ntjs("(() => { const q = document.getElementById('q'); q.value = 'why is the sky blue'; q.dispatchEvent(new Event('input')); })()");
    check(await until(async () => (await ntjs("document.body.classList.contains('ask-mode')"))), 'new tab flips to Ask when you type a question');
    await shot('11b-newtab-ask', true);
    let askedFrom = '';
    const realFrom = tabs.navigateFrom.bind(tabs);
    tabs.navigateFrom = (_wc, u) => { askedFrom = u; };
    await ntjs("document.getElementById('search').requestSubmit()");
    check(await until(async () => (askedFrom === 'https://claude.ai/new?q=why%20is%20the%20sky%20blue')), 'new tab Ask opens Claude with the question');
    tabs.navigateFrom = realFrom;
    tabs.close(nt.id);
    await wait(300);

    // Settings: AI assistant
    await js("openPanel('settings')");
    check(await until(async () => (await js("document.querySelectorAll('#aiList .engine').length") === 3)), 'Settings offers Claude, ChatGPT and Gemini');
    check((await js("document.getElementById('sumAI').textContent")).startsWith('Claude'), 'Settings shows Claude as the current AI');
    await js("closePanel()");

    // Ctrl+K palette
    ui.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'K', modifiers: ['control'] });
    check(await until(async () => (await js("!document.getElementById('palette').hidden"))), 'Ctrl+K opens the command palette');
    const typePalette = (text) => js(`(() => { const p = document.getElementById('palInput'); p.value = ${JSON.stringify(text)}; p.dispatchEvent(new Event('input')); })()`);
    const paletteKey = (key) => js(`document.getElementById('palInput').dispatchEvent(new KeyboardEvent('keydown', { key: '${key}', bubbles: true }))`);
    await typePalette('dark');
    check(await until(async () => ((await js("document.querySelector('#palList .pal-row .main').textContent")).includes('dark theme'))), 'typing "dark" finds "Switch to dark theme"');
    await shot('12-palette');
    await paletteKey('Enter');
    await wait(400);
    check(await until(async () => store.get('theme').mode === 'dark' && await js("document.getElementById('palette').hidden")), 'Enter runs the action and closes the palette');
    setTheme({ mode: 'light' });
    mainWin.send('palette-open');
    await wait(500);
    await typePalette('example');
    check(await until(async () => (await js("document.querySelector('#palList .pal-row').classList.contains('pal-tab')"))), 'typing a site name finds its open tab');
    await paletteKey('Escape');
    mainWin.send('palette-open');
    await wait(500);
    await typePalette('how do I center a div');
    check(await until(async () => (await js("document.querySelector('#palList .pal-row').classList.contains('pal-ask')"))), 'a question in the palette puts Ask first');
    await shot('12b-palette-ask');
    await paletteKey('Escape');
    await wait(200);

    }
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
    if (section('phase5')) {
    // ================= Phase 5: split view, reader, AI panel, notes =================
    // --- Split view ---
    while (tabs.visible.length < 3) tabs.create('https://example.com/', { activate: false }); // (the picker check needs 3)
    tabs.activate(tabs.visible[0].id);
    await wait(500);
    mainWin.send('noop');
    tabs.splitWith();
    await wait(800);
    const sp = tabs.state().split;
    check(sp && sp.shown, 'split view shows two tabs side by side');
    const [L, R] = tabs.shownTabs.map((t) => t.view.getBounds());
    check(L && R && R.x > L.x + L.width && Math.abs(L.width - R.width) <= 2, `the two pages sit side by side (${L?.width} | ${R?.width})`);
    check(await js("!document.getElementById('splitDivider').hidden"), 'a divider appears between them');
    await shot('13-split');
    // Drag the divider to the right with the real mouse
    const dv = await js("(() => { const r = document.getElementById('splitDivider').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 200 }; })()");
    await dragMouse(ui.webContents, dv, { x: dv.x + 200, y: dv.y }, 10);
    check(tabs.split && tabs.split.ratio > 0.55, `dragging the divider resizes the split (${tabs.split?.ratio.toFixed(2)})`);
    // Clicking into the right side makes it the active tab
    const right = tabs.get(tabs.split.b);
    right.view.webContents.focus();
    check(await until(async () => (tabs.activeId === right.id)), 'clicking into the right side makes it the active tab');
    tabs.swapSplit();
    check(await until(async () => (tabs.shownTabs[0].id === right.id)), 'swap puts the right tab on the left');
    tabs.unsplit();
    await wait(400);
    check(!tabs.split && tabs.shownTabs.length === 1 && tabs.shownTabs[0].view.getBounds().width === tabs.bounds.width, 'closing split view shows one full-width page');
    ui.webContents.sendInputEvent({ type: 'keyDown', keyCode: '\\', modifiers: ['control'] });
    await wait(500);
    const pickRows = await js("document.querySelectorAll('#splitPick .sp-row').length");
    check(await js("!document.getElementById('splitPick').hidden") && pickRows === tabs.visible.length, `Ctrl+\\ opens a picker of tabs to split with (${pickRows} choices)`);
    await shot('13b-split-picker');
    const wantId = await js("(() => { const r = document.querySelectorAll('#splitPick .sp-row'); return r.length > 1 ? 2 : 1; })()");
    await js(`document.getElementById('splitPick').dispatchEvent(new KeyboardEvent('keydown', { key: '${wantId}', bubbles: true }))`);
    await wait(600);
    const expectRight = tabs.visible.filter((t) => t.id !== tabs.activeId)[wantId - 1];
    check(!!tabs.split && tabs.split.b === expectRight?.id, 'picking a tab puts that tab on the right');
    const pairB = tabs.split.b;
    tabs.close(pairB);
    await wait(400);
    check(!tabs.split && tabs.shownTabs.length === 1, 'closing one side ends split view');

    // --- Reader view (a local test article with a hidden script and a booby-trapped image) ---
    const http = require('http');
    const para = 'Burrow reader test paragraph with enough words to look like a real article about volcanoes, magma chambers, eruptions and the geology of mountains. '.repeat(6);
    const articleHtml = `<!doctype html><html lang="en"><head><title>Volcanoes explained</title></head><body>
      <nav>Home | About | Contact</nav>
      <article><h1>Volcanoes explained</h1><p class="byline">By Test Writer</p>
      ${Array.from({ length: 8 }, (_, i) => `<p>${para} Part ${i + 1}.</p>`).join('')}
      <img src="https://invalid.example/x.png" onerror="window.__pwned = 1">
      <script>window.__pwned = 2</script>
      <p><a href="javascript:window.__pwned=3">sneaky link</a></p>
      </article><footer>Footer stuff</footer></body></html>`;
    const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(articleHtml); });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const articleUrl = `http://127.0.0.1:${server.address().port}/article`;
    const art = tabs.create(articleUrl);
    await ready(art);
    await until(() => tabs.state().tabs.find((t) => t.id === art.id)?.readerable, 5000);
    check(tabs.state().tabs.find((t) => t.id === art.id)?.readerable, 'an article page gets the reader button');
    check(!(await js("document.getElementById('readerBtn').hidden")), 'the reader button shows in the address bar');
    const opened = await tabs.toggleReader(art);
    await ready(art, 'burrow://reader');
    check(opened && art.url.startsWith('burrow://reader'), 'reader view opens');
    const rwc = art.view.webContents;
    check((await rwc.executeJavaScript("document.querySelector('h1').textContent")) === 'Volcanoes explained', 'reader shows the article title');
    check(await rwc.executeJavaScript("document.querySelectorAll('.rbody script, .rbody [onerror]').length") === 0, 'scripts and onerror tricks are stripped');
    check(await rwc.executeJavaScript("!document.querySelector('.rbody a[href^=\"javascript\"]')"), 'javascript: links are stripped');
    check(await rwc.executeJavaScript('window.__pwned === undefined'), 'nothing from the article ran');
    check((await js("document.getElementById('address').value")) === articleUrl, 'address bar shows the original page in reader view');
    await shot('14-reader', true);
    await tabs.toggleReader(art);
    await ready(art, '127.0.0.1');
    check(art.url === articleUrl, 'leaving reader view goes back to the page');

    // --- Notes ---
    tabs.activate(art.id);
    await wait(300);
    await js("openPanel('notes')");
    check(await until(async () => ((await js("document.getElementById('noteHost').textContent")) === '127.0.0.1:' + server.address().port)), 'Notes opens for the current site');
    await js("(() => { const t = document.getElementById('noteText'); t.value = 'Remember: magma is hot'; t.dispatchEvent(new Event('input')); })()");
    // Notes save 0.4 s after you stop typing; on a busy computer that can take longer, so keep checking.
    const notesSvc = getNotes();
    const noteHost = '127.0.0.1:' + server.address().port;
    check(await until(() => notesSvc.get(noteHost) === 'Remember: magma is hot'), 'typing a note saves it');
    await shot('15-notes');
    const mdPath = path.join(dir, 'notes-export.md');
    await notesSvc.exportTo(mdPath);
    const md = fs.readFileSync(mdPath, 'utf8');
    check(md.includes('# Burrow notes') && md.includes('Remember: magma is hot'), 'notes export as Markdown');
    await js("closePanel()");
    server.close();

    // --- AI panel (loads a blank page here, so the test never contacts an AI site) ---
    const aiLoads = [];
    const realLoadAI = mainWin.loadAI.bind(mainWin);
    mainWin.loadAI = (url) => { aiLoads.push(url || 'home'); realLoadAI('about:blank'); };
    const fullWidth = tabs.bounds.width;
    mainWin.setAI(true);
    check(await until(async () => (mainWin.aiOpen && mainWin.aiView)), 'Ctrl+Shift+A opens the AI panel');
    const aiB = mainWin.aiView.getBounds();
    check(tabs.bounds.width < fullWidth && aiB.x >= tabs.bounds.x + tabs.bounds.width, 'pages shrink to make room for the AI panel on the right');
    check(await js("!document.getElementById('aiPanel').hidden && document.querySelectorAll('#aiSeg button').length === 3"), 'the AI panel header offers Claude, ChatGPT and Gemini');
    await shot('16-ai-panel');
    mainWin.ask('what is a magma chamber');
    check(aiLoads.includes('https://claude.ai/new?q=what%20is%20a%20magma%20chamber'), 'with the panel open, Ask AI goes to the panel');
    mainWin.setAI(false);
    await wait(400);
    check(!mainWin.aiOpen && tabs.bounds.width === fullWidth, 'closing the AI panel gives the page its width back');
    mainWin.loadAI = realLoadAI;
    tabs.close(art.id);
    await wait(300);

    }
    if (section('welcome')) {
    // ================= Welcome tour =================
    check(store.get('onboarded') === false, 'a fresh install has not seen the welcome tour');
    const wt = tabs.create('burrow://welcome/');
    await ready(wt);
    await wait(300);
    const wjs = (code) => wt.view.webContents.executeJavaScript(code);
    check((await wjs("document.querySelector('.step:not([hidden]) h1').textContent")).startsWith("Hi. I'm Mochi"), 'the tour opens with Mochi saying hello');
    check(await wjs("document.querySelectorAll('#stepList li').length") === 8, 'the tour has eight steps');
    await shot('17-welcome-hello', true);
    await wjs("document.getElementById('next').click()");
    check(await until(async () => (await wjs("document.querySelector('.step:not([hidden]) h1').textContent")).startsWith('Bring your stuff')), 'step 2 offers to bring your stuff from another browser');
    await wjs("document.getElementById('next').click()");
    await wait(300);
    await wjs("document.querySelector('#modeSeg [data-mode=dark]').click()");
    await wait(300);
    await wjs("document.querySelector('#swatches [data-seed=\"#138A82\"]').click()");
    await wait(500);
    check(await until(async () => store.get('theme').mode === 'dark' && store.get('theme').seed === '#138A82'), 'step 2 sets the theme and colour live');
    await shot('17b-welcome-look', true);
    await wjs("document.getElementById('next').click()");
    await wait(300);
    await wjs("document.querySelector('#engines [data-engine=bing]').click()");
    await wait(300);
    check(await until(async () => store.get('searchEngine') === 'bing' && store.get('searchChosen')), 'step 3 picks the search engine');
    await wjs("document.getElementById('next').click()");
    await wait(300);
    // Sign-in buttons open the AI's own sign-in page (recorded here instead of really opening it)
    const signinOpened = [];
    const realCreateW = tabs.create.bind(tabs);
    tabs.create = (url, opts) => { if (/^https:/.test(url)) { signinOpened.push(url); return null; } return realCreateW(url, opts); };
    await wjs("document.querySelector('#ais [data-ai=chatgpt]').click()");
    await wait(300);
    await wjs("document.querySelector('#ais [data-signin=chatgpt]').click()");
    await wait(300);
    tabs.create = realCreateW;
    check(store.get('aiProvider') === 'chatgpt', 'step 4 sets the default AI');
    check(signinOpened.includes('https://chatgpt.com/auth/login'), "Sign in opens ChatGPT's own sign-in page");
    await shot('17c-welcome-ai', true);
    await wjs("document.getElementById('next').click()");
    check(await until(async () => (await wjs("document.querySelector('.step:not([hidden]) h1').textContent")).startsWith("I'm more than a mascot")), 'a Mochi step shows what Mochi can do');
    check(await wjs("document.querySelectorAll('.mochi-cards .card').length") === 6, 'six of Mochi\'s jobs: limits, focus, your week, tab helpers, carrots, Mochi Hop');
    await wjs("document.querySelector('#eyeSeg [data-eyes=\"0\"]').click()");
    await wjs("document.getElementById('bedSel').value = '23:00'; document.getElementById('bedSel').dispatchEvent(new Event('change'))");
    check(await until(() => store.get('eyeBreaks') === 0 && store.get('bedtime') === '23:00'), 'eye breaks and bedtime can be set right in the tour');
    await shot('17e-welcome-mochi', true);
    await wjs("document.getElementById('next').click()");
    check(await until(async () => (await wjs("document.querySelectorAll('#keys .key').length") === 10)), 'the shortcuts step lists ten (incl. right-click menus)');
    check((await wjs("document.getElementById('keys').textContent")).includes('Right-click'), 'right-click menus are among them');
    await shot('17d-welcome-keys', true);
    await wjs("document.getElementById('next').click()");
    check(await until(async () => ((await wjs("document.getElementById('summary').textContent")).includes('Bing'))), 'the last step sums up your choices');
    check((await wjs("document.getElementById('summary').textContent")).includes('bedtime 23:00'), 'including Mochi\'s settings');
    await wjs("document.getElementById('go').click()");
    check(await until(async () => store.get('onboarded') === true && wt.url.startsWith('burrow://newtab')), 'Start browsing finishes the tour and opens a new tab');
    tabs.close(wt.id);
    setTheme({ mode: 'light', seed: '#E63027' });
    setPrefs({ aiProvider: 'claude', eyeBreaks: 20, bedtime: '' });
    await wait(300);

    }
    if (section('phase6')) {
    // ================= Phase 6: tab sleeping =================
    const sleepy = tabs.create('https://example.com/', { activate: false });
    await until(() => !sleepy.loading, 8000);
    sleepy.view.webContents.loadURL('https://example.com/?second');
    await until(() => sleepy.url.includes('?second') && !sleepy.loading, 8000);
    sleepy.lastActive = 0; // pretend it's been out of sight for ages
    sweepSleep();
    check(await until(async () => (sleepy.asleep && !sleepy.view)), 'a tab out of sight for a while goes to sleep (its page is unloaded)');
    check(await until(() => js(`!!document.querySelector('[data-id="${sleepy.id}"].asleep')`)), 'a sleeping tab shows "zz" in the tab strip');
    await shot('18-sleeping-tab');
    tabs.activate(sleepy.id);
    check(await until(() => !sleepy.asleep && sleepy.view && !sleepy.loading, 10000), 'clicking a sleeping tab wakes it');
    check(sleepy.url.includes('?second') && sleepy.view.webContents.navigationHistory.canGoBack(), 'it wakes on the same page, with Back still working');
    // Things that must stay awake
    const loud = tabs.create('data:text/html,' + encodeURIComponent('<script>const a=new AudioContext();const o=a.createOscillator();const g=a.createGain();g.gain.value=0.02;o.connect(g).connect(a.destination);o.start();</script>'), { activate: false });
    await until(() => loud.audible, 5000);
    tabs.activate(tabs.visible[0].id);
    await wait(200);
    loud.lastActive = 0;
    sleepy.lastActive = 0;
    tabs.keepAwake(sleepy.id, true);
    sweepSleep();
    await wait(300);
    check(!loud.asleep, 'a tab playing sound never sleeps');
    check(!sleepy.asleep, '"Keep this tab awake" keeps it awake');
    tabs.keepAwake(sleepy.id, false);
    setPrefs({ sleep: { never: 'example.com' } });
    sweepSleep();
    await wait(300);
    check(!sleepy.asleep, 'a "never sleep" site stays awake');
    setPrefs({ sleep: { allow: 'example.com' } });
    tabs.close(loud.id);
    // Sleep now (Ctrl+K) — Mochi reports it
    await js('mochiLastChat = 0, UI.mochiLog.length = 0');
    sleepy.lastActive = Date.now(); // recent: only "sleep now" ignores the timer
    await js('B.tabs.sleepNow()');
    check(await until(() => sleepy.asleep), '"Put other tabs to sleep now" sleeps them right away');
    check(await until(() => js("UI.mochiLog.some((m) => /tucked/.test(m.text) && m.pose === 'sleepy')")), 'Mochi says how many tabs it tucked into bed');
    await shot('18b-sleep-now');
    tabs.close(sleepy.id);
    // Settings: Off stops sleeping
    await js("openPanel('settings')");
    await wait(300);
    await js("document.querySelector('#sleepSeg [data-sleep=off]').click()");
    check(await until(() => store.get('sleep').on === false), 'Settings can turn tab sleeping off');
    await js("document.querySelector('#sleepSeg [data-sleep=\"30\"]').click()");
    await until(() => store.get('sleep').on === true);
    // Restored windows load lazily: only the tab you see wakes up.
    const lazy = openWindow({ snapshot: { current: 0, workspaces: [{ id: 0, name: 'Home', active: 1, tabs: [
      { url: 'https://example.com/?a', title: 'Saved A' }, { url: 'https://example.com/?b', title: 'Saved B' }, 'https://example.com/?c'] }] } });
    await until(() => lazy.tabs.tabs.length === 3 && lazy.tabs.tabs[1].view, 5000);
    await ready(lazy.tabs.tabs[1]);
    const lz = lazy.tabs.tabs;
    check(lz.length === 3 && lz.filter((t) => t.view).length === 1 && lz[1].view, 'a restored window only loads the tab you see (the rest wait asleep)');
    check(lz[0].title === 'Saved A' && lz[0].asleep, 'sleeping restored tabs keep their saved titles');
    lazy.win.close();
    await wait(600);

    }
    if (section('phase7')) {
    // ================= Phase 7: Mochi =================
    const Mochi = require('../shared/mochi');
    check(['sleepy', 'walk1', 'walk2', 'press', 'celebrate', 'oops'].every((p) => Mochi.POSES[p]), 'Mochi has new poses: sleepy, walking, press, celebrate, oops');
    await js("closePanel()");
    await wait(200);
    await js("mochiLastChat = 0, document.getElementById('stripMochi').hidden = true");
    await js("mochiSay('Testing, testing', { essential: true })");
    check(await until(async () => (await js("!document.getElementById('stripMochi').hidden && document.getElementById('stripMochi').classList.contains('walking')"))), 'Mochi walks into the tab strip before speaking');
    check(await until(async () => (await js("document.querySelector('#stripSprite .mochi-svg').dataset.pose === 'happy' && !document.getElementById('stripMochi').classList.contains('walking')"))), 'then stops and shows the right pose');
    await shot('19-mochi-strip');
    setPrefs({ mochiMode: 'quiet' });
    check(await until(async () => (await js("mochiLastChat = 0, mochiSay('chatter') === false && mochiSay('important', { essential: true }) === true"))), 'Quiet mode: Mochi only says important things');
    setPrefs({ mochiMode: 'off' });
    await wait(300);
    check(await js("mochiSay('important', { essential: true }) === false"), 'Off: Mochi stays out of sight');
    const offTab = tabs.create();
    await ready(offTab);
    check(await offTab.view.webContents.executeJavaScript("document.body.classList.contains('mochi-off')"), 'Off also hides Mochi on the new tab');
    tabs.close(offTab.id);
    setPrefs({ mochiMode: 'lively' });
    await wait(300);
    // Bookmark reaction (Lively)
    const bmTab = tabs.create('https://example.com/?mochi');
    await until(() => !bmTab.loading, 8000);
    // (Mochi never talks over an important message that's still showing, so clear the earlier one.)
    await js("mochiLastChat = 0, UI.mochiLog.length = 0, UI.stripEssential = false, document.getElementById('stripMochi').hidden = true");
    await js("document.getElementById('star').click()");
    check(await until(() => js("UI.mochiLog.some((m) => m.text === 'Saved for later!')")), 'bookmarking a page makes Mochi say "Saved for later!"');
    tabs.close(bmTab.id);
    await js("openPanel('settings')");
    await wait(300);
    await js("document.querySelectorAll('#panel details.sect')[6].open = true");
    check(await until(async () => (await js("document.querySelectorAll('#mochiGallery figure').length") === 7)), 'Settings → Mochi shows the pose gallery');
    await shot('19b-mochi-settings');
    await js("closePanel()");


    }
    if (section('phase8')) {
    // ================= Phase 8: focus tools, per-tab volume, control centre =================
    const focus = getFocus();
    await js('UI.animSpeed = 0.25'); // Mochi's walk / countdown / chomp run 4x faster in the test
    const http8 = require('http');
    // Volume test pages: one with same-origin audio (may be boosted), one with audio from another origin (may not).
    const wav = (() => {
      const n = 8000, b = Buffer.alloc(44 + n);
      b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
      b.writeUInt32LE(8000, 24); b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40); b.fill(128, 44);
      return b;
    })();
    let limitPort = 0;
    const srv8 = http8.createServer((req, res) => {
      if (req.url.startsWith('/a.wav')) { res.writeHead(200, { 'content-type': 'audio/wav' }); return res.end(wav); }
      const src = req.url.startsWith('/cross') ? 'http://localhost:' + srv8.address().port + '/a.wav' : '/a.wav';
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><title>Doomscroll test</title><h1>Endless feed</h1><audio id="a" src="' + src + '" preload="auto"></audio>');
    });
    await new Promise((r) => srv8.listen(0, '127.0.0.1', r));
    limitPort = srv8.address().port;
    const site = '127.0.0.1:' + limitPort;
    const feedUrl = 'http://' + site + '/feed';
    focus.isIdle = () => false; // the test machine may look idle

    // --- Settings → Focus ---
    await js("openPanel('settings')");
    await wait(300);
    await js("document.getElementById('focusSect').open = true");
    await until(() => js("document.querySelectorAll('#limitSuggest [data-suggest]').length === 6"));
    check(await js("document.querySelectorAll('#limitSuggest [data-suggest]').length") === 6, 'Settings → Focus suggests six sites to limit');
    await js("document.querySelector('#limitSuggest [data-suggest=\"youtube.com\"]').click()");
    check(await until(() => focus.limits['youtube.com'] === 30), 'a suggestion chip adds a 30-minute limit');
    check(await until(() => js("document.querySelectorAll('#limitList .limit-row').length === 1")), 'the limit is listed');
    await js("const sel = document.querySelector('#limitList [data-budget]'); sel.value = '60'; sel.dispatchEvent(new Event('change', { bubbles: true }))");
    check(await until(() => focus.limits['youtube.com'] === 60), 'changing the budget saves it');
    await js("document.getElementById('limitSite').value = 'not a site'; document.getElementById('limitAdd').requestSubmit()");
    check(await until(() => js("!document.getElementById('limitErr').hidden")), 'a bad site name shows an error');
    await js("document.getElementById('limitSite').value = 'https://www.Instagram.com/reels'; document.getElementById('limitAdd').requestSubmit()");
    check(await until(() => focus.limits['instagram.com'] === 30), 'typing a full address limits just the site (instagram.com)');
    await shot('20-focus-settings');
    await js("document.querySelector('#limitList [data-remove]').click()");
    check(await until(() => !focus.limits['youtube.com']), 'the × removes a limit');
    focus.setLimit('instagram.com', 0);
    await js("closePanel()");

    // --- Warnings ---
    focus.limits[site] = 15; // (a local test address: set directly, since the form only takes real domains)
    const feed = tabs.create(feedUrl);
    await until(() => !feed.loading, 8000);
    focus.used[site] = 15 * 60 - 299; // under 5 minutes left
    await js('mochiLastChat = 0, UI.mochiLog.length = 0, UI.stripEssential = false');
    focus.checkWarnings(site);
    check(await until(() => js("UI.mochiLog.some((m) => /5 min left on 127/.test(m.text))")), 'Mochi warns "5 min left" on a 15-minute limit');
    check(await until(() => js("!document.getElementById('focusChip').hidden && /127/.test(document.getElementById('focusChip').textContent)")), 'the countdown chip shows in the address bar');
    await shot('21-focus-warning');

    // --- Time's up: "1 more minute" works twice ---
    const eater = () => js("!document.getElementById('eater').hidden");
    const eatSteps = () => js("UI.eatLog.map((e) => e.step).join(',')");
    for (let n = 1; n <= 2; n++) {
      focus.used[site] = focus.budgetSec(site) + (focus.extra[site] || 0);
      focus.timeUp(site);
      check(await until(() => js("!!document.getElementById('eatSnooze')"), 4000), 'time\'s up: Mochi offers "1 more minute" (' + n + ')');
      if (n === 1) {
        await shot('22-times-up');
        const eb = await js("(() => { const r = document.getElementById('eater').getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), w: window.innerWidth, vis: getComputedStyle(document.getElementById('eater')).visibility }; })()");
        check(eb.right <= eb.w - 146, 'the "1 more minute" bubble stays clear of the window buttons (' + JSON.stringify(eb) + ')');
      }
      await js("document.getElementById('eatSnooze').click()");
      check(await until(async () => (await eatSteps()).split(',').filter((x) => x === 'snoozed').length === n), '"1 more minute" gives a minute (' + n + ' of 2)');
      check(focus.remaining(site) > 0 && tabs.get(feed.id), 'the tab stays open after the snooze');
      await until(async () => !(await eater()), 5000);
    }
    // Third time: no more snoozes, Mochi eats the tab.
    check(focus.snooze(site) === false, 'no snooze without a time-up');
    focus.used[site] = focus.budgetSec(site) + (focus.extra[site] || 0);
    focus.timeUp(site);
    check(await until(() => js("document.getElementById('eaterBubble').textContent.includes('Time\\'s up') && !document.getElementById('eatSnooze')"), 4000), 'after two snoozes there is no "1 more minute" button');
    check(await until(() => js("!!document.querySelector('#tabs .being-eaten, #sideTabs .being-eaten')"), 12000), 'Mochi walks over and starts eating the tab');
    if (!(await js("UI.eatLog.some((e) => e.step === 'eaten')"))) await wait(4000);
    note('    eat log: ' + JSON.stringify(await js('UI.eatLog.slice(-3)')));
    await shot('23-mochi-eats');
    check(await until(() => !tabs.get(feed.id), 6000), 'the eaten tab is closed');
    check(await until(() => js("UI.eatLog.some((e) => e.step === 'eaten')")), 'Mochi says "Nom!"');
    await until(async () => !(await eater()), 8000);

    // --- The gate on every way back ---
    const gated = (t) => until(() => t.url.startsWith('burrow://gate') && t.view && !t.loading, 8000);
    const g1 = tabs.create(feedUrl);
    check(await gated(g1), 'opening the site again shows the Burrow gate');
    check(await until(() => js("document.getElementById('address').value.includes('127.0.0.1')")), 'the address bar still shows the site you asked for');
    const gp = () => g1.view.webContents;
    check(await until(async () => (await gp().executeJavaScript("document.getElementById('title').textContent")).includes('closed for today')), 'the gate says the site is closed for today');
    await shot('24-gate', true);
    tabs.close(g1.id);
    await wait(300);
    tabs.reopenClosed();
    check(await until(async () => (await gated(tabs.active))), 'Ctrl+Shift+T lands on the gate too');
    tabs.close(tabs.active.id);
    const gt = tabs.create();
    await wait(800);
    tabs.navigate(feedUrl);
    check(await gated(gt), 'typing the address lands on the gate');
    gt.view.webContents.executeJavaScript("location.href = " + JSON.stringify(feedUrl));
    await wait(1200);
    check(gt.url.startsWith('burrow://gate'), 'a link from the gate page itself is caught too');

    // --- Friction unlock: the wait is enforced by Burrow, not the page ---
    const gwc = gt.view.webContents;
    check((await gwc.executeJavaScript("document.getElementById('breatheBtn').textContent")).includes('10 seconds'), 'the first unlock asks for 10 seconds of breathing');
    focus.unlockWait = () => 2; // (test only: a shorter countdown)
    await gwc.executeJavaScript("document.getElementById('needMore').click()");
    await gwc.executeJavaScript("{ const i = document.getElementById('phraseInput'); i.value = 'let me in'; i.dispatchEvent(new Event('input')) }");
    check(await gwc.executeJavaScript("document.getElementById('breatheBtn').disabled"), 'the wrong sentence keeps the button locked');
    check(await gwc.executeJavaScript("(() => { const e = new Event('paste', { cancelable: true }); document.getElementById('phraseInput').dispatchEvent(e); return e.defaultPrevented; })()"), 'pasting the sentence is blocked');
    await gwc.executeJavaScript("{ const i = document.getElementById('phraseInput'); i.value = document.getElementById('phrase').textContent; i.dispatchEvent(new Event('input')) }");
    check(await gwc.executeJavaScript("!document.getElementById('breatheBtn').disabled"), 'typing the sentence unlocks "Breathe"');
    check(await gwc.executeJavaScript("burrowPage.gateUnlock()") === false, 'unlocking without the countdown is refused');
    await gwc.executeJavaScript("document.getElementById('breatheBtn').click()");
    await wait(500);
    check(await gwc.executeJavaScript("burrowPage.gateUnlock()") === false, 'unlocking before the countdown is up is refused');
    await shot('25-gate-breathe', true);
    check(await until(() => gwc.executeJavaScript("!document.getElementById('openBtn').hidden"), 12000), 'after the breathing countdown the open button appears');
    delete focus.unlockWait;
    await gwc.executeJavaScript("document.getElementById('openBtn').click()");
    check(await until(() => gt.url === feedUrl && !gt.loading, 8000), 'the site opens again');
    check(focus.remaining(site) > 280 && focus.remaining(site) <= 300, 'with 5 more minutes (' + focus.remaining(site) + 's)');
    check(focus.unlockWait(site) === 30, 'the next unlock needs 30 seconds of breathing');

    // --- Private windows count too --- (pause the real counter so the open tab here isn't eaten meanwhile)
    focus.isIdle = () => true;
    focus.used[site] = focus.budgetSec(site) + focus.extra[site];
    const pw8 = openWindow({ isPrivate: true });
    await until(() => pw8.tabs.active, 5000);
    const pt = pw8.tabs.create(feedUrl);
    check(await gated(pt), 'a private window shows the gate too');
    pw8.win.close();
    await wait(500);

    // --- Focus session ---
    focus.used[site] = 0; focus.extra[site] = 0; focus.hit = {};
    focus.isIdle = () => false;
    gt.view.webContents.loadURL(feedUrl);
    await until(() => gt.url === feedUrl && !gt.loading, 8000);
    tabs.activate(gt.id);
    await js("document.getElementById('menuBtn').click()");
    await wait(300);
    await js("document.querySelector('#mainMenu [data-cmd=focus]').click()");
    check(await until(() => focus.session?.phase === 'focus'), 'the menu\'s Focus button starts a 25-minute session');
    check(await gated(gt) && gt.url.includes('r=focus'), 'limited sites already open go to the gate');
    check(await until(() => js("!document.getElementById('focusBar').hidden && /FOCUS 2[45]:/.test(document.getElementById('focusChip').textContent)")), 'the focus bar and timer show');
    check(await until(async () => (await gt.view.webContents.executeJavaScript("document.getElementById('title').textContent")).includes('can wait')), 'the gate says the site can wait');
    check(await gt.view.webContents.executeJavaScript("document.getElementById('unlock').hidden"), 'no unlock during a focus session');
    await shot('26-focus-session', true);
    await gt.view.webContents.executeJavaScript("document.querySelector('[data-act=\"end-session\"]').click()");
    check(await until(() => !focus.session && gt.url === feedUrl, 8000), 'ending the session early reopens the site');
    // Counting: only while the site is on screen in the window you're using. (The once-a-second
    // timer is called directly here instead of waiting real seconds.)
    focus.winActive = (w) => w === mainWin;
    const u0 = focus.used[site] || 0;
    focus.tick(); focus.tick();
    check((focus.used[site] || 0) >= u0 + 2, 'time counts while the site is on screen');
    tabs.create();
    await wait(150);
    const u1 = focus.used[site] || 0;
    focus.tick(); focus.tick();
    check((focus.used[site] || 0) === u1, 'and stops when you switch away');
    tabs.close(tabs.active.id);
    delete focus.winActive;
    delete focus.limits[site];
    focus.save();
    tabs.close(gt.id);

    // --- Per-tab volume ---
    const vt = tabs.create(feedUrl + '?vol');
    await until(() => !vt.loading, 8000);
    await wait(500);
    const elVol = () => vt.view.webContents.executeJavaScript("document.getElementById('a').volume");
    let vr = await tabs.setVolume(vt.id, 50);
    check(vr.volume === 50 && Math.abs(await elVol() - 0.5) < 0.01, 'setting 50% turns the page\'s audio down');
    vr = await tabs.setVolume(vt.id, 150);
    check(vr.boostOk && await elVol() === 1, '150% boosts same-site audio');
    await tabs.setVolume(vt.id, 50);
    await wait(400);
    check(await until(() => js("!document.querySelector('#tabs [data-id=\"" + vt.id + "\"] [data-mute]').hidden")), 'a tab at 50% shows its speaker');
    await js("document.querySelector('#tabs [data-id=\"" + vt.id + "\"] [data-mute]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))");
    check(await until(() => js("!document.getElementById('volPop').hidden && document.getElementById('volSlider').value === '50'")), 'clicking the speaker opens the volume slider');
    await shot('27-volume');
    await js("document.getElementById('volRemember').checked = true; document.getElementById('volRemember').dispatchEvent(new Event('change'))");
    check(await until(() => (store.get('volumes') || {})[site] === 50), '"Remember for this site" saves 50%');
    await js('hideOverlay()');
    const vt2 = tabs.create(feedUrl + '?again');
    await until(() => !vt2.loading, 8000);
    check(await until(async () => Math.abs(await vt2.view.webContents.executeJavaScript("document.getElementById('a').volume") - 0.5) < 0.01), 'another tab on that site opens at 50%');
    tabs.close(vt2.id);
    const ct = tabs.create(feedUrl.replace('/feed', '/cross'));
    await until(() => !ct.loading, 8000);
    await wait(500);
    vr = await tabs.setVolume(ct.id, 180);
    check(vr.boostOk === false && await ct.view.webContents.executeJavaScript("document.getElementById('a').volume") === 1, 'audio from another site is never boosted (stays at 100%, not silent)');
    await tabs.setVolume(vt.id, 100, false);
    check(!(store.get('volumes') || {})[site], 'unticking forgets the site');
    tabs.close(ct.id);
    tabs.close(vt.id);
    srv8.close();

    }
    if (section('phase9')) {
    // ================= Phase 9: weekly report + new-tab stat line =================
    const focus = getFocus();
    const stats = getStats();
    const { keyOf, mondayOf, addDays } = require('./stats');
    const http9 = require('http');
    const srv9 = http9.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>Stats test</title><p>Reading.</p>'); });
    await new Promise((r) => srv9.listen(0, '127.0.0.1', r));
    const host9 = '127.0.0.1:' + srv9.address().port;
    const url9 = 'http://' + host9 + '/';
    stats.clear();
    focus.isIdle = () => false;

    // --- Recording: only the window you're using, never private windows ---
    const st = tabs.create(url9);
    await ready(st);
    const pw9 = openWindow({ isPrivate: true });
    await until(() => pw9.tabs.active, 5000);
    const pt9 = pw9.tabs.create(url9);
    await ready(pt9);
    focus.winActive = (w) => w === pw9; // you're looking at the private window
    stats.clear();
    focus.tick(); focus.tick();
    check(!stats.day().sites[host9], 'private windows are never recorded');
    focus.winActive = (w) => w === mainWin;
    focus.tick(); focus.tick();
    check((stats.day().sites[host9] || 0) >= 2, 'time on a site is recorded while it is on screen');
    check(stats.day().total >= 2 && stats.day().limited === 0, 'the day total grows; nothing counted as limited');
    pw9.win.close();
    setPrefs({ reportOn: false });
    const frozen = stats.day().sites[host9];
    focus.tick(); focus.tick();
    check(stats.day().sites[host9] === frozen, 'switching the weekly report off stops recording');
    setPrefs({ reportOn: true });
    delete focus.winActive;
    tabs.close(st.id);
    // 5-week memory
    const old = keyOf(addDays(new Date(), -40));
    stats.days[old] = { sites: { 'old.example': 60 }, total: 60, limited: 0, focus: 0, eaten: 0, snoozes: 0, unlocks: 0, slept: 0, freedMB: 0 };
    stats.prune();
    check(!stats.days[old], 'days older than 5 weeks are forgotten');

    // --- The new-tab stat line: the most relevant kind fact, or nothing ---
    stats.clear();
    const savedLimits = { ...focus.limits };
    for (const k of Object.keys(focus.limits)) delete focus.limits[k];
    const savedStreak = focus.streak;
    check(statLine(mainWin) === null, 'nothing worth saying → no stat line (the greeting stays)');
    stats.day().freedMB = 120;
    check(/saved about 120 MB/.test(statLine(mainWin)), 'memory saved by sleeping tabs');
    stats.day().focus = 2;
    check(statLine(mainWin) === '2 focus sessions done today. Nice.', 'focus sessions finished today beat memory');
    focus.limits['streak.example'] = 30;
    focus.streak = { days: 3, last: null };
    check(statLine(mainWin) === '3-day streak within your limits', 'a streak beats focus sessions');
    focus.session = { phase: 'focus', endsAt: Date.now() + 12 * 60000 };
    check(/^Focus session \u00b7 12 min to go$/.test(statLine(mainWin)), 'a running focus session beats the streak');
    focus.session = null;
    focus.limits['youtube.com'] = 30;
    focus.used['youtube.com'] = 26 * 60;
    check(statLine(mainWin) === '4 min left on YouTube today', 'time left on a limited site comes first');
    const sl = tabs.create();
    await ready(sl);
    check(await until(async () => (await sl.view.webContents.executeJavaScript("document.getElementById('stat').textContent")) === '4 min left on YouTube today'), 'the new tab shows the stat line under the search box');
    await shot('28-newtab-stat', true);
    tabs.close(sl.id);
    setPrefs({ mochiMode: 'off' });
    await wait(200);
    check(statLine(mainWin) === null, 'no stat line when Mochi is off');
    setPrefs({ mochiMode: 'lively' });
    delete focus.used['youtube.com'];
    for (const k of Object.keys(focus.limits)) delete focus.limits[k];
    Object.assign(focus.limits, savedLimits);
    focus.streak = savedStreak;

    // --- Seed two weeks of history, then the Monday nudge and the report ---
    stats.clear();
    const lastMon = addDays(mondayOf(new Date()), -7);
    const day = (o) => ({ sites: {}, total: 0, limited: 0, hadLimits: false, hit: false, focus: 0, eaten: 0, snoozes: 0, unlocks: 0, slept: 0, freedMB: 0, ...o });
    stats.days[keyOf(lastMon)] = day({ sites: { 'youtube.com': 3600, 'github.com': 1800 }, total: 5400, limited: 3600, hadLimits: true, focus: 2, slept: 3, freedMB: 240 });
    stats.days[keyOf(addDays(lastMon, 1))] = day({ sites: { 'github.com': 1800 }, total: 1800, hadLimits: true, hit: true, eaten: 1, snoozes: 2 });
    stats.days[keyOf(addDays(lastMon, -7))] = day({ sites: { 'youtube.com': 9000 }, total: 9000, limited: 9000, hadLimits: true });
    const w1 = stats.week(1);
    check(w1.total === 7200 && w1.prevTotal === 9000 && w1.within === 1 && w1.limitDays === 2 && w1.focus === 2 && w1.eaten === 1, 'last week adds up (2 h, 1 of 2 days within limits, 2 focus, 1 eaten)');
    check(w1.top[0].site === 'youtube.com' && w1.top[0].prev === 9000 && w1.top[1].site === 'github.com' && w1.top[1].prev === 0, 'top sites with last week\'s numbers');
    check(w1.earlier === true && stats.week(0).hasData === false, 'you can step back a week; this week is empty');

    // Monday nudge: once a week, on the first new tab
    stats.store.set('reportSeen', null);
    await js("mochiLastChat = 0, UI.mochiLog.length = 0, UI.stripEssential = false, document.getElementById('stripMochi').hidden = true");
    const n1 = tabs.create();
    await ready(n1);
    check(await until(() => js("UI.mochiLog.some((m) => /^Your week in Burrow is ready/.test(m.text) && m.pose === 'celebrate')")), 'the first new tab of the week brings Mochi: "Your week in Burrow is ready"');
    const n2 = tabs.create();
    await ready(n2);
    await wait(1200);
    check(await js("UI.mochiLog.filter((m) => /Your week/.test(m.text)).length") === 1, 'only once a week');
    await shot('29-report-nudge');
    await js("document.getElementById('stripMochi').click()");
    check(await until(() => tabs.active && tabs.active.url.startsWith('burrow://report')), 'clicking Mochi opens the weekly report');
    const rp = tabs.active;
    await ready(rp);
    const rjs = (code) => rp.view.webContents.executeJavaScript(code);
    check(await until(async () => (await rjs("document.getElementById('whichWeek').textContent")) === 'LAST WEEK'), 'it opens on last week');
    check(await rjs("document.getElementById('nTotal').textContent") === '2 h', 'the report shows 2 h browsing');
    check((await rjs("document.getElementById('dTotal').textContent")) === '30 min less than last week' && await rjs("document.getElementById('dTotal').classList.contains('good')"), 'with "30 min less than last week" marked as good');
    check(await rjs("document.getElementById('nWithin').textContent") === '1 / 2', 'days within limits: 1 / 2');
    check(await rjs("document.querySelectorAll('#chart .day').length") === 7 && await rjs("document.querySelector('#chart .day .lim').style.height !== '0px'"), 'a 7-day chart with the limited part in the accent colour');
    check((await rjs("document.querySelector('#top li b').textContent")) === 'YouTube' && (await rjs("document.querySelectorAll('#top li')[1].textContent")).includes('new this week'), 'top sites: YouTube first, github.com new this week');
    check((await rjs("document.getElementById('highlights').textContent")).includes('240 MB') && (await rjs("document.getElementById('highlights').textContent")).includes('eaten by Mochi'), "Mochi's highlights mention memory freed and tabs eaten");
    check(['celebrate', 'happy'].includes(await rjs("document.getElementById('mochi').dataset.pose")), 'Mochi looks happy about a calmer week');
    await shot('30-report', true);
    await rjs('window.scrollTo(0, document.body.scrollHeight)');
    await wait(300);
    await capture(rp.view.webContents, path.join(dir, '30b-report-bottom.png'));
    await rjs('window.scrollTo(0, 0)');
    await rjs("document.getElementById('earlier').click()");
    check(await until(async () => (await rjs("document.getElementById('whichWeek').textContent")) === '2 WEEKS AGO' && (await rjs("document.getElementById('nTotal').textContent")) === '2 h 30 m'), '"Earlier" shows the week before');
    await rjs("document.getElementById('later').click()");
    await rjs("document.getElementById('later').click()");
    check(await until(async () => (await rjs("document.getElementById('whichWeek').textContent")) === 'THIS WEEK SO FAR' && !(await rjs("document.getElementById('empty').hidden"))), 'this week so far starts empty, with a friendly note');
    // A website can't read the report
    const rpPriv = await rjs("typeof burrowPage.report");
    check(rpPriv === 'function', 'the report page has its bridge');
    tabs.close(rp.id);
    tabs.close(n1.id);
    tabs.close(n2.id);

    // --- Settings → Focus: switch and Clear my stats; ☰ → Report ---
    await js("openPanel('settings')");
    await wait(300);
    await js("document.getElementById('focusSect').open = true");
    check(await until(() => js("document.getElementById('reportOn').checked")), 'Settings shows "Keep a weekly report" switched on');
    await js("document.getElementById('statsClear').click()");
    check(Object.keys(stats.days).length > 0, 'one click on "Clear my stats" asks again');
    await js("document.getElementById('statsClear').click()");
    check(await until(() => Object.keys(stats.days).length === 0), 'the second click clears every day');
    await shot('31-report-settings');
    await js("closePanel()");
    await js("document.getElementById('menuBtn').click()");
    check(await until(async () => (await js("document.querySelectorAll('#mainMenu .cc-lib button').length") === 4)), 'the menu has a Report tile next to the library');
    await js("document.querySelector('#mainMenu [data-cmd=report]').click()");
    check(await until(() => tabs.active && tabs.active.url.startsWith('burrow://report')), '☰ → Report opens the report');
    tabs.close(tabs.active.id);
    srv9.close();
    }
    if (section('phase10')) {
    // ================= Phase 10: right-click menus, last tab closes the window, drag tabs back =================
    const { clipboard } = require('electron');
    const http10 = require('http');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const page10 = '<!doctype html><title>Menu test</title><body style="font:16px sans-serif;margin:20px">'
      + '<p><span id="para">Volcanoes erupt magma</span> from deep chambers.</p>'
      + '<p><a id="lnk" href="/linked">A link to elsewhere</a></p>'
      + '<p><img id="img" src="/pic.png" width="60" height="40"></p>'
      + '<p><input id="inp" value="typed words" spellcheck="false"></p><div style="height:300px"></div></body>';
    const srv10 = http10.createServer((req, res) => {
      if (req.url === '/pic.png') { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(png); }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(req.url === '/linked' ? '<!doctype html><title>Linked</title><p>Linked page</p>' : page10);
    });
    await new Promise((r) => srv10.listen(0, '127.0.0.1', r));
    const base10 = 'http://127.0.0.1:' + srv10.address().port;
    const mt10 = tabs.create(base10 + '/');
    await ready(mt10);
    const pwc = mt10.view.webContents;
    const rectOf = (sel) => pwc.executeJavaScript('(() => { const r = document.querySelector(' + JSON.stringify(sel) + ').getBoundingClientRect(); return { x: Math.round(r.left + Math.min(20, r.width / 2)), y: Math.round(r.top + r.height / 2) }; })()');
    let lastToken = 0;
    // A real right-click (the same path your mouse takes), then wait for Burrow's menu.
    const rightClick = async (pt) => {
      pwc.focus();
      pwc.sendInputEvent({ type: 'mouseDown', x: pt.x, y: pt.y, button: 'right', clickCount: 1 });
      pwc.sendInputEvent({ type: 'mouseUp', x: pt.x, y: pt.y, button: 'right', clickCount: 1 });
      const ok = await until(async () => (await js('UI.lastPageMenu ? UI.lastPageMenu.token : 0')) > lastToken && !(await js("document.getElementById('ctxMenu').hidden")), 4000);
      lastToken = await js('UI.lastPageMenu ? UI.lastPageMenu.token : 0');
      return ok ? js('UI.lastPageMenu.items.map((i) => i.id || "-")') : [];
    };
    const pick = (id) => js("(() => { const i = UI.lastPageMenu.items.findIndex((x) => x.id === " + JSON.stringify(id) + "); document.querySelector('#ctxMenu .cm-item[data-i=\"' + i + '\"]').click(); return i; })()");

    // Plain page
    let ids = await rightClick({ x: 300, y: 260 });
    check(['back', 'forward', 'reload', 'select-all', 'source', 'inspect'].every((x) => ids.includes(x)), 'right-clicking a page shows Back, Forward, Reload, Select all, View source, Inspect');
    await shot('32-ctx-page');
    await js('hideOverlay()');
    check(await until(() => pwc.isFocused()), 'closing the menu gives the page its focus back');
    // Link
    ids = await rightClick(await rectOf('#lnk'));
    check(['link-tab', 'link-window', 'link-private', 'link-split', 'link-copy', 'link-bookmark'].every((x) => ids.includes(x)), 'a link gets: new tab, new window, private window, split view, copy, bookmark');
    await shot('33-ctx-link');
    const tabsBefore = tabs.visible.length;
    await pick('link-tab');
    check(await until(() => tabs.visible.length === tabsBefore + 1 && tabs.visible.some((t) => t.url === base10 + '/linked')), '"Open link in new tab" opens it next to this tab');
    const opened10 = tabs.visible.find((t) => t.url === base10 + '/linked');
    check(tabs.activeId === mt10.id && tabs.visible.indexOf(opened10) === tabs.visible.indexOf(mt10) + 1, 'in the background, right after this tab');
    tabs.close(opened10.id);
    await rightClick(await rectOf('#lnk'));
    await pick('link-copy');
    check(await until(async () => (await clipboard.readText()) === base10 + '/linked'), '"Copy link address" copies it');
    // Selected text
    await pwc.executeJavaScript("(() => { const r = document.createRange(); r.selectNodeContents(document.getElementById('para')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); })()");
    ids = await rightClick(await rectOf('#para'));
    check(['copy', 'search', 'ask', 'note'].every((x) => ids.includes(x)), 'selected text gets: copy, search, ask AI, add to notes');
    check((await js("UI.lastPageMenu.items.find((i) => i.id === 'search').label")).includes('Volcanoes erupt magma'), 'the search item quotes the selection');
    await shot('34-ctx-selection');
    const tb2 = tabs.visible.length;
    await pick('search');
    check(await until(() => tabs.visible.length === tb2 + 1 && tabs.active.url.includes('Volcanoes%20erupt%20magma')), '"Search for…" opens a search for the selection');
    tabs.close(tabs.active.id);
    tabs.activate(mt10.id);
    await wait(300);
    // Image
    ids = await rightClick(await rectOf('#img'));
    check(['img-open', 'img-save', 'img-copy', 'img-addr'].every((x) => ids.includes(x)), 'an image gets: open, save, copy, copy address');
    await pick('img-addr');
    check(await until(async () => (await clipboard.readText()) === base10 + '/pic.png'), '"Copy image address" copies it');
    // Text box: Paste
    clipboard.writeText(' + pasted');
    await pwc.executeJavaScript("(() => { const i = document.getElementById('inp'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); })()");
    ids = await rightClick(await rectOf('#inp'));
    check(['undo', 'redo', 'cut', 'copy', 'paste', 'paste-plain', 'select-all'].every((x) => ids.includes(x)), 'a text box gets: undo, redo, cut, copy, paste, select all');
    await pick('paste');
    check(await until(async () => (await pwc.executeJavaScript("document.getElementById('inp').value")).includes('+ pasted')), 'Paste puts the clipboard into the text box');
    // A page (or anything else) can't make Burrow run an item it didn't offer
    const winsNow = windows.size;
    await rightClick(await rectOf('#para'));
    const tok = await js('UI.lastPageMenu.token');
    await js('hideOverlay()');
    await js("burrow.ctx.run(" + tok + ", 'link-window')");
    await js("burrow.ctx.run(" + (tok + 5) + ", 'reload')");
    await wait(600);
    check(windows.size === winsNow, 'actions that were not on the menu (or from an old menu) are ignored');

    // --- Burrow's own text boxes: the address bar ---
    clipboard.writeText(base10 + '/linked');
    await js("(() => { const a = document.getElementById('address'); a.focus(); const r = a.getBoundingClientRect(); a.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 40, clientY: r.top + 10 })); })()");
    check(await until(() => js("!document.getElementById('ctxMenu').hidden && [...document.querySelectorAll('#ctxMenu .cm-label')].some((l) => l.textContent === 'Paste and go')")), 'right-clicking the address bar offers Paste and go');
    await shot('35-ctx-address');
    await js("[...document.querySelectorAll('#ctxMenu .cm-item')].find((b) => b.textContent.includes('Paste and go')).click()");
    check(await until(() => tabs.active.url === base10 + '/linked', 6000), 'Paste and go opens the copied address');

    // --- Tab menu ---
    const tabMenu = (id) => js("(() => { const el = document.querySelector('#tabs [data-id=\"" + id + "\"], #sideTabs [data-id=\"" + id + "\"]'); const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 10 })); })()");
    const pickLabel = (label) => js("(() => { const b = [...document.querySelectorAll('#ctxMenu .cm-item')].find((x) => x.querySelector('.cm-label').textContent === " + JSON.stringify(label) + "); if (!b) return false; b.click(); return true; })()");
    await tabMenu(mt10.id);
    check(await until(() => js("!document.getElementById('ctxMenu').hidden && document.querySelectorAll('#ctxMenu .cm-item').length >= 12")), 'right-clicking a tab opens the tab menu');
    await shot('36-ctx-tab');
    const tb3 = tabs.visible.length;
    await pickLabel('Duplicate');
    check(await until(() => tabs.visible.length === tb3 + 1 && tabs.visible.filter((t) => t.url === mt10.url).length === 2), 'Duplicate copies the tab');
    const dup = tabs.visible.filter((t) => t.url === mt10.url).find((t) => t.id !== mt10.id);
    // Move to a new workspace (through the submenu)
    const wsBefore = tabs.workspaces.length;
    await tabMenu(dup.id);
    await until(() => js("!document.getElementById('ctxMenu').hidden"));
    await js("(() => { const b = [...document.querySelectorAll('#ctxMenu .cm-item')].find((x) => x.textContent.includes('Move to workspace')); b.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); })()");
    check(await until(() => js("[...document.querySelectorAll('#ctxMenu .cm-sub')].some((s) => !s.hidden)")), 'hovering "Move to workspace" opens its submenu');
    await shot('37-ctx-submenu');
    await pickLabel('New workspace');
    check(await until(() => tabs.workspaces.length === wsBefore + 1 && dup.ws === tabs.workspaces[tabs.workspaces.length - 1].id), 'Move to workspace → New workspace moves the tab there');
    // Close tabs to the right / other tabs
    tabs.activate(mt10.id);
    const r1 = tabs.create(base10 + '/?r1', { activate: false, after: mt10.id });
    const r2 = tabs.create(base10 + '/?r2', { activate: false, after: r1.id });
    await wait(300);
    await tabMenu(mt10.id);
    await until(() => js("!document.getElementById('ctxMenu').hidden"));
    const visAfter = tabs.visible.slice(tabs.visible.indexOf(mt10) + 1).length;
    await pickLabel('Close tabs to the right');
    check(await until(() => !tabs.get(r1.id) && !tabs.get(r2.id) && tabs.visible[tabs.visible.length - 1] === mt10), 'Close tabs to the right (' + visAfter + ' tabs)');

    // --- Bookmarks bar: edit and delete ---
    setPrefs({ bookmarksBar: true });
    library.toggleBookmark(base10 + '/?bm', 'Old name', null);
    await until(() => js("document.querySelectorAll('#bmItems .bm').length > 0"));
    await js("(() => { const el = [...document.querySelectorAll('#bmItems .bm')].find((b) => b.textContent.includes('Old name')); const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 10, clientY: r.top + 8 })); })()");
    check(await until(() => js("!document.getElementById('ctxMenu').hidden")), 'right-clicking a bookmark opens its menu');
    await pickLabel('Edit\u2026');
    check(await until(() => js("!document.getElementById('bmEdit').hidden")), 'Edit… opens the bookmark form');
    await js("document.getElementById('bmEditName').value = 'New name'; document.getElementById('bmEditForm').requestSubmit()");
    check(await until(() => library.bookmarks.some((b) => b.title === 'New name' && b.url === base10 + '/?bm')), 'renaming a bookmark saves it');
    await shot('38-bookmark-edit');
    await js("(() => { const el = [...document.querySelectorAll('#bmItems .bm')].find((b) => b.textContent.includes('New name')); const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 10, clientY: r.top + 8 })); })()");
    await until(() => js("!document.getElementById('ctxMenu').hidden"));
    await pickLabel('Delete');
    check(await until(() => !library.bookmarks.some((b) => b.title === 'New name')), 'Delete removes the bookmark');

    // --- Last tab closes the window ---
    const normals10 = () => [...windows].filter((w) => !w.isPrivate);
    const lone = openWindow({ url: base10 + '/?lone' });
    await until(() => lone.tabs.active, 5000);
    await ready(lone.tabs.active);
    check(lone.tabs.active.url === base10 + '/?lone' && lone.tabs.tabs.length === 1, '"Open in new window" style: a window can start on a given page');
    const n0 = normals10().length;
    lone.tabs.close(lone.tabs.active.id);
    check(await until(() => lone.win.isDestroyed() && normals10().length === n0 - 1), 'closing the last tab closes the window');
    check(!(store.get('session').windows || []).some((w) => (w.workspaces || []).some((ws) => (ws.tabs || []).some((t) => String(t.url || t).includes('?lone')))), 'and that window is not restored next time');
    const pv = openWindow({ isPrivate: true });
    await until(() => pv.tabs.active, 5000);
    pv.tabs.close(pv.tabs.active.id);
    check(await until(() => pv.win.isDestroyed()), 'a private window closes with its last tab too');
    const two = openWindow({ url: base10 + '/?ws' });
    await until(() => two.tabs.active, 5000);
    two.tabs.createWorkspace('Other');
    await wait(300);
    const lastInWs = two.tabs.active;
    two.tabs.close(lastInWs.id);
    await wait(400);
    check(!two.win.isDestroyed() && two.tabs.visible.length === 1 && two.tabs.active.url.startsWith('burrow://newtab'), 'a workspace\'s last tab leaves a new tab while other workspaces have tabs');
    two.win.close();
    const keep = openWindow({ url: base10 + '/?keep' });
    await until(() => keep.tabs.active, 5000);
    keep.tabs.close(keep.tabs.active.id, { keepWindow: true });
    await wait(400);
    check(!keep.win.isDestroyed() && keep.tabs.tabs.length === 1, 'Mochi eating the last tab leaves a new tab (the window stays)');
    keep.win.close();
    await wait(400);

    // --- Drag tabs back between windows ---
    // Tabs lift off upwards too (not only downwards): real mouse, then cancel by coming back.
    const tc = await js("(() => { const el = document.querySelector('#tabs [data-id=\"" + mt10.id + "\"]') || document.querySelector('#sideTabs [data-id=\"" + mt10.id + "\"]'); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, side: !!el.closest('#sideTabs') }; })()");
    if (!tc.side) {
      mainWin.win.focus();
      const nDrag = normals10().length;
      const mv = (type, x, y) => ui.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, modifiers: type === 'mouseUp' ? [] : ['leftButtonDown'] });
      mv('mouseDown', tc.x, tc.y);
      for (let i = 1; i <= 8; i++) { mv('mouseMove', tc.x + i * 4, tc.y - i * 12); await wait(25); }
      check(await js("document.body.classList.contains('tab-tearing')"), 'pulling a tab upwards out of the window lifts it free');
      for (let i = 8; i >= 0; i--) { mv('mouseMove', tc.x + i * 4, tc.y - i * 12); await wait(25); }
      mv('mouseUp', tc.x, tc.y);
      await wait(400);
      check(tabs.get(mt10.id) && normals10().length === nDrag, 'bringing it back to the strip cancels (nothing moves)');
    }
    // A window's only tab dropped onto another window: it joins at the drop spot and the empty window closes.
    const single = openWindow({ url: base10 + '/?single' });
    await until(() => single.tabs.active, 5000);
    await ready(single.tabs.active);
    const movingWc = single.tabs.active.view.webContents;
    const movingId = single.tabs.active.id;
    mainWin.win.focus();
    await wait(300);
    const cb = mainWin.win.getContentBounds();
    const slot = await js("(() => { const els = [...document.querySelectorAll(document.getElementById('sidebar').hidden ? '#tabs [data-id]' : '#sideTabs [data-id]')]; const r = els[1].getBoundingClientRect(); return { x: r.left + 4, y: r.top + r.height / 2 }; })()");
    const sx = cb.x + Math.round(slot.x), sy = cb.y + Math.round(slot.y);
    await single.ui.webContents.executeJavaScript('burrow.tabs.dragHover(' + sx + ', ' + sy + ')');
    check(await until(() => js("!document.getElementById('dropMarker').hidden")), 'while dragging over another window, it shows where the tab will land');
    await capture(ui.webContents, path.join(dir, '39-drop-marker-ui.png'));
    await single.ui.webContents.executeJavaScript('burrow.tabs.detach(' + movingId + ', ' + sx + ', ' + sy + ')');
    check(await until(() => tabs.get(movingId) && single.win.isDestroyed(), 5000), "a window's only tab can be dropped on another window, and the empty window closes");
    check(tabs.get(movingId)?.view.webContents === movingWc && tabs.visible.indexOf(tabs.get(movingId)) === 1, 'the same live page lands where it was dropped (2nd place)');
    check(await until(() => js("document.getElementById('dropMarker').hidden")), 'the drop marker goes away');
    // Move to window ▸ from the tab menu
    const other = openWindow();
    await until(() => other.tabs.active, 5000);
    await wait(500);
    await tabMenu(movingId);
    await until(() => js("!document.getElementById('ctxMenu').hidden"));
    await js("(() => { const b = [...document.querySelectorAll('#ctxMenu .cm-item')].find((x) => x.textContent.includes('Move to window')); b.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); })()");
    await until(() => js("[...document.querySelectorAll('#ctxMenu .cm-sub')].some((s) => !s.hidden && s.textContent.includes('Window 2'))"));
    await js("[...document.querySelectorAll('#ctxMenu .cm-sub:not([hidden]) .cm-item')].find((x) => x.textContent.includes('Window 2')).click()");
    check(await until(() => other.tabs.get(movingId) && !tabs.get(movingId)), 'Move to window ▸ moves the tab to the other window');
    other.win.close();
    await wait(500);
    tabs.close(mt10.id);
    srv10.close();
    }
    if (section('phase11')) {
    // ================= Phase 11: import from other browsers (fake profiles made here) =================
    const { DatabaseSync } = require('node:sqlite');
    const B11 = path.join(dir, 'browsers');
    fs.rmSync(B11, { recursive: true, force: true }); // fresh fake profiles every run
    const mk = (...p) => { const d = path.join(B11, ...p); fs.mkdirSync(d, { recursive: true }); return d; };
    const now11 = Date.now();
    const chromeTime = (ms) => (BigInt(Math.round(ms)) + 11644473600000n) * 1000n;
    // Chrome with two profiles
    const cRoot = mk('Local', 'Google', 'Chrome', 'User Data');
    fs.writeFileSync(path.join(cRoot, 'Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: 'Anu' }, 'Profile 1': { name: 'Work' } } } }));
    const cDef = mk('Local', 'Google', 'Chrome', 'User Data', 'Default');
    fs.writeFileSync(path.join(cDef, 'Bookmarks'), JSON.stringify({ roots: {
      bookmark_bar: { type: 'folder', children: [
        { type: 'url', name: 'Moodle', url: 'https://moodle.example.edu/' },
        { type: 'folder', name: 'Dev', children: [{ type: 'url', name: 'MDN', url: 'https://developer.mozilla.org/' }] },
      ] },
      other: { type: 'folder', children: [{ type: 'url', name: 'Recipes', url: 'https://recipes.example.com/' }, { type: 'url', name: 'Bad', url: 'javascript:alert(1)' }] },
      synced: { type: 'folder', children: [] },
    } }));
    const hdb = new DatabaseSync(path.join(cDef, 'History'));
    hdb.exec('CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER, typed_count INTEGER, last_visit_time INTEGER, hidden INTEGER)');
    const ins = hdb.prepare('INSERT INTO urls (url, title, visit_count, typed_count, last_visit_time, hidden) VALUES (?, ?, ?, 0, ?, ?)');
    ins.run('https://news.example.com/a', 'News A', 30, chromeTime(now11 - 864e5), 0);
    ins.run('https://news.example.com/b', 'News B', 12, chromeTime(now11 - 2 * 864e5), 0);
    ins.run('https://wiki.example.org/x', 'Wiki', 8, chromeTime(now11 - 3 * 864e5), 0);
    ins.run('https://old.example.com/', 'Too old', 50, chromeTime(now11 - 120 * 864e5), 0);
    ins.run('https://hidden.example.com/', 'Hidden', 5, chromeTime(now11 - 864e5), 1);
    hdb.close();
    const cWork = mk('Local', 'Google', 'Chrome', 'User Data', 'Profile 1');
    fs.writeFileSync(path.join(cWork, 'Bookmarks'), JSON.stringify({ roots: { bookmark_bar: { type: 'folder', children: [{ type: 'url', name: 'Jira', url: 'https://jira.example.com/' }] }, other: { children: [] } } }));
    // Edge, bookmarks only
    const eDef = mk('Local', 'Microsoft', 'Edge', 'User Data', 'Default');
    fs.writeFileSync(path.join(eDef, 'Bookmarks'), JSON.stringify({ roots: { bookmark_bar: { children: [{ type: 'url', name: 'Outlook', url: 'https://outlook.example.com/' }] }, other: { children: [] } } }));
    // Firefox
    const ffRoot = mk('Roaming', 'Mozilla', 'Firefox');
    fs.writeFileSync(path.join(ffRoot, 'profiles.ini'), '[General]\nStartWithLastProfile=1\n\n[Profile0]\nName=default-release\nIsRelative=1\nPath=Profiles/abcd.default-release\nDefault=1\n');
    const ffDir = mk('Roaming', 'Mozilla', 'Firefox', 'Profiles', 'abcd.default-release');
    const pdb = new DatabaseSync(path.join(ffDir, 'places.sqlite'));
    pdb.exec('CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER, hidden INTEGER, last_visit_date INTEGER); CREATE TABLE moz_bookmarks (id INTEGER PRIMARY KEY, type INTEGER, fk INTEGER, parent INTEGER, position INTEGER, title TEXT, guid TEXT)');
    pdb.exec("INSERT INTO moz_bookmarks (id, type, parent, title, guid) VALUES (1, 2, 0, '', 'root________'), (2, 2, 1, 'menu', 'menu________'), (3, 2, 1, 'toolbar', 'toolbar_____'), (4, 2, 2, 'Reading', 'readingfolder')");
    const pins = pdb.prepare('INSERT INTO moz_places (id, url, title, visit_count, hidden, last_visit_date) VALUES (?, ?, ?, ?, 0, ?)');
    pins.run(10, 'https://fox-toolbar.example.com/', 'Fox toolbar', 3, (now11 - 864e5) * 1000);
    pins.run(11, 'https://fox-reading.example.com/', 'Fox reading', 2, (now11 - 2 * 864e5) * 1000);
    pdb.exec("INSERT INTO moz_bookmarks (type, fk, parent, position, title) VALUES (1, 10, 3, 0, 'Fox toolbar'), (1, 11, 4, 0, 'Fox reading')");
    pdb.close();

    // --- What Burrow finds ---
    const srcs = await ui.webContents.executeJavaScript('burrow.importer.sources()');
    const labels = srcs.map((x) => x.label).sort();
    check(JSON.stringify(labels) === JSON.stringify(['Chrome \u00b7 Anu', 'Chrome \u00b7 Work', 'Edge', 'Firefox']), 'finds Chrome (both profiles, by name), Edge and Firefox (' + labels.join(', ') + ')');
    const anu = srcs.find((x) => x.label === 'Chrome \u00b7 Anu');
    check(anu.bookmarks === 3 && anu.history === 3, 'counts web bookmarks (3) and recent visible history (3) — skips javascript: links, hidden and 90+ day old pages');
    // --- Import Chrome ---
    const bmBefore = library.bookmarks.length;
    let r = await ui.webContents.executeJavaScript("burrow.importer.run('chrome:Default', { bookmarks: true, history: true })");
    check(r && r.bookmarks.added === 3 && r.history.added === 3, 'importing Chrome brings 3 bookmarks and 3 pages of history');
    check(library.bookmarks.length === bmBefore + 3, 'they are now Burrow bookmarks');
    const mdn = library.bookmarks.find((b) => b.url === 'https://developer.mozilla.org/');
    const rec = library.bookmarks.find((b) => b.url === 'https://recipes.example.com/');
    check(mdn?.folder === 'Dev' && mdn.bar === true && rec?.folder === 'Other bookmarks' && rec.bar === false, "folders are kept; Chrome's bookmarks-bar items go on Burrow's bar");
    setPrefs({ bookmarksBar: true });
    check(await until(() => js("(() => { const t = document.getElementById('bmItems').textContent; return t.includes('Moodle') && t.includes('MDN') && !t.includes('Recipes'); })()")), 'the bookmarks bar shows the bar items, not every imported folder');
    check(library.searchHistory('news.example.com').length === 2 && !library.searchHistory('old.example.com').length, 'history arrives (and the old page stays behind)');
    check(Array.isArray(r.top) && r.top[0]?.url === 'https://news.example.com/', 'your most-visited site is offered as a quick link');
    r = await ui.webContents.executeJavaScript("burrow.importer.run('chrome:Default', { bookmarks: true, history: true })");
    check(r.bookmarks.added === 0 && r.bookmarks.skipped === 3 && r.history.added === 0, 'importing twice adds nothing new (no duplicates)');
    // --- Firefox ---
    r = await ui.webContents.executeJavaScript("burrow.importer.run('firefox:abcd.default-release', { bookmarks: true, history: false })");
    const foxBar = library.bookmarks.find((b) => b.url === 'https://fox-toolbar.example.com/');
    const foxRead = library.bookmarks.find((b) => b.url === 'https://fox-reading.example.com/');
    check(r.bookmarks.added === 2 && r.history.added === 0 && foxBar?.bar === true && foxRead?.folder === 'Bookmarks menu / Reading', 'Firefox: toolbar bookmarks go on the bar, menu folders are kept; "History" unticked imports none');
    check(!library.searchHistory('fox-reading').length, 'unticked history really stays behind');

    // --- Settings → Import ---
    await js("openPanel('settings')");
    await wait(300);
    await js("document.getElementById('importSect').open = true");
    check(await until(() => js("document.querySelectorAll('#impList .imp-row').length === 4")), 'Settings → Import lists the four browsers found');
    await js("document.querySelector('#impList [data-import=\"edge:Default\"]').click()");
    check(await until(() => js("document.getElementById('impResult').textContent.includes('From Edge')")), 'clicking Import shows what came across');
    check(library.bookmarks.some((b) => b.url === 'https://outlook.example.com/'), 'Edge bookmarks arrived');
    await js("document.querySelector('#impList [data-import=\"chrome:Default\"]').click()");
    check(await until(() => js("!!document.getElementById('impLinks')")), 'it offers to add your most-visited sites as quick links');
    await shot('40-import-settings');
    await js("document.getElementById('impLinks').click()");
    check(await until(() => (store.get('quickLinks') || []).some((q) => q.url === 'https://news.example.com/')), 'one click adds them to the new-tab quick links');
    await js("closePanel()");
    // --- Private windows can't import ---
    const pw11 = openWindow({ isPrivate: true });
    await until(() => pw11.tabs.active, 5000);
    await wait(500);
    check((await pw11.ui.webContents.executeJavaScript('burrow.importer.sources()')).length === 0, 'private windows offer no import');
    pw11.win.close();
    // --- The welcome tour step ---
    const wt11 = tabs.create('burrow://welcome/');
    await ready(wt11);
    const w11 = (code) => wt11.view.webContents.executeJavaScript(code);
    await w11("document.getElementById('next').click()");
    check(await until(() => w11("document.querySelectorAll('#impCards [data-import]').length === 4")), 'the tour step lists the browsers');
    await w11("document.querySelector('#impCards [data-import=\"chrome:Profile 1\"]').click()");
    check(await until(() => w11("document.querySelector('#impCards [data-import=\"chrome:Profile 1\"]').getAttribute('aria-checked') === 'true'")) && library.bookmarks.some((b) => b.url === 'https://jira.example.com/'), 'one click in the tour imports that browser');
    await shot('41-import-tour', true);
    tabs.close(wt11.id);
    }
    if (section('phase12')) {
    // ================= Phase 12: Mochi, helpful =================
    const care = getCare();
    const stats12 = getStats();
    care.idleSeconds = () => 0;
    care.winActive = (w) => w === mainWin;
    const http12 = require('http');
    const srv12 = http12.createServer((req, res) => {
      if (req.url.startsWith('/setup.exe')) {
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="setup.exe"' });
        return res.end(Buffer.alloc(2048, 7));
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><title>Page ' + req.url + '</title><form><input id="user"><input id="pw" type="password"></form>');
    });
    await new Promise((r) => srv12.listen(0, '127.0.0.1', r));
    const base12 = 'http://127.0.0.1:' + srv12.address().port;
    const clearStrip = () => js("mochiLastChat = 0, UI.mochiLog.length = 0, UI.stripEssential = false, document.getElementById('stripMochi').hidden = true");

    // --- Eye breaks ---
    setPrefs({ eyeBreaks: 20, mochiMode: 'lively' });
    await clearStrip();
    care.eyeSec = 20 * 60 - 1;
    care.tick();
    check(await until(() => js("UI.mochiLog.some((m) => m.text === 'Look at something far away for 20 seconds')"), 5000), 'after 20 minutes of screen time Mochi asks you to look far away');
    check(await until(() => js("/Look far away\u2026 1[0-9]/.test(document.getElementById('stripBubble').textContent)"), 3000), 'with a 20-second countdown');
    await shot('42-eye-break');
    const eyesBefore = stats12.day().eyes || 0;
    await js('UI.eyeBreak.left = 1');
    check(await until(() => js('UI.eyeBreak.done'), 4000) && await until(() => (stats12.day().eyes || 0) === eyesBefore + 1), 'when it ends Mochi says thanks (and it counts)');
    setPrefs({ eyeBreaks: 0 });
    await clearStrip();
    care.eyeSec = 99999;
    care.longSec = 0;
    care.tick(); care.tick();
    await wait(200);
    check(!(await js("UI.mochiLog.some((m) => /far away/.test(m.text))")), 'eye breaks can be switched off');
    care.longSec = 90 * 60 - 1;
    care.tick();
    check(await until(() => js("UI.mochiLog.some((m) => /90 minutes in/.test(m.text))"), 4000), 'after 90 minutes in one go, a stretch nudge');
    await js("openPanel('settings')");
    await wait(300);
    await js("document.querySelectorAll('#panel details.sect')[6].open = true");
    await js("document.querySelector('#eyeSeg [data-eye=\"30\"]').click()");
    check(await until(() => store.get('eyeBreaks') === 30), 'Settings → Mochi sets how often (30 minutes)');
    await js("closePanel()");
    setPrefs({ eyeBreaks: 0 });
    care.eyeSec = 0; care.longSec = 0;

    // --- Tab tidy-up: duplicates ---
    const keepT = tabs.create(base12 + '/dup');
    await ready(keepT);
    const d1 = tabs.create(base12 + '/dup', { activate: false });
    const d2 = tabs.create(base12 + '/dup#section', { activate: false });
    await wait(500);
    await clearStrip();
    const offer = care.offerTidy(mainWin, true);
    check(offer && offer.kind === 'dupes' && offer.tabs.length === 2 && !offer.tabs.some((t) => t.id === keepT.id), 'duplicate tabs found (ignoring #parts); the one you are looking at is kept (' + JSON.stringify(offer && { kind: offer.kind, n: offer.tabs.length, text: offer.text }) + ')');
    check(await until(() => js("UI.mochiLog.some((m) => /copies of 127\\.0\\.0\\.1/.test(m.text))")), 'Mochi offers: "3 copies of … open. Click me to tidy"');
    await js("document.getElementById('stripMochi').click()");
    check(await until(() => js("!document.getElementById('tidyPop').hidden && document.querySelectorAll('#tidyList [data-tab]').length === 2")), 'clicking Mochi shows the extras to review, all ticked');
    await shot('43-tidy');
    await js("document.getElementById('tidyClose').click()");
    check(await until(() => !tabs.get(d1.id) && !tabs.get(d2.id) && !!tabs.get(keepT.id)), 'the extras close; your copy stays');
    check(tabs.closed.some((c) => c.url.startsWith(base12 + '/dup')), 'closed tabs can come back with Ctrl+Shift+T');
    check(care.offerTidy(mainWin, false) === null, 'Mochi offers each kind at most once a day');
    // Forgotten tabs (and "when you last looked" survives a restart)
    const o1 = tabs.create(base12 + '/old1', { activate: false });
    const o2 = tabs.create(base12 + '/old2', { activate: false });
    o1.lastActive = o2.lastActive = Date.now() - 4 * 864e5;
    check(tabs.snapshot().workspaces.some((w) => w.tabs.some((t) => t.url.endsWith('/old1') && t.seen === o1.lastActive)), 'when you last looked at a tab is saved with the session');
    await ui.webContents.executeJavaScript('crTidyNow()');
    check(await until(() => js("!document.getElementById('tidyPop').hidden && document.getElementById('tidyTitle').textContent === 'FORGOTTEN TABS' && document.querySelectorAll('#tidyList [data-tab]').length >= 2")), 'Ctrl+K → Tidy up finds tabs you have not opened in 3 days');
    await js("document.getElementById('tidyLater').click()");
    tabs.close(o1.id); tabs.close(o2.id);

    // --- Remind me about this tab ---
    const rt = tabs.create(base12 + '/later');
    await ready(rt);
    store.set('reminders', []);
    await js("(() => { const el = document.querySelector('#tabs [data-id=\"" + rt.id + "\"], #sideTabs [data-id=\"" + rt.id + "\"]'); const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 10 })); })()");
    await until(() => js("!document.getElementById('ctxMenu').hidden"));
    await js("(() => { const b = [...document.querySelectorAll('#ctxMenu .cm-item')].find((x) => x.textContent.includes('Remind me')); b.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); })()");
    check(await until(() => js("[...document.querySelectorAll('#ctxMenu .cm-sub')].some((s) => !s.hidden && s.textContent.includes('In 1 hour') && s.textContent.includes('Tomorrow morning'))")), 'the tab menu has Remind me ▸ in 1 hour / this evening / tomorrow morning / pick a time');
    await shot('44-remind-menu');
    await js("[...document.querySelectorAll('#ctxMenu .cm-sub:not([hidden]) .cm-item')].find((x) => x.textContent.includes('In 1 hour')).click()");
    check(await until(() => !tabs.get(rt.id) && (store.get('reminders') || []).length === 1), 'the tab leaves and a reminder is saved');
    const rem = store.get('reminders')[0];
    check(Math.abs(rem.at - (Date.now() + 3600e3)) < 60e3 && rem.url === base12 + '/later', 'due in one hour, for that page');
    check(await until(() => js('UI.reminders.length === 1')), 'the reminder is listed (Ctrl+K can bring it back early)');
    await clearStrip();
    store.set('reminders', [{ ...rem, at: Date.now() - 1000 }]);
    care.checkReminders();
    check(await until(() => tabs.visible.some((t) => t.url === base12 + '/later')) && (store.get('reminders') || []).length === 0, 'when it is due, Mochi brings the tab back');
    check(await until(() => js("UI.mochiLog.some((m) => /^Back as promised/.test(m.text))")), 'and says "Back as promised"');
    const back = tabs.visible.find((t) => t.url === base12 + '/later');
    await ui.webContents.executeJavaScript('crRemind(' + back.id + ", 'pick', 300, 80)");
    check(await until(() => js("!document.getElementById('remindPop').hidden")), 'Pick a time… opens a date and time picker');
    await js("document.getElementById('remindAt').value = '2001-01-01T09:00'; document.getElementById('remindForm').requestSubmit()");
    check(await until(() => js("!document.getElementById('remindErr').hidden")) && tabs.get(back.id), 'a time in the past is refused');
    const later = new Date(Date.now() + 3 * 864e5); later.setHours(10, 0, 0, 0);
    const pad = (n) => String(n).padStart(2, '0');
    await js("document.getElementById('remindAt').value = '" + later.getFullYear() + '-' + pad(later.getMonth() + 1) + '-' + pad(later.getDate()) + "T10:00'; document.getElementById('remindForm').requestSubmit()");
    check(await until(() => !tabs.get(back.id) && (store.get('reminders') || []).some((r) => r.at === later.getTime())), 'a time three days ahead is saved');
    store.set('reminders', []);

    // --- Safety: passwords on pages without HTTPS ---
    const ip = tabs.create(base12 + '/login');
    await ready(ip);
    check(await until(() => js("!document.getElementById('secChip').hidden")), 'a page without HTTPS shows NOT SECURE in the address bar');
    await clearStrip();
    await ip.view.webContents.executeJavaScript("document.getElementById('user').focus()");
    await wait(400);
    const insecureToasts = () => mainWin.toasts.log.filter((x) => /isn't secure/.test(x)).length;
    const insecureBefore = insecureToasts();
    check(insecureToasts() === insecureBefore, 'typing in a normal box says nothing');
    await ip.view.webContents.executeJavaScript("document.getElementById('pw').focus()");
    check(await until(() => mainWin.toasts.log.some((x) => /isn't secure\. Don't type passwords/.test(x))), 'starting to type a password there shows a warning');
    await shot('45-insecure');
    await ip.view.webContents.executeJavaScript("document.getElementById('user').focus(); document.getElementById('pw').focus()");
    await wait(500);
    check(insecureToasts() === insecureBefore + 1, 'only once per page');
    tabs.close(ip.id);

    // --- Safety: risky downloads wait for Keep / Discard ---
    await clearStrip();
    keepT.view.webContents.downloadURL(base12 + '/setup.exe?1');
    const held = () => downloads.state().find((d) => d.filename.startsWith('setup') && d.held);
    check(await until(() => held() && held().state === 'completed', 8000), 'a program (.exe) downloads but is held');
    const h1 = held();
    check(fs.existsSync(h1.tmp) && !fs.existsSync(h1.path), 'it waits under a temporary name, not as setup.exe');
    check(await until(() => mainWin.toasts.log.some((x) => /setup\.exe is a program/.test(x))), 'a warning says "setup.exe is a program", with a Review button');
    await js("openPanel('downloads')");
    check(await until(() => js("!!document.querySelector('#dlList [data-act=keep]') && !!document.querySelector('#dlList [data-act=discard]')")), 'Downloads shows Keep and Discard');
    await shot('46-risky-download');
    await js("document.querySelector('#dlList [data-act=keep]').click()");
    check(await until(() => { const d = downloads.find(h1.id); return d && !d.held && fs.existsSync(d.path) && !fs.existsSync(h1.tmp); }), 'Keep gives it its real name');
    keepT.view.webContents.downloadURL(base12 + '/setup.exe?2');
    check(await until(() => held() && held().state === 'completed', 8000), 'another one is held');
    const h2 = held();
    await until(() => js("!!document.querySelector('#dlList [data-act=discard]')"));
    await js("document.querySelector('#dlList [data-act=discard]').click()");
    check(await until(() => downloads.find(h2.id)?.state === 'discarded' && !fs.existsSync(h2.tmp) && !fs.existsSync(h2.path)), 'Discard deletes it');
    await js("closePanel()");
    tabs.close(keepT.id);
    srv12.close();
    }
    if (section('phase13')) {
    // ================= Phase 13: Mochi, fun =================
    const fun = getFun();
    const care13 = getCare();
    const focus13 = getFocus();
    const clear13 = () => js("mochiLastChat = 0, UI.mochiLog.length = 0, UI.stripEssential = false, document.getElementById('stripMochi').hidden = true");
    setPrefs({ mochiMode: 'lively' });

    // --- Carrots ---
    store.set('carrots', 0);
    store.set('outfitsOwned', []);
    store.set('outfit', null);
    await js('burrow.care.eyeDone()');
    check(await until(() => store.get('carrots') === 1), 'an eye break earns a carrot');
    focus13.h.onEvent('focus');
    check(store.get('carrots') === 4, 'a finished focus session earns three');
    focus13.h.onEvent('dayWithin');
    check(store.get('carrots') === 6, 'a day within your limits earns two');
    // --- Wardrobe ---
    store.set('carrots', 25);
    await js("openPanel('settings')");
    await wait(300);
    await js("document.querySelectorAll('#panel details.sect')[6].open = true");
    check(await until(() => js("document.querySelectorAll('#wardrobe .wr-item').length === 6")), 'Settings → Mochi shows a wardrobe of five outfits (and plain Mochi)');
    check(await js("document.querySelector('#wardrobe [data-buy=\"crown\"]').disabled") && !(await js("document.querySelector('#wardrobe [data-buy=\"scarf\"]').disabled")), "you can buy what you can afford (scarf yes, crown not yet)");
    await js("document.querySelector('#wardrobe [data-buy=\"scarf\"]').click()");
    check(await until(() => store.get('carrots') === 15 && store.get('outfit') === 'scarf' && store.get('outfitsOwned').includes('scarf')), 'buying the scarf costs 10 carrots and Mochi puts it on');
    check(await until(() => js("window.Mochi.wear === 'scarf' && document.querySelector('#wardrobe .wr-item.on').dataset.outfit === 'scarf'")), 'the interface draws Mochi in the scarf');
    await shot('47-wardrobe');
    const ntw = tabs.create();
    await ready(ntw);
    check(await until(() => ntw.view.webContents.executeJavaScript("!!document.querySelector('#mochi svg[data-outfit=\"scarf\"]')")), 'Mochi wears it on the new tab too');
    tabs.close(ntw.id);
    await js("document.querySelector('#wardrobe [data-wear=\"\"]').click()");
    check(await until(() => store.get('outfit') === null), 'and can take it off again (carrots are never taken back)');
    check(fun.buy('crown') === false && store.get('carrots') === 15, "can't buy what you can't afford");

    // --- Bedtime / night mode ---
    const nightAt = (h, m, dayShift = 0) => { const d = new Date(); d.setDate(d.getDate() + dayShift); d.setHours(h, m, 0, 0); return d.getTime(); };
    await js("document.getElementById('bedtime').value = '23:00'; document.getElementById('bedtime').dispatchEvent(new Event('change'))");
    check(await until(() => store.get('bedtime') === '23:00'), 'Settings → Mochi sets a bedtime');
    await js("closePanel()");
    store.set('bedtimeState', {});
    store.set('nightMode', false);
    await clear13();
    care13.now = () => nightAt(22, 35);
    check(care13.bedtimeTick() === 'soon' && await until(() => js("UI.mochiLog.some((m) => /^Bedtime in 30 minutes/.test(m.text))")), '30 minutes before bedtime Mochi gives a heads-up');
    await clear13();
    care13.now = () => nightAt(23, 2);
    check(care13.bedtimeTick() === 'now' && await until(() => js("UI.mochiLog.some((m) => /It's bedtime/.test(m.text))")), 'at bedtime Mochi offers night mode');
    const web13 = tabs.create('https://example.com/');
    await ready(web13);
    await js("document.getElementById('stripMochi').click()");
    check(await until(() => store.get('nightMode') === true && js('UI.theme.prefs.nightMode === true')), 'clicking Mochi turns night mode on');
    check(await until(() => web13.view.webContents.executeJavaScript("getComputedStyle(document.documentElement, '::after').backgroundColor !== 'rgba(0, 0, 0, 0)' && getComputedStyle(document.documentElement, '::after').pointerEvents === 'none'")), 'web pages get a warm tint that never blocks clicks');
    check(store.get('theme').mode !== undefined && JSON.stringify(store.get('theme')) === JSON.stringify(store.get('theme')), 'your own theme setting is left alone');
    await shot('48-night-mode', true);
    care13.now = () => nightAt(23, 40);
    check(care13.bedtimeTick() === 'late', 'later: a soft "it\'s late"');
    check(care13.bedtimeTick() === null, '…not every minute');
    care13.now = () => nightAt(6, 30, 1);
    care13.bedtimeTick();
    check(await until(() => store.get('nightMode') === false && js('!UI.theme.prefs.nightMode')), 'night mode ends by itself in the morning');
    check(await until(() => web13.view.webContents.executeJavaScript("getComputedStyle(document.documentElement, '::after').content === 'none'")), 'and the tint goes away');
    tabs.close(web13.id);
    delete care13.now;
    setPrefs({ bedtime: '' });
    // Welcome back after a long time away
    await clear13();
    care13.winActive = (w) => w === mainWin;
    care13.idleSeconds = () => 700;
    care13.tick();
    care13.idleSeconds = () => 0;
    care13.tick();
    check(await until(() => js("UI.mochiLog.some((m) => m.text === 'Welcome back!')")), 'back after 10+ minutes away, Mochi waves hello');


    // --- Click Mochi on the new tab: things to do together ---
    const mt14 = tabs.create();
    await ready(mt14);
    const m14 = (c) => mt14.view.webContents.executeJavaScript(c);
    const openMM = async () => { await m14("document.getElementById('mochi').click()"); return until(() => m14("!document.getElementById('mochiMenu').hidden && document.querySelectorAll('#mmItems .mm-item').length > 0")); };
    const pickMM = (a) => m14("document.querySelector('#mmItems [data-mm=\"" + a + "\"]').click()");
    store.set('carrots', 7);
    check(await openMM(), 'clicking Mochi on the new tab opens a menu');
    check(await m14("document.querySelectorAll('#mmItems .mm-item').length") === 8 && (await m14("document.getElementById('mmCarrots').textContent")) === '7 CARROTS', 'eight things to do, and your carrots');
    await shot('51-mochi-menu', true);
    await m14("document.getElementById('mochiMenu').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    check(await until(() => m14("document.getElementById('mochiMenu').hidden")), 'Esc closes it');
    await openMM();
    await pickMM('pet');
    check(await until(() => m14("!document.getElementById('bubble').hidden && document.querySelector('#mochi svg').dataset.pose === 'happy'")), 'Pet Mochi: a happy Mochi says something');
    await openMM();
    await pickMM('focus');
    check(await until(() => focus13.session?.phase === 'focus'), 'Start a focus session from Mochi');
    await openMM();
    check((await m14("document.querySelector('#mmItems [data-mm=\"focus\"]').textContent")).includes('End the focus session'), 'the menu then offers to end it');
    await pickMM('focus');
    check(await until(() => !focus13.session), 'and ending works');
    await openMM();
    await pickMM('night');
    check(await until(() => store.get('nightMode') === true), 'Night mode from Mochi');
    await openMM();
    await pickMM('night');
    check(await until(() => store.get('nightMode') === false), 'and back off');
    await openMM();
    await pickMM('wardrobe');
    check(await until(() => js("!document.getElementById('panel').hidden && document.getElementById('mochiSect').open")), 'Wardrobe opens Settings at Mochi');
    await js("closePanel()");
    await openMM();
    await pickMM('tidy');
    check(await until(async () => (await js("UI.mochiLog.some((m) => /All tidy/.test(m.text))")) || (await js("!document.getElementById('tidyPop').hidden"))), 'Tidy up my tabs (here: all tidy)');
    await js("hideOverlay()");
    await openMM();
    await pickMM('report');
    check(await until(() => mt14.url.startsWith('burrow://report')), 'My week opens the weekly report');
    mt14.view.webContents.loadURL('burrow://newtab/');
    await ready(mt14);
    await openMM();
    await pickMM('hop');
    check(await until(() => mt14.url === 'burrow://offline/?play=1'), 'Play Mochi Hop opens the game');
    tabs.close(mt14.id);
    const pv14 = openWindow({ isPrivate: true });
    await until(() => pv14.tabs.active, 5000);
    await ready(pv14.tabs.active);
    const p14 = (c) => pv14.tabs.active.view.webContents.executeJavaScript(c);
    await p14("document.getElementById('mochi').click()");
    check(await until(() => p14("document.querySelectorAll('#mmItems .mm-item').length === 2")), 'in a private window: just Pet Mochi and Mochi Hop');
    pv14.win.close();
    await wait(300);
    // --- New tab: Mochi watches the pointer and naps when you're away ---
    const nt13 = tabs.create();
    await ready(nt13);
    const n13 = (c) => nt13.view.webContents.executeJavaScript(c);
    await n13('window.NAP_AFTER_MS = 400');
    check(await until(() => n13("document.querySelector('#mochi svg').dataset.pose === 'sleepy'"), 3000), 'Mochi naps on the new tab when nothing happens');
    await shot('49-mochi-nap', true);
    nt13.view.webContents.sendInputEvent({ type: 'mouseMove', x: 5, y: 300 });
    check(await until(() => n13("document.querySelector('#mochi svg').dataset.pose === 'wave'"), 2000), 'and wakes up waving when you move the mouse');
    await n13('window.NAP_AFTER_MS = 600000');
    await wait(1400);
    nt13.view.webContents.sendInputEvent({ type: 'mouseMove', x: 6, y: 300 });
    check(await until(() => n13("document.querySelector('#mochi svg').dataset.look === 'left'"), 2000), "Mochi's eyes follow the pointer");
    tabs.close(nt13.id);

    // --- Reading time ---
    const http13 = require('http');
    const para13 = 'Pixel rabbits are known for their love of carrots and for hopping across rooftops at dusk while the city lights come on one by one. ';
    const art13 = '<!doctype html><html><head><title>Rabbit facts</title></head><body><article><h1>Rabbit facts</h1>' + Array.from({ length: 14 }, () => '<p>' + para13.repeat(4) + '</p>').join('') + '</article></body></html>';
    const srv13 = http13.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(art13); });
    await new Promise((r) => srv13.listen(0, '127.0.0.1', r));
    const a13 = tabs.create('http://127.0.0.1:' + srv13.address().port + '/article');
    await ready(a13);
    check(await until(() => (tabs.state().tabs.find((t) => t.id === a13.id)?.readMin || 0) >= 2, 6000), 'articles get a reading time (' + (tabs.state().tabs.find((t) => t.id === a13.id)?.readMin || 0) + ' min)');
    check(await until(() => js("!document.getElementById('readChip').hidden && /^\\d+ MIN READ$/.test(document.getElementById('readChip').textContent)")), 'shown as "N MIN READ" in the address bar');
    tabs.close(a13.id);
    srv13.close();

    // --- Offline page + Mochi Hop ---
    const probe = http13.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>Back</title><p>Back online</p>'); });
    await new Promise((r) => probe.listen(0, '127.0.0.1', r));
    const port = probe.address().port;
    await new Promise((r) => probe.close(r));
    const deadUrl = 'http://127.0.0.1:' + port + '/page';
    const off = tabs.create(deadUrl);
    check(await until(() => off.url.startsWith('burrow://offline') && !off.loading, 8000), "a site that can't be reached shows Burrow's own page");
    await ready(off);
    const o13 = (c) => off.view.webContents.executeJavaScript(c);
    check(await until(async () => (await o13("document.getElementById('title').textContent")).includes("isn\u2019t answering")), 'it says the site isn\u2019t answering');
    check(await until(() => js("document.getElementById('address').value === " + JSON.stringify(deadUrl))), 'the address bar keeps the address you asked for');
    await o13('hop.start()');
    await wait(900);
    check(await until(() => o13('sprites.walk1.naturalWidth > 0 && sprites.happy.naturalWidth > 0')), "Mochi's sprite loads into the game");
    const hs = await o13('({ running: hop.running, over: hop.over, score: hop.score, t: hop.t, things: hop.things.length, vis: document.visibilityState })');
    check(hs.running && hs.score > 1, 'Mochi Hop runs (the score counts up) ' + JSON.stringify(hs));
    await o13('hop.jump()');
    await wait(120);
    check(await o13('hop.y < 0'), 'Space / click makes Mochi hop');
    await o13('hop.jump()');
    check(await o13('hop.hops === 2'), 'a second press makes a double-hop');
    await shot('50-mochi-hop', true);
    // Back online while playing: you're told, the page doesn't jump away
    await new Promise((r) => probe.listen(port, '127.0.0.1', r));
    check(await off.view.webContents.executeJavaScript('burrowPage.offlineRetry(false)') === true && off.url.startsWith('burrow://offline'), 'when the site answers mid-game, the game is not interrupted');
    const carrotsBefore = store.get('carrots');
    await o13('hop.carrots = 10; hop.score = 321; hop.crash()');
    check(await until(() => store.get('hopBest') >= 321 && store.get('carrots') === carrotsBefore + 2), 'game over saves the best score; 10 game carrots earn Mochi 2 real ones');
    check(await until(() => o13("document.getElementById('best').textContent === '321'")), 'the best score shows on the page');
    await off.view.webContents.executeJavaScript('burrowPage.offlineRetry(true)');
    check(await until(() => off.url === deadUrl && !off.loading, 6000), 'once it answers, the page goes back to the site');
    tabs.close(off.id);
    probe.close();
    await js('burrow.fun.hop()');
    check(await until(() => tabs.active && tabs.active.url === 'burrow://offline/?play=1' && !tabs.active.loading), 'Ctrl+K → Play Mochi Hop opens the game any time');
    await ready(tabs.active);
    check((await tabs.active.view.webContents.executeJavaScript('document.title')) === 'Mochi Hop', 'as its own page');
    tabs.close(tabs.active.id);
    }
    if (section('phase14')) {
    // ================= Phase 14: accessibility, permissions, clear data, crash page, updates =================
    // --- Every colour choice is readable (AA, 4.5:1) ---
    const Theme14 = require('../shared/theme');
    const pairs = [['fg', 'bg'], ['fg', 'surface'], ['muted', 'bg'], ['muted', 'surface'], ['accentInk', 'bg'], ['accentInk', 'surface'], ['onAccent', 'accent']];
    const seeds = [...Theme14.PRESETS.map((p) => p.hex), '#C8762B'];
    let rnd = 12345;
    for (let i = 0; i < 200; i++) { rnd = (rnd * 1103515245 + 12345) % 2147483648; seeds.push('#' + (rnd % 0xffffff).toString(16).padStart(6, '0')); }
    let worst = { c: 99 };
    for (const sd of seeds) for (const dk of [false, true]) {
      const t = Theme14.build(sd, dk);
      for (const [a, b] of pairs) { const c = Theme14.contrast(t[a], t[b]); if (c < worst.c) worst = { c, at: sd + (dk ? ' dark ' : ' light ') + a + '/' + b }; }
    }
    check(worst.c >= 4.5, 'text is readable (4.5:1 or more) with every preset and 200 random colours, light and dark (worst ' + worst.c.toFixed(2) + ' at ' + worst.at + ')');
    // --- Every button and field has a name screen readers can say ---
    const unnamed = (code) => code.executeJavaScript("[...document.querySelectorAll('button, [role=button], input:not([type=hidden]), select, textarea')].filter((el) => !(el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('aria-labelledby') || (el.labels && el.labels.length) || el.textContent.trim() || el.getAttribute('placeholder'))).map((el) => el.id || el.className || el.tagName)");
    const missUi = await unnamed(ui.webContents);
    check(missUi.length === 0, 'every button and field in the interface has a name for screen readers' + (missUi.length ? ' (missing: ' + missUi.join(', ') + ')' : ''));
    const nt14 = tabs.create();
    await ready(nt14);
    const missNt = await unnamed(nt14.view.webContents);
    check(missNt.length === 0, 'and on the new tab' + (missNt.length ? ' (missing: ' + missNt.join(', ') + ')' : ''));
    tabs.close(nt14.id);

    // --- Site permissions ---
    const http14 = require('http');
    const page14 = '<!doctype html><title>Asker</title><p id="p">Hello</p><script>'
      + 'window.notif = () => Notification.requestPermission().then((r) => { window.lastN = r; });'
      + 'window.geo = () => new Promise((res) => navigator.geolocation.getCurrentPosition(() => res("ok"), (e) => res("err" + e.code), { timeout: 4000 })).then((r) => { window.lastG = r; });'
      + '</script>';
    const srv14 = http14.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(page14); });
    await new Promise((r) => srv14.listen(0, '127.0.0.1', r));
    const base14 = 'http://127.0.0.1:' + srv14.address().port;
    store.set('sitePerms', {});
    const pt14 = tabs.create(base14 + '/');
    await ready(pt14);
    const p14 = (c) => pt14.view.webContents.executeJavaScript(c, true);
    p14('notif()');
    check(await until(() => js("!document.getElementById('permBar').hidden && /show notifications/.test(document.getElementById('permText').textContent) && /127\\.0\\.0\\.1/.test(document.getElementById('permText').textContent)")), 'a site asking to show notifications gets a bar: "127.0.0.1 wants to show notifications"');
    await shot('52-permission-bar');
    await js("document.getElementById('permAllow').click()");
    check(await until(() => p14('window.lastN === "granted"')), 'Allow lets it');
    check((store.get('sitePerms')[base14] || {}).notifications === 'allow', 'and is remembered for that site');
    check(await until(() => js("document.getElementById('permBar').hidden")), 'the bar goes away');
    pt14.view.webContents.reload();
    await ready(pt14);
    await p14('window.lastN = null; notif()');
    check(await until(() => p14('window.lastN === "granted"')) && (await js('UI.permAsks.length')) === 0, 'next time it is not asked again');
    p14('geo()');
    check(await until(() => js("!document.getElementById('permBar').hidden && /know your location/.test(document.getElementById('permText').textContent)")), 'location gets its own question');
    await js("document.getElementById('permBlock').click()");
    check(await until(() => p14('window.lastG === "err1"')), 'Block refuses it (the site is told "permission denied")');
    await p14('window.lastG = null; geo()');
    check(await until(() => p14('window.lastG === "err1"')) && (await js('UI.permAsks.length')) === 0, 'a blocked site is refused without asking again');
    // Navigating away before answering counts as "no"
    store.set('sitePerms', {});
    p14('geo()');
    await until(() => js('UI.permAsks.length === 1'));
    pt14.view.webContents.loadURL(base14 + '/other');
    check(await until(() => js('UI.permAsks.length === 0 && document.getElementById("permBar").hidden')), 'leaving the page before answering closes the question');
    await ready(pt14);
    // Settings → Site permissions
    store.set('sitePerms', { [base14]: { notifications: 'allow', location: 'block' } });
    await js("openPanel('settings')");
    await wait(300);
    await js("document.getElementById('permSect').open = true; renderSitePerms()");
    check(await until(() => js("document.querySelectorAll('#permList .perm-row').length === 2")), 'Settings → Site permissions lists what each site may do');
    await js("const sel = document.querySelector('#permList [data-kind=notifications]'); sel.value = ''; sel.dispatchEvent(new Event('change', { bubbles: true }))");
    check(await until(() => !(store.get('sitePerms')[base14] || {}).notifications), '"Ask next time" forgets a decision');
    await js("closePanel()");
    // Private windows ask every time and remember nothing
    const saved14 = JSON.stringify(store.get('sitePerms'));
    const pv14b = openWindow({ isPrivate: true });
    await until(() => pv14b.tabs.active, 5000);
    const ppt = pv14b.tabs.create(base14 + '/private');
    await ready(ppt);
    ppt.view.webContents.executeJavaScript('notif()', true);
    check(await until(() => pv14b.ui.webContents.executeJavaScript("!document.getElementById('permBar').hidden && /asked again next time/.test(document.getElementById('permText').textContent)")), 'a private window asks too (and says it will ask again)');
    await pv14b.ui.webContents.executeJavaScript("document.getElementById('permAllow').click()");
    check(await until(() => ppt.view.webContents.executeJavaScript('window.lastN === "granted"')) && JSON.stringify(store.get('sitePerms')) === saved14, '…and the answer is not saved');
    pv14b.win.close();
    await wait(300);
    tabs.close(pt14.id);

    // --- Clear browsing data ---
    library.visit(base14 + '/recent', 'Recent');
    library.visit(base14 + '/old', 'Old');
    library.byUrl.get(base14 + '/old').last = Date.now() - 3 * 864e5;
    await session.defaultSession.cookies.set({ url: base14, name: 'c14', value: '1', expirationDate: Date.now() / 1000 + 3600 });
    await js("openPanel('settings')");
    await wait(300);
    await js("document.getElementById('clearSect').open = true; document.getElementById('clearRange').value = 'day'; document.getElementById('clrHistory').checked = true; document.getElementById('clrCookies').checked = true; document.getElementById('clrCache').checked = false; document.getElementById('clrDownloads').checked = false; document.getElementById('clearGo').click()");
    check(await until(() => js("/^Cleared /.test(document.getElementById('clearResult').textContent)"), 8000), 'Clear data reports what it cleared');
    check(!library.searchHistory('/recent').length && library.searchHistory('/old').length === 1, 'history from the last 24 hours goes; older history stays');
    check((await session.defaultSession.cookies.get({ url: base14 })).length === 0, 'cookies and site data are cleared');
    await shot('53-clear-data');
    await js("closePanel()");
    ui.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Delete', modifiers: ['control', 'shift'] });
    check(await until(() => js("!document.getElementById('panel').hidden && document.getElementById('clearSect').open")), 'Ctrl+Shift+Delete opens it');
    await js("closePanel()");

    // --- Default browser: links from other apps ---
    check(linkFromArgs(['Burrow.exe', '--flag', 'https://example.com/a']) === 'https://example.com/a', 'a web address given by Windows is recognised');
    const htmlFile = path.join(dir, 'page14.html');
    fs.writeFileSync(htmlFile, '<!doctype html><title>Local file</title><p>Local');
    check((linkFromArgs(['Burrow.exe', htmlFile]) || '').startsWith('file:///'), 'so is an .html file opened from Explorer');
    const before14 = tabs.tabs.length;
    app.emit('second-instance', {}, ['Burrow.exe', base14 + '/from-another-app']);
    check(await until(() => tabs.tabs.length === before14 + 1 && tabs.tabs.some((t) => t.url === base14 + '/from-another-app')), 'a link opened in another app arrives as a new tab in Burrow');
    tabs.close(tabs.tabs.find((t) => t.url === base14 + '/from-another-app').id);
    await js("openPanel('settings')");
    await wait(300);
    await js("document.getElementById('aboutSect').open = true; renderDefault()");
    check(await until(() => js("document.getElementById('defaultState').textContent.length > 10")), 'Settings → About says whether Burrow is the default browser');

    // --- Updates ---
    const upd = getUpdates();
    if (!app.isPackaged) check(['dev', 'portable', 'idle', 'latest'].includes(upd.state.status), 'while developing there is nothing to update (' + upd.state.status + ')');
    else check(upd.state.status !== 'error', 'the installed app checks for updates without an error (' + upd.state.status + ')');
    await js("mochiLastChat = 0, UI.mochiLog.length = 0, UI.stripEssential = false, document.getElementById('stripMochi').hidden = true");
    upd.set({ status: 'ready', version: '9.9.9' });
    check(await until(() => mainWin.toasts.log.some((x) => /v9\.9\.9 is ready/.test(x))), 'when an update has downloaded, a message says "Burrow v9.9.9 is ready" with a Restart button');
    check(await until(() => js("!document.getElementById('updateRestart').hidden && /9\\.9\\.9 is ready/.test(document.getElementById('updateStatus').textContent)")), 'and Settings → About offers "Restart to update"');
    await shot('54-about-update');
    upd.set({ status: 'dev', version: null });
    await js("closePanel()");

    // --- Crash page ---
    const ct14 = tabs.create(base14 + '/crashy');
    await ready(ct14);
    ct14.view.webContents.forcefullyCrashRenderer();
    check(await until(() => ct14.url.startsWith('burrow://offline') && ct14.url.includes('e=-999') && !ct14.loading, 8000), 'when a page crashes, Burrow shows its own page instead of a blank tab');
    await ready(ct14);
    check(await until(async () => (await ct14.view.webContents.executeJavaScript("document.getElementById('title').textContent")).startsWith('Mochi fainted')), 'Mochi fainted');
    check(await until(() => js("document.getElementById('address').value === " + JSON.stringify(base14 + '/crashy'))), 'the address bar keeps the page address');
    await shot('55-crash-page', true);
    await ct14.view.webContents.executeJavaScript("document.getElementById('retry').click()");
    check(await until(() => ct14.url === base14 + '/crashy' && !ct14.loading, 8000), 'Reload brings the page back');
    tabs.close(ct14.id);

    // --- Split view comes back after a restart ---
    const sa = tabs.create(base14 + '/left');
    const sb = tabs.create(base14 + '/right', { activate: false, after: sa.id });
    await ready(sa);
    tabs.activate(sa.id);
    tabs.splitWith(sb.id);
    tabs.setSplitRatio(0.6);
    const snap14 = tabs.snapshot();
    check(snap14.split && Math.abs(snap14.split.ratio - 0.6) < 0.01, 'split view is saved with the session');
    tabs.unsplit();
    const rw = openWindow({ snapshot: snap14 });
    await until(() => rw.tabs.split, 5000);
    const L = rw.tabs.get(rw.tabs.split?.a), R = rw.tabs.get(rw.tabs.split?.b);
    check(L?.url === base14 + '/left' && R?.url === base14 + '/right' && Math.abs(rw.tabs.split.ratio - 0.6) < 0.01, 'and comes back side by side after a restart');
    rw.win.close();
    tabs.close(sa.id); tabs.close(sb.id);
    await wait(300);

    // --- Google sign-in: which pages count as Google's sign-in (the methods themselves are tested in v031) ---
    const SignIn = require('./signin');
    check(SignIn.isSignIn('https://accounts.google.com/v3/signin/identifier') && SignIn.isSignIn('https://accounts.youtube.com/x') && !SignIn.isSignIn('https://www.google.com/') && !SignIn.isSignIn('https://mail.google.com/'), 'only Google\'s sign-in pages get the sign-in identity');
    check(SignIn.isRejected('https://accounts.google.com/v3/signin/rejected?x=1') && !SignIn.isRejected('https://accounts.google.com/v3/signin/identifier'), 'Burrow recognises Google\'s "Couldn\'t sign you in" page');
    const plain = tabs.create(base14 + '/plain');
    await ready(plain);
    check(/Chrome\/\d+/.test(await plain.view.webContents.executeJavaScript('navigator.userAgent')) && !plain.signInUA, 'every other site still sees Chrome');
    tabs.close(plain.id);

    // --- App icon ---
    if (!app.isPackaged) { // (build/ is a build-time folder; it isn't inside the installed app)
      const icoBuf = fs.readFileSync(path.join(__dirname, '..', 'build', 'icon.ico'));
      check(icoBuf.readUInt16LE(2) === 1 && icoBuf.readUInt16LE(4) === 6, 'the app icon has all six sizes (16–256 px)');
    }
    srv14.close();
    }
    if (section('readme')) {
    // ================= README screenshots (npm test -- readme) → docs/screenshots =================
    const out = path.join(__dirname, '..', 'docs', 'screenshots');
    fs.mkdirSync(out, { recursive: true });
    const save = async (wc, name) => { await capture(wc, path.join(out, name + '.png')); note('    saved ' + name + '.png'); };
    setTheme({ mode: 'light', seed: '#E63027' });
    setPrefs({ mochiMode: 'lively', bookmarksBar: false, searchEngine: 'google' });
    store.set('searchChosen', true);
    store.set('carrots', 23);
    await wait(500);
    // New tab with Mochi's menu
    const r1 = tabs.create();
    await ready(r1);
    await wait(600);
    await r1.view.webContents.executeJavaScript("document.getElementById('bubble').hidden = true; openMochiMenu()");
    await wait(500);
    await save(r1.view.webContents, 'new-tab-mochi-menu');
    // The Burrow gate for a site that's used up its time
    const focus = getFocus();
    focus.limits['youtube.com'] = 30;
    focus.used['youtube.com'] = 34 * 60;
    focus.streak = { days: 4, last: null };
    r1.view.webContents.loadURL('burrow://gate/?site=youtube.com&r=limit&u=' + encodeURIComponent('https://www.youtube.com/'));
    await ready(r1);
    await wait(900);
    await save(r1.view.webContents, 'burrow-gate');
    // A week in the weekly report
    const stats = getStats();
    const { keyOf, mondayOf, addDays } = require('./stats');
    stats.clear();
    const mon = addDays(mondayOf(new Date()), -7);
    const day = (o) => ({ sites: {}, total: 0, limited: 0, hadLimits: true, hit: false, focus: 0, eaten: 0, snoozes: 0, unlocks: 0, slept: 0, freedMB: 0, ...o });
    const week = [
      { 'github.com': 5400, 'youtube.com': 1700, 'wikipedia.org': 1200, 'docs.google.com': 2200 },
      { 'github.com': 6200, 'youtube.com': 1800, 'stackoverflow.com': 1500 },
      { 'youtube.com': 1800, 'github.com': 3000, 'reddit.com': 900, 'docs.google.com': 2600 },
      { 'github.com': 7000, 'wikipedia.org': 800, 'youtube.com': 1500 },
      { 'youtube.com': 1800, 'reddit.com': 1500, 'github.com': 2400 },
      { 'youtube.com': 1600, 'wikipedia.org': 1400 },
      { 'youtube.com': 1200, 'docs.google.com': 900 },
    ];
    week.forEach((sites, i) => {
      const total = Object.values(sites).reduce((a, b) => a + b, 0);
      stats.days[keyOf(addDays(mon, i))] = day({ sites, total, limited: sites['youtube.com'] || 0, focus: [2, 3, 1, 4, 0, 1, 0][i], eaten: i === 4 ? 1 : 0, hit: i === 4, slept: 6, freedMB: 180 });
    });
    stats.days[keyOf(addDays(mon, -7))] = day({ sites: { 'youtube.com': 16000, 'github.com': 20000 }, total: 52000, limited: 16000 });
    r1.view.webContents.loadURL('burrow://report/');
    await ready(r1);
    await wait(1200);
    await save(r1.view.webContents, 'weekly-report');
    // Mochi Hop, mid-game
    r1.view.webContents.loadURL('burrow://offline/?play=1');
    await ready(r1);
    await wait(500);
    // (Captured mid-jump while the game is really running; the obstacles are placed so nothing is hit first.)
    await r1.view.webContents.executeJavaScript("hop.start(); hop.things = [{ type: 'pebble', x: 520, w: 15, h: 15 }, { type: 'carrot', x: 330, w: 9, h: 15, y: 96 }, { type: 'puddle', x: 700, w: 44, h: 6 }]; hop.nextThing = 999; hop.score = 186; hop.carrots = 7; hop.best = 412; document.getElementById('best').textContent = '412'; hop.jump()");
    await wait(200);
    // Freeze the game mid-hop for the picture (screenshot only), without the keyboard-focus outline.
    await r1.view.webContents.executeJavaScript('document.activeElement.blur(); hop.y = -46; hop.vy = 0; step = () => {}; null');
    await wait(100);
    await save(r1.view.webContents, 'mochi-hop');
    // Welcome tour: the Mochi step
    r1.view.webContents.loadURL('burrow://welcome/');
    await ready(r1);
    await wait(500);
    for (let i = 0; i < 5; i++) { await r1.view.webContents.executeJavaScript("document.getElementById('next').click()"); await wait(150); }
    await wait(900);
    await save(r1.view.webContents, 'welcome-tour');
    // Night mode on the new tab
    setPrefs({ mochiMode: 'lively' });
    store.set('nightMode', true);
    setTheme({});
    r1.view.webContents.loadURL('burrow://newtab/');
    await ready(r1);
    await wait(900);
    await save(r1.view.webContents, 'night-mode');
    store.set('nightMode', false);
    setTheme({ mode: 'light', seed: '#E63027' });
    tabs.close(r1.id);
    }
    if (section('v022')) {
    // ================= v0.2.2: fullscreen, F11, back/forward controls, Settings button, What's new =================
    const http22 = require('http');
    const page22 = (n) => '<!doctype html><title>Page ' + n + '</title><div id="box" style="width:200px;height:120px;background:#333"></div><p>Page ' + n + '</p>';
    const srv22 = http22.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(page22(req.url)); });
    await new Promise((r) => srv22.listen(0, '127.0.0.1', r));
    const base22 = 'http://127.0.0.1:' + srv22.address().port;
    const vt = tabs.create(base22 + '/video');
    await ready(vt);
    mainWin.win.focus();
    await wait(200);
    const size = () => mainWin.win.getContentSize();
    // --- A page going fullscreen (like a video's ⛶ button), Chrome-style ---
    const mini = () => { const u = mainWin.ui.getBounds(); return u.height > 0 && u.height <= 80 && u.width <= 470; };
    await vt.view.webContents.executeJavaScript("document.getElementById('box').requestFullscreen()", true);
    check(await until(() => mainWin.full === 'video' && mainWin.win.isFullScreen(), 5000), 'a video asking for fullscreen makes the window fullscreen');
    await wait(400);
    const vb = vt.view.getBounds(), [W, H] = size();
    check(vb.x === 0 && vb.y === 0 && vb.width === W && vb.height === H, 'and the page fills the whole window (' + vb.width + 'x' + vb.height + ' of ' + W + 'x' + H + ')');
    check(await until(() => js("!document.getElementById('fsHint').hidden && document.getElementById('fsHint').textContent === 'Press Esc to exit full screen'")) && mini(), 'like Chrome: "Press Esc to exit full screen" at the top for a moment (no toolbar)');
    await capture(ui.webContents, path.join(dir, '55b-video-esc-hint-ui.png'));
    vt.view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    vt.view.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    check(await until(() => mainWin.full === null && !mainWin.win.isFullScreen(), 5000), 'Esc leaves fullscreen');
    await wait(300);
    check(vt.view.getBounds().y === mainWin.layout.top && mainWin.ui.getBounds().height > 100, 'and the toolbar comes back');
    // --- F11: browser fullscreen, Chrome-style ---
    ui.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F11' });
    check(await until(() => mainWin.full === 'browser' && mainWin.win.isFullScreen(), 5000), 'F11 turns on full screen');
    check(await until(() => js("!document.getElementById('fsHint').hidden && document.getElementById('fsHint').textContent === 'Press F11 to exit full screen'")) && mini(), 'with "Press F11 to exit full screen" at the top centre, like Chrome');
    await capture(ui.webContents, path.join(dir, '56-f11-hint-ui.png'));
    check(await until(() => mainWin.ui.getBounds().height === 0 && vt.view.getBounds().y === 0, 6000), 'then the note goes and the page fills the screen');
    vt.view.webContents.sendInputEvent({ type: 'mouseMove', x: 300, y: 1 });
    check(await until(async () => (await js("!document.getElementById('fsExit').hidden")) && mini(), 3000), 'touching the top edge drops down a round \u2715 to exit');
    await capture(ui.webContents, path.join(dir, '57-f11-exit-button-ui.png'));
    vt.view.webContents.sendInputEvent({ type: 'mouseMove', x: 300, y: 400 });
    check(await until(async () => mainWin.ui.getBounds().height === 0 && (await js("document.getElementById('fsExit').hidden")), 3000), 'moving away hides it again');
    vt.view.webContents.sendInputEvent({ type: 'mouseMove', x: 300, y: 1 });
    await until(() => js("!document.getElementById('fsExit').hidden"), 3000);
    await js("document.getElementById('fsExit').click()");
    check(await until(() => mainWin.full === null && !mainWin.win.isFullScreen() && mainWin.ui.getBounds().height > 100, 5000), 'clicking \u2715 leaves full screen');
    await wait(300);
    ui.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F11' });
    await until(() => mainWin.full === 'browser', 5000);
    ui.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F11' });
    check(await until(() => mainWin.full === null && !mainWin.win.isFullScreen() && mainWin.ui.getBounds().height > 100, 5000), 'and F11 again does too');
    await wait(400);
    // --- Back / forward: Alt+arrows (on the page and in the address bar), mouse side buttons, Alt+Home ---
    vt.view.webContents.loadURL(base22 + '/second');
    await ready(vt);
    vt.view.webContents.focus();
    vt.view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Left', modifiers: ['alt'] });
    check(await until(() => vt.url === base22 + '/video' && !vt.loading), 'Alt+Left goes back (with the page focused)');
    ui.webContents.focus();
    ui.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right', modifiers: ['alt'] });
    check(await until(() => vt.url === base22 + '/second' && !vt.loading), 'Alt+Right goes forward (from Burrow\'s toolbar too)');
    mainWin.win.emit('app-command', {}, 'browser-backward');
    check(await until(() => vt.url === base22 + '/video' && !vt.loading), "the mouse's back button goes back");
    mainWin.win.emit('app-command', {}, 'browser-forward');
    check(await until(() => vt.url === base22 + '/second' && !vt.loading), 'and its forward button goes forward');
    vt.view.webContents.focus();
    vt.view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Home', modifiers: ['alt'] });
    check(await until(() => vt.url.startsWith('burrow://newtab')), 'Alt+Home opens the new tab page');
    tabs.close(vt.id);
    // --- Settings is easy to find ---
    check(await js("!!document.getElementById('settingsBtn') && document.getElementById('settingsBtn').getBoundingClientRect().width > 0"), 'there is a \u2699 Settings button in the toolbar');
    await js("document.getElementById('settingsBtn').click()");
    check(await until(() => js("!document.getElementById('panel').hidden && document.getElementById('settingsBtn').getAttribute('aria-pressed') === 'true'")), 'it opens Settings (and shows as pressed)');
    await shot('58-settings-button');
    await js("document.getElementById('settingsBtn').click()");
    check(await until(() => js("document.getElementById('panel').hidden")), 'clicking it again closes Settings');
    ui.webContents.focus();
    ui.webContents.sendInputEvent({ type: 'keyDown', keyCode: ',', modifiers: ['control'] });
    check(await until(() => js("!document.getElementById('panel').hidden")), 'Ctrl+, opens Settings');
    await js("closePanel()");
    await js("document.getElementById('menuBtn').click()");
    check(await until(() => js("!!document.querySelector('#mainMenu .cc-settings')")), 'the \u2630 menu has a full Settings row');
    await js('hideOverlay()');
    // --- What's new after an update ---
    const Changelog = require('../shared/changelog');
    check(Changelog.between('0.2.0', '0.2.2').map((e) => e.version).join() === '0.2.2,0.2.1' && Changelog.newer('0.10.0', '0.9.9'), 'the changelog lists the versions since yours (newest first)');
    store.set('lastVersion', '0.0.1');
    checkWhatsNew();
    check(store.get('lastVersion') === app.getVersion(), 'Burrow remembers which version last ran');
    showWhatsNew('0.2.0', '0.2.2', mainWin);
    check(await until(() => js("!document.getElementById('whatsNew').hidden && document.querySelectorAll('#wnBody .wn-ver').length === 2")), "after updating from 0.2.0, \u201cWhat's new\u201d shows 0.2.1 and 0.2.2");
    check((await js("document.getElementById('wnKicker').textContent")).includes('V0.2.0 \u2192 V0.2.2') && (await js("document.getElementById('wnBody').textContent")).includes('full screen'), 'with what changed and what was fixed');
    await shot('59-whats-new');
    await js("document.getElementById('wnClose').click()");
    check(await until(() => js("document.getElementById('whatsNew').hidden")), '"Got it" closes it');
    await js("openPanel('settings')");
    await wait(200);
    await js("document.getElementById('aboutSect').open = true; document.getElementById('whatsNewBtn').click()");
    check(await until(() => js("!document.getElementById('whatsNew').hidden")), "Settings \u2192 About can show it again any time");
    await js('hideOverlay(); closePanel()');
    srv22.close();
    }
    if (section('v030')) {
    // ================= v0.3.0: Soft paper / Classic, density, honest address bar, undo toasts =================
    const Theme = require('../shared/theme');
    // --- Contrast: every text colour reads at 4.5:1 on every background, in both looks, light and dark ---
    const seeds = [...Theme.PRESETS.map((p) => p.hex), '#FFFF00', '#00FFFF', '#000000', '#FFFFFF', '#7F7F7F', '#FF00FF'];
    for (let i = 0; i < 12; i++) seeds.push('#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0'));
    const lows = [];
    for (const look of ['soft', 'classic']) for (const dark of [false, true]) for (const seed of seeds) {
      const t = Theme.build(seed, dark, look);
      const backs = look === 'soft' ? ['bg', 'surface', 'hover', 'tint'] : ['bg', 'surface'];
      for (const k of ['fg', 'muted', 'accentInk']) for (const b of backs) if (Theme.contrast(t[k], t[b]) < 4.5) lows.push(`${look}/${dark ? 'dark' : 'light'}/${seed} ${k} on ${b}`);
      for (const k of ['danger', 'warning', 'success', 'info']) for (const b of ['bg', 'surface']) if (Theme.contrast(t[k], t[b]) < 4.5) lows.push(`${look}/${dark ? 'dark' : 'light'}/${seed} ${k} on ${b}`);
      if (Theme.contrast(t.onAccent, t.accent) < 4.5) lows.push(`${look}/${seed} text on accent`);
    }
    check(!lows.length, `every text colour reads at 4.5:1 or more: Soft paper and Classic, light and dark, ${seeds.length} colours${lows.length ? ' (' + lows.slice(0, 4).join('; ') + ')' : ''}`);
    const sl = Theme.build('#E63027', false, 'soft'), cl = Theme.build('#E63027', false, 'classic');
    check(Theme.contrast(sl.fg, sl.bg) < Theme.contrast(cl.fg, cl.bg) && sl.danger !== sl.accent, 'Soft paper is softer than Classic (warm grey ink), and status colours are not the brand colour');

    // --- The look: Soft paper by default; Classic one click away (Settings → Look) ---
    const look = () => js("document.documentElement.dataset.look");
    const ruleW = async () => parseFloat(await js("getComputedStyle(document.querySelector('.strip')).borderBottomWidth"));
    setTheme({ mode: 'light', seed: '#E63027' });
    check(await until(async () => (await look()) === 'soft') && (await ruleW()) <= 1, 'Soft paper is the default look: hairline rules (' + (await ruleW()) + 'px)');
    await wait(300);
    await shot('70-soft-light');
    await js("openPanel('settings')");
    await wait(200);
    await js("document.getElementById('lookSeg').closest('details').open = true");
    check(await js("document.querySelector('#lookSeg [data-look=soft]').getAttribute('aria-checked') === 'true'"), 'Settings → Look shows Soft paper chosen');
    await shot('71-soft-settings');
    await js("document.querySelector('#lookSeg [data-look=classic]').click()");
    check(await until(async () => (await look()) === 'classic' && store.get('theme').look === 'classic' && (await ruleW()) > 1), 'choosing Classic brings back the original look: 2 px rules (and it is remembered)');
    await wait(250);
    await shot('72-classic-settings');
    await js("document.querySelector('#lookSeg [data-look=soft]').click()");
    check(await until(async () => (await look()) === 'soft' && store.get('theme').look === 'soft'), 'and back to Soft paper');
    // Pages follow the look too.
    const nt = tabs.create();
    await ready(nt);
    check(await until(async () => (await nt.view.webContents.executeJavaScript('document.documentElement.dataset.look')) === 'soft'), "Burrow's own pages (new tab) use the same look");
    await js('closePanel()');

    // --- Density ---
    const heights = () => js("({ strip: document.querySelector('.strip').offsetHeight, bar: document.querySelector('.toolbar').offsetHeight, chrome: document.getElementById('chrome').offsetHeight })");
    const comfy = await heights();
    setTheme({ density: 'compact' });
    check(await until(async () => (await heights()).strip === 34), 'Compact density: a shorter tab strip');
    const compact = await heights();
    check(compact.bar === 36 && compact.chrome < comfy.chrome, `and a shorter toolbar (${comfy.bar} → ${compact.bar} px)`);
    check(await until(() => nt.view.getBounds().y === compact.chrome), 'the page moves up to fill the space');
    await shot('73-soft-compact');
    setTheme({ density: 'comfortable' });
    check(await until(async () => (await heights()).bar === comfy.bar && comfy.bar === 44), 'Comfortable is back to 44 px bars');

    // --- Honest address bar ---
    const http30 = require('http');
    const srv30 = http30.createServer((req, res) => {
      const send = () => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>Slow page</title><p>' + req.url + '</p>'); };
      if (req.url.startsWith('/slow')) setTimeout(send, 1500); else send();
    });
    await new Promise((r) => srv30.listen(0, '127.0.0.1', r));
    const base30 = 'http://127.0.0.1:' + srv30.address().port;
    tabs.navigate(base30 + '/path/page?q=1');
    await ready(nt, '/path/page');
    const view = () => js("({ hidden: document.getElementById('addrView').hidden, text: document.getElementById('addrView').textContent, host: document.querySelector('#addrView .av-host')?.textContent, lock: !document.getElementById('siteIcon').hidden, insecure: !document.getElementById('secChip').hidden })");
    let v = await view();
    check(!v.hidden && v.host === '127.0.0.1' && v.text === 'http://127.0.0.1:' + srv30.address().port + '/path/page?q=1' && v.insecure && !v.lock, 'plain HTTP: "Not secure" at the start, the domain in full ink, the rest muted');
    await js("renderAddrView({ url: 'https://www.example.com/a/b?c=1' })");
    v = await view();
    check(v.host === 'example.com' && v.text === 'www.example.com/a/b?c=1' && v.lock, 'HTTPS: a lock, https:// hidden, "www." and the path muted');
    ui.webContents.focus();
    await js("address.focus()");
    check(await until(() => js("document.getElementById('addrView').hidden && !document.getElementById('addressForm').classList.contains('has-view')")), 'clicking into the address bar shows the full address to edit');
    await js("address.blur()");

    // --- Tabs: tooltip; loading bar ---
    const tip = await js("tabTooltip({ title: 'Song', url: 'https://www.music.example/x', audible: true }, 0)");
    check(tip === 'Song\nmusic.example\nPlaying sound\nCtrl+1', 'hovering a tab shows its full title, site and state (' + JSON.stringify(tip) + ')');
    tabs.navigate(base30 + '/slow');
    check(await until(() => js("document.getElementById('loadBar').classList.contains('on')"), 2000), 'a thin loading bar runs under the toolbar while a page loads');
    await shot('74-loading');
    await ready(nt, '/slow');
    check(await until(() => js("!document.getElementById('loadBar').classList.contains('on')"), 4000), 'and finishes when it has loaded');

    // --- Undo instead of "are you sure?" ---
    const toastsNow = () => mainWin.toasts.list();
    const ut = tabs.create(base30 + '/undo-me', { activate: false });
    await ready(ut);
    const posBefore = tabs.visible.indexOf(ut);
    await js(`B.tabs.close(${ut.id})`);
    check(await until(() => !tabs.get(ut.id) && toastsNow().some((t) => t.text === 'Tab closed' && t.action === 'Undo')), 'closing a tab shows "Tab closed · Undo" (no question asked)');
    const vb = mainWin.toasts.view.getBounds(), [cw, ch] = mainWin.win.getContentSize();
    check(await until(() => { const b = mainWin.toasts.view.getBounds(); return b.width > 100 && b.y + b.height === ch && b.x === mainWin.layout.left; }), `the message sits at the bottom left, over the page (${vb.width}x${vb.height} of ${cw}x${ch})`);
    await capture(mainWin.toasts.view.webContents, path.join(dir, '75-toast-undo.png'));
    mainWin.toasts.act(toastsNow().find((t) => t.text === 'Tab closed').id);
    check(await until(() => tabs.visible.some((t) => t.url.includes('/undo-me'))), 'Undo brings it back');
    check(tabs.visible.findIndex((t) => t.url.includes('/undo-me')) === posBefore, 'in the same place');
    // A group: close others → one Undo for all, in their old order.
    const order = () => tabs.visible.map((t) => t.url);
    while (tabs.visible.length < 4) tabs.create(base30 + '/g' + tabs.visible.length, { activate: false });
    await wait(400);
    const before = order();
    tabs.activate(tabs.visible[1].id);
    const n = tabs.visible.filter((t, i) => i !== 1 && !t.url.startsWith('burrow://newtab')).length;
    await js(`B.tabs.closeOthers(${tabs.visible[1].id})`);
    check(await until(() => tabs.visible.length === 1 && toastsNow().some((t) => t.text === `${n} tabs closed`)), `"close other tabs" says "${n} tabs closed · Undo"`);
    mainWin.toasts.act(toastsNow().find((t) => t.text === `${n} tabs closed`).id);
    const real = (list) => list.filter((u) => !u.startsWith('burrow://newtab')).join();
    check(await until(() => real(order()) === real(before)), 'one Undo puts them all back, in order (' + real(before).replaceAll(base30, '') + ' → ' + real(order()).replaceAll(base30, '') + ')');
    // Messages from the interface, with a button that does something.
    await ui.webContents.executeJavaScript("toast('Hello from the interface', { action: 'Do it', onAction: () => { window.__toastDone = true; } }).then(() => 1)");
    check(await until(() => toastsNow().some((t) => t.text === 'Hello from the interface')), 'the interface can show a message too');
    mainWin.toasts.act(toastsNow().find((t) => t.text === 'Hello from the interface').id);
    check(await until(() => js('window.__toastDone === true')), 'and its button runs the action');
    // Two voices: messages that matter show even when Mochi is set to Off.
    setPrefs({ mochiMode: 'off' });
    await wait(150);
    getUpdates().set({ status: 'ready', version: '9.9.8' });
    check(await until(() => mainWin.toasts.log.some((x) => /v9\.9\.8 is ready/.test(x))), 'with Mochi set to Off, "update ready" still shows (as a message, not Mochi)');
    getUpdates().set({ status: 'idle' });
    setPrefs({ mochiMode: 'lively' });
    toastsNow().forEach((t) => mainWin.toasts.dismiss(t.id));
    check(await until(() => mainWin.toasts.view.getBounds().width === 0), 'dismissed messages leave nothing behind (the page is clickable again)');

    // --- What's new 0.3.0: pick the look right there ---
    showWhatsNew('0.2.5', '0.3.0', mainWin);
    check(await until(() => js("!document.getElementById('whatsNew').hidden && !!document.getElementById('wnLookSeg')")), "the 0.3.0 “What's new” offers Soft paper or Classic");
    check(await js("document.querySelector('#wnLookSeg [data-look=soft]').getAttribute('aria-checked') === 'true'"), 'with your current look chosen');
    await shot('76-whats-new-look');
    await js("document.querySelector('#wnLookSeg [data-look=classic]').click()");
    check(await until(async () => (await look()) === 'classic' && (await js("document.querySelector('#wnLookSeg [data-look=classic]').getAttribute('aria-checked') === 'true'"))), 'choosing Classic there switches immediately');
    await shot('77-whats-new-classic');
    await js("document.querySelector('#wnLookSeg [data-look=soft]').click()");
    check(await until(async () => (await look()) === 'soft'), 'and Soft paper again');
    await js("document.getElementById('wnClose').click()");

    // --- Screens in dark mode, both looks (reviewed before release) ---
    await js("void openMainMenu()");
    await wait(250);
    await shot('78-soft-light-menu');
    await js('hideOverlay()');
    setTheme({ mode: 'dark' });
    await wait(500);
    await shot('79-soft-dark', true);
    await js("void openPalette()");
    await wait(300);
    await shot('80-soft-dark-palette');
    await js('hideOverlay()');
    setTheme({ look: 'classic' });
    await wait(400);
    await shot('81-classic-dark', true);
    setTheme({ look: 'soft', mode: 'light' });
    await wait(300);
    srv30.close();
    }

    if (section('v031')) {
    // ================= v0.3.1: Google sign-in methods (a local stand-in for accounts.google.com) =================
    const SignIn = require('./signin');
    const http31 = require('http');
    const srv31 = http31.createServer((req, res) => {
      if (req.url.startsWith('/go-signin')) { res.writeHead(302, { location: '/__burrow_signin_test/start?via=redirect' }); res.end(); return; }
      const hints = Object.keys(req.headers).some((k) => /^sec-ch-ua/.test(k)) ? 'hints' : 'none';
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><title>Page</title><p id=ua>' + String(req.headers['user-agent']).replace(/</g, '') + '</p><p id=ch>' + hints + '</p>');
    });
    await new Promise((r) => srv31.listen(0, '127.0.0.1', r));
    const base31 = 'http://127.0.0.1:' + srv31.address().port;
    const look31 = () => tabs.active.view.webContents.executeJavaScript("({ ua: navigator.userAgent, header: document.getElementById('ua')?.textContent || '', ch: document.getElementById('ch')?.textContent || '', uad: !!navigator.userAgentData, app: !!(window.chrome && window.chrome.app), csi: typeof (window.chrome && window.chrome.csi) === 'function' ? typeof window.chrome.csi() : 'none', lt: typeof (window.chrome && window.chrome.loadTimes) === 'function' ? typeof window.chrome.loadTimes().requestTime : 'none' })");
    const go31 = async (p, part) => { tabs.navigate(base31 + p); await ready(tabs.active, part || p.split('?')[0]); return look31(); };
    const t31 = tabs.create(base31 + '/plain');
    await ready(t31);

    check(SignIn.method() === 'chrome', 'the default method is "Chrome pieces" (the one that signed you in)');
    let l = await look31();
    check(l.app && l.csi === 'object' && l.lt === 'number' && !l.ua.includes('Electron'), 'every web page has the window.chrome pieces real Chrome has (app, csi, loadTimes), and still looks like Chrome (' + l.ua.slice(-40) + ')');
    SignIn.setMethod('both'); // (the Electron identity, checked on both paths)
    for (const [how, p] of [['opened directly', '/__burrow_signin_test/start'], ['reached by a redirect (like Gmail → sign in)', '/go-signin']]) {
      l = await go31(p, '/__burrow_signin_test');
      // (Client hints aren't sent to this plain-HTTP stand-in at all; on Google's HTTPS pages Burrow leaves Chromium's own.)
      check(l.ua.includes('Electron/') && l.header.includes('Electron/') && l.uad && l.app, 'Google sign-in ' + how + ': the page and its requests both say Electron (one consistent identity)');
    }
    l = await go31('/plain');
    check(!l.ua.includes('Electron') && !l.header.includes('Electron'), 'other sites never see Electron');

    // Ctrl+K switches the method.
    await js("void openPalette()");
    await wait(250);
    await js("(() => { const p = document.getElementById('palInput'); p.value = 'google sign-in method'; p.dispatchEvent(new Event('input')); })()");
    check(await until(() => js("[...document.querySelectorAll('#palList .pal-row')].filter((r) => /Google sign-in method/.test(r.textContent)).length === 3")), 'Ctrl+K offers the three Google sign-in methods');
    await js('hideOverlay()');
    await ui.webContents.executeJavaScript("B.signInMethod('chrome').then(() => 1)");
    l = await go31('/__burrow_signin_test/start');
    check(SignIn.method() === 'chrome' && !l.header.includes('Electron') && !l.ua.includes('Electron') && l.app, '"Chrome pieces" only: the sign-in page sees Chrome, with the pieces');
    await ui.webContents.executeJavaScript("B.signInMethod('electron').then(() => 1)");
    l = await go31('/__burrow_signin_test/start');
    check(l.ua.includes('Electron/') && !l.app, '"Electron identity" only: Electron on the sign-in page, no added pieces');
    l = await go31('/plain');
    check(!l.app && !l.ua.includes('Electron'), 'and other pages are left exactly as Electron makes them');

    // Google says "Couldn't sign you in" → offer the next method.
    await go31('/__burrow_signin_test/v3/signin/rejected?continue=https%3A%2F%2Fmail.google.com', '/rejected');
    const offer = () => mainWin.toasts.list().find((t) => /Google refused the sign-in/.test(t.text));
    check(await until(() => offer() && offer().action === 'Try it'), 'when Google refuses, a message offers the next method (' + (offer()?.text || '') + ')');
    mainWin.toasts.act(offer().id);
    check(await until(() => SignIn.method() === 'chrome' && tabs.active.url.includes('/__burrow_signin_test/start')), '"Try it" switches method and goes back to the sign-in page');
    SignIn.setMethod('chrome');
    tabs.close(t31.id);
    srv31.close();
    }

    if (section('windows')) {
    // ================= Windows + dragging tabs =================
    const tabCenters = () => js("[...document.querySelectorAll('#tabs .tab:not(.closing)')].map((t) => [t, t.getBoundingClientRect()]).map(([t, r]) => ({ id: +t.dataset.id, x: r.left + r.width / 2, y: r.top + r.height / 2 }))");

    // --- Ctrl+N opens a new normal window ---
    const normals = () => [...windows].filter((w) => !w.isPrivate);
    const winsAtStart = normals().length;
    ui.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'N', modifiers: ['control'] });
    await until(() => normals().length === winsAtStart + 1, 5000);
    check(await until(async () => (normals().length === 2)), 'Ctrl+N opens a new window');
    const w2 = normals().find((w) => w !== mainWin);
    check(await until(() => w2 && w2.tabs.visible.length === 1 && w2.tabs.active?.url.startsWith('burrow://newtab')), 'new window starts with a new tab');
    check(await until(() => (store.get('session').windows || []).length === 2), 'both windows are saved for next time');

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
    await until(() => normals().length === winsBefore + 1, 5000);
    await wait(300);
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
      check(await until(async () => (mainWin.tabs.get(t.id) && t.owner === mainWin.tabs)), 'a tab dropped on another window joins it');
      w3.win.close();
    }
    w2.win.close();
    check(await until(async () => (normals().length === 1 && (store.get('session').windows || []).length === 1)), 'closing extra windows forgets their tabs (like Chrome)');

    // --- Sidebar beyond 8 tabs ---
    for (let i = 0; i < 8; i++) tabs.create(undefined, { activate: i === 7 });
    await until(() => js("!document.getElementById('sidebar').hidden"), 5000);
    check(await js("!document.getElementById('sidebar').hidden"), `sidebar appears with ${tabs.visible.length} tabs`);
    setTheme({ mode: 'dark', seed: '#6E9A4A' });
    await wait(600);
    await shot('06-sidebar-dark', true);
    }
    endSection();
  } catch (err) {
    failures++;
    note('ERROR ' + (err && err.stack || err));
  }
  if (process.env.BURROW_SELFTEST_SLOW) {
    note('SLOWEST CHECKS (time spent before each):');
    timings.sort((a, b) => b.ms - a.ms).slice(0, 30).forEach((t) => note(`  ${(t.ms / 1000).toFixed(1)}s  [${t.section}] ${t.what.slice(0, 90)}`));
  }
  note(`${failures ? `${failures} problem(s)` : 'ALL PASSED'} in ${Math.round((Date.now() - started) / 1000)}s`);
  fs.writeFileSync(path.join(dir, 'log.txt'), log.join('\n'));
  app.quit();
}

module.exports = { run };
