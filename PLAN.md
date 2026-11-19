# Plan: Burrow, a Swiss-grid + pixel desktop browser with Mochi the companion

## Context
The user wants their own desktop browser that has the important everyday features, looks great and is fun. Doomscroll reduction is **one feature among several, not the USP**. The product's identity is a crisp Swiss-grid design with pixel accents and a pixel mascot companion, **Mochi**. Project folder: `D:\CollegeTB\WOAHDAMN` (empty). The user is "vibecoding" and wants to stay informed, so a plain-language project journal is kept up to date throughout. The design was iterated over several rounds of mockups and is now **locked**.

## Locked decisions
| Area | Decision | Why |
|---|---|---|
| Platform | Electron (Chromium), Windows first, plain HTML/CSS/JS, no build step | Real engine, full UI control, simple to run and change |
| Name | **Burrow** browser, mascot **Mochi** (round bunny-mochi pixel blob, blush cheeks) | Chosen from a shortlist |
| Design language | Swiss grid + pixel: 12-column structure (grid lines hidden, optional toggle), flush-left type, 2px black rules, numbered tabs, one accent per screen | Picked after 4 rounds of mockups |
| Fonts | Inter Tight (UI/body) + Silkscreen (numbers, labels, clock only, min 11px), both OFL and bundled locally | Clarity first, with a pixel accent |
| Theming | Chrome-style "Customize Burrow" panel: preset swatches (Signal red, Tomato, Klein, Matcha, Plum, Teal, Amber, Graphite), custom colour, or Windows accent colour; Light / Dark / System. All tokens are generated from one seed colour in HSL, with a contrast check on text that sits on the accent colour. Default seed: Signal red | User asked for Chrome-like palette choice |
| New tab | Search is the hero ("What are we looking for?" + bordered search bar with a Ctrl+L hint), small pixel clock, quick links, one gentle stat line, Mochi only when there's a reason | Review: search over clock, less guilt |
| Tabs | Horizontal numbered tabs (01, 02… mapped to Ctrl+1–9), overflowing into a vertical sidebar beyond 8; workspace switcher at the left; custom Windows title bar | Swiss index look, plus useful numbering |
| Mochi | Companion everywhere but only when relevant (limits, downloads, streaks, focus sessions, greetings); 12 fps sprite animation, idle bob, respects reduced motion, quiet mode, rate-limited speech bubbles | Fun without nagging |
| v1 features | Tabs, workspaces, split view, notes panel (+ export to .md), reader mode, Ctrl+K command palette, tab sleeping ("ZZ"), focus sessions (Pomodoro), picture-in-picture, bookmarks/history/downloads, find, zoom, private window, focus tools (time limits → Mochi closes the tab), weekly Burrow report | Picked by the user |
| Deferred to v2 | Chrome extensions, Mochi outfits, scroll desaturation, sync, background images | Keeps v1 focused |

## Step 0: project journal (first file, kept updated)
`D:\CollegeTB\WOAHDAMN\PROJECT_JOURNAL.md`, in plain language, with these sections:
- Pitch
- How it works (simple architecture diagram)
- Decision log (date, decision, options considered, why), filled with everything above, including the design rounds (4 aesthetics → cozy pixel → Swiss + pixel → review → Chrome-style picker)
- Design spec (tokens, fonts, layout rules, Mochi poses)
- Feature status table
- File map
- How to run, build and test
- Glossary (Electron, main process, renderer, IPC, preload, WebContentsView…)
- Known issues / next up
Update it after every phase and every new decision.

## Architecture
- `BaseWindow` + a UI `WebContentsView` (chrome: tabs, toolbar, panels) + one `WebContentsView` per tab + a transparent overlay view (command palette, time's-up screens, mindful pause).
- `contextIsolation` and `sandbox` are on, `nodeIntegration` is off. The UI talks to the main process through `contextBridge` preloads. Web tabs get a tiny preload that only reports scroll and activity.
- Persistence: JSON in `app.getPath('userData')`, written safely (temp file, then rename).
- Theme engine: `ui/theme.js` turns the seed colour + mode into CSS custom properties on `:root`. It is shared by the UI, the new-tab page and the overlay, and Mochi's colours read the same tokens.

## File layout
```
package.json  PROJECT_JOURNAL.md
main/   main.js tabs.js workspaces.js store.js tracker.js focus.js sleeper.js menu.js downloads.js
preload/ ui-preload.js tab-preload.js
ui/     index.html ui.css ui.js theme.js palette.js (Ctrl+K) split.js notes.js reader.js
        mascot.js mascot-sprites.js  overlay.html/.js  newtab.html/.js  settings.html/.js (Customize Burrow)
        report.html/.js  fonts/ (Inter Tight, Silkscreen)  vendor/readability.js
```

## Phases
1. ✅ Journal + scaffold: window, custom title bar, single tab navigation, theme engine with the Customize panel.
2. ✅ Numbered tabs + overflow sidebar, workspaces, omnibox, shortcuts, session restore.
3. ✅ Bookmarks, history, downloads, find, zoom, private window, PiP (+ multiple windows, tab dragging, bug reports).
4. ✅ Ctrl+K command palette **+ AI layer 1 "Ask AI"**: address bar, new tab (Search | Ask toggle), Ctrl+K rows and Settings offer Claude / ChatGPT / Gemini; questions go to AI first ("smart" default), everything else to search; opens the AI site with the question filled in where supported.
5. ✅ Split view (draggable divider) **+ AI layer 2 side panel** (your AI chat docked beside the page, signed in, stays open across tabs); notes panel + .md export; reader mode. (+ split tab picker, welcome tour)
5b. *(postponed)* **AI layer 3 "Ask about this page"**: right-click selected text → Ask AI; ☰ → Summarize page. Sends page content only when you click; off in private windows; shows exactly what is sent.
6. ✅ Tab sleeping (unload after N idle minutes, keep Back/Forward history, "zz" badge, lazy restore).
7. ✅ Mochi: poses (idle, wave, happy, sleepy, walk, press, celebrate, oops), walk-in, reactions, Lively / Quiet / Off.
8. **Focus tools + per-tab volume + menu redesign** (decided 2026-11-17):
   - **Daily time limits per site** — Settings → Focus: limited sites with a daily budget (15/30/45/60/90 min); suggestions YouTube, Instagram, X, Reddit, TikTok, Facebook; add any site. Counts only while the site is on screen, the window focused and you active in the last minute. One budget per site across all tabs and windows, **private windows included** (their time isn't saved anywhere else). Resets at midnight. Countdown chip in the address bar in the last 5 minutes.
   - **Mochi warnings** (important, so also in Quiet mode): budget ≥ 30 min → 10, 5 and 1 min left; 15–29 min → 5 and 1; under 15 → 2 and 1.
   - **Time's up — Mochi eats the tab** (~2.5 s): walks along the strip to the tab, tab wobbles, three chomps (new chomp poses) as the tab shrinks into Mochi with pixel crumbs, "Nom! That's YouTube for today", walks off. Before the chomp, a 5-second **"1 more minute"** offer (2 per site per day). Tab in another workspace: closes quietly with a message. Reduced motion: fade + message.
   - **The Burrow gate** — any way back to a used-up site (address bar, bookmark, link, Ctrl+Shift+T, any window) shows a calm full page: Mochi asleep by a closed burrow door, time spent today, streak of days within limits, alternatives (go back, quick links, start a focus session, 2-minute stretch break). **Friction unlock**: type "I'm choosing more time on <site>" + breathing countdown → 5 more minutes; waits grow 10 s → 30 s → 60 s through the day.
   - **Focus sessions**: 25 min focus / 5 min break; limited sites go straight to the gate during a session; thin progress bar under the toolbar; Mochi celebrates the end.
   - **Per-tab volume**: click a tab's speaker → slider 0–200% + mute + "remember for this site". Works on video/audio elements (YouTube, Netflix, Spotify Web, Twitch…); Web Audio-only sites (games) can still be muted. **Above 100%** routes sound through Web Audio, which some sites forbid (a boosted video would go silent) — so the boost only turns on when the page allows it, otherwise the slider stops at 100%.
   - **☰ menu → control centre**: search field (opens Ctrl+K), row of New tab / Window / Private, zoom row, icon grid (Find, Split, Reader, PiP, Notes), library tiles (Bookmarks, History, Downloads), small links (Settings · Tour · Report a bug). Nothing removed; 5 compact rows instead of ~17 lines.
   - *Not in phase 8:* "What are you here for?" pause; focus-mode schedule (later).
9. **New-tab stat line + weekly Burrow report** (decided 2026-11-17):
   - **Stats store** (`main/stats.js`, `stats.json`): active time per site per day for **every** http(s) site, counted the same way as limits (on screen, focused window, active in the last minute). **Private windows are never recorded here** (their time still counts toward limits, as in phase 8). Also per day: focus sessions finished, tabs Mochi ate, "1 more minute"s and unlocks used, tabs put to sleep and memory freed. Kept **5 weeks**, older days deleted. Stays on your PC.
   - **Settings → Focus**: "Keep a weekly report" switch (off = nothing new recorded) and "Clear my stats" (two clicks).
   - **New-tab stat line** — one kind line under the search box, the most relevant of: time left on a limited site you used today (≤ 10 min) → focus session running → streak of days within limits (≥ 2) → focus sessions finished today → memory saved by sleeping tabs today. Nothing worth saying → no line. Not in private windows; hidden when Mochi is Off.
   - **Weekly report** (`burrow://report`): a Monday-to-Sunday page in the Swiss grid style:
     - Headline from Mochi (pose matches the week: celebrate / happy / gentle "new week, fresh start")
     - Total active time, with **↑/↓ vs last week**
     - Pixel bar chart by day; the part spent on limited sites in the accent colour
     - Top 5 sites with time and change vs last week
     - Limits: days within limits, streak, "1 more minute"s and unlocks used
     - Focus sessions finished
     - **Mochi's highlights**: tabs eaten, memory saved, best day, longest run of focus sessions
     - ← / → to earlier weeks (up to 5), "This week so far"
     - Empty state for the first week ("Come back Monday")
   - **Delivery**: on the first new tab of a new week (if last week has data), Mochi walks in: "Your week in Burrow is ready" + Open button — once per week. Also ☰ (library row → Report) and Ctrl+K "Weekly report" any time.
   - *Not in phase 9:* save the report as an image; "limit this site?" suggestions.
   - Self-test: counting (idle stubbed), private windows not recorded, 5-week pruning, stat-line choice for each case, report numbers from seeded data (totals, vs-last-week, top sites, empty state), Monday nudge appears once, switch off stops recording, Clear my stats.
10. **Right-click menus + window fixes** (decided 2026-11-17):
   - **Burrow-styled right-click menus** everywhere, same look as ☰ (keyboard: arrows / Enter / Esc; opens at the cursor, flips near edges, floats over pages with the overlay trick). The page tells Burrow *what* was clicked; Burrow decides the actions itself, so a page can't fake menu items.
     - Page: Back · Forward · Reload · Select all · View page source · Inspect
     - Link: Open in new tab · new window · private window · split view · Copy link address · Bookmark link
     - Image: Open in new tab · Save image as… · Copy image · Copy image address
     - Selected text: Copy · Search {engine} for "…" · Ask {AI} about "…" · Add to notes
     - Text boxes (pages *and* Burrow's address bar and fields): Undo · Redo · Cut · Copy · Paste · Select all, spelling suggestions; address bar adds **Paste and go**
     - Video/audio: Play/Pause · Mute · Loop · Picture-in-picture
     - Tab: New tab to the right · Reload · Duplicate · Mute / Volume · Keep awake / Sleep now · Split with… · Move to workspace ▸ · Move to window ▸ (other windows / new window) · Close · Close other tabs · Close tabs to the right · Reopen closed tab
     - Tab strip (empty space): New tab · Reopen closed tab
     - Bookmarks bar item: Open · Open in new tab · Edit · Delete
   - **Closing the last tab closes the window** (×, Ctrl+W, middle-click). Closing the last window quits Burrow, like Chrome. Exceptions: a workspace's last tab while other workspaces still have tabs leaves a new tab in that workspace; Mochi eating the last tab leaves a new tab (the window doesn't vanish from under you).
   - **Drag tabs back between windows**: a tab lifts off when it leaves the strip in *any* direction (not only downwards); a window's **only tab** can be dragged too — drop it on another window and that window takes it while the empty one closes; the drop lands **where you let go** in the target strip (not at the end), with an insert marker shown in the target window while you drag. Also "Move to window ▸" in the tab menu.
   - Self-test: every menu type from a real right-click (sendInputEvent) on a local test page; actions run (open link, copy, paste, search selection, tab actions); a page can't trigger menu actions itself; last-tab → window closes; last window → quit is requested; single-tab window dropped onto another merges; drop index.
11. **Import from other browsers** (decided 2026-11-17): **bookmarks + history** from Chrome, Edge, Brave, Vivaldi, Opera (all profiles, by name) and Firefox.
   - Where: a new **welcome-tour step** ("Bring your stuff", right after Hello), **Settings → Import** and Ctrl+K "Import from…".
   - Bookmarks keep their folders (shown as a folder label); the other browser's bookmarks-bar items go to Burrow's bookmarks bar. History: the last 90 days (within Burrow's 5,000 limit). Importing twice doesn't create duplicates. Optional: offer your most-visited sites as quick links.
   - Safe: read-only, works while the other browser is open (Burrow copies its files first), nothing leaves the PC; shows a summary ("312 bookmarks, 4,210 pages of history").
   - Not possible: staying signed in to sites (Chrome/Edge lock their cookies to themselves) — you sign in once. **Passwords come later** (phase 15), after Burrow has its own password manager.
   - Reading the history databases: Node's built-in SQLite if Electron 45 includes it, otherwise a small, well-known WebAssembly SQLite library (checked when building).
   - Self-test: fake Chrome / Edge / Firefox profiles in the test folder (Bookmarks JSON + History / places.sqlite made by the test) → counts, folders, bar items, no duplicates on a second import, the tour step.
12. **Mochi, part 1: helpful** (decided 2026-11-17):
   - **Eye & break nudges**: after 20 minutes of active screen time, Mochi: "Look at something far away for 20 seconds" with a little 20-second countdown; after ~90 minutes, a stretch nudge (opens the 2-minute stretch). Resets after 5 minutes away. Not during fullscreen video. Settings → Mochi: on/off and 20 / 30 / 45 minutes.
   - **Tab tidy-up**: duplicate tabs ("3 copies of YouTube are open — close the extras?") and forgotten tabs ("12 tabs you haven't opened in 3 days") with a review list to tick; closed ones go to "Reopen closed tab", so nothing is lost. At most once a day each.
   - **Remind me about this tab**: tab menu → Remind me ▸ in 1 hour · this evening (18:00) · tomorrow morning (09:00) · pick a time. The tab leaves the strip; at that time Mochi walks in and brings it back. Survives restarts; reminders missed while Burrow was closed appear at the next start. A list in Ctrl+K.
   - **Safety warnings**: Mochi warns when you start typing in a password box on a page without HTTPS (and a "NOT SECURE" chip shows in the address bar); risky downloads (.exe, .msi, .bat, .cmd, .scr, .ps1, .vbs, .js, .jar…) wait for "Keep" or "Discard" before they're saved.
13. **Mochi, part 2: fun** (decided 2026-11-17):
   - **Offline mini-game "Mochi Hop"** (our own game and art): when there's no internet, Burrow shows its own offline page — Mochi hops over puddles and pebbles and collects carrots; Space / click to hop, double-hop, best score saved, colours follow your theme. The page returns to the site by itself when you're back online. Also Ctrl+K "Play Mochi Hop". Other error pages (site not found, etc.) also get Burrow-styled pages.
   - **Mochi grows + outfits**: carrots for focus sessions, days within limits, eye breaks taken and Mochi Hop scores; spend them on outfits (scarf, glasses, beanie, bow tie, cape…) in Settings → Mochi → Wardrobe. Purely for fun — never lost, never a penalty.
   - **Reading time + idle life**: a "7 MIN READ" chip for articles; Mochi naps when you're away and waves when you're back; on the new tab Mochi's eyes follow the cursor and it blinks, stretches and hops now and then.
   - **Bedtime wind-down** (off by default; you set the time): 30 minutes before, Mochi mentions it; at bedtime it offers night mode (a warm, dim Burrow theme and a gentle warm tint over pages, can be turned off) and every 30 minutes after, a soft "It's late" (a few times at most). Ends at 06:00.
14. **Polish, accessibility, Windows installer** (decided 2026-11-18):
   - **Accessibility check**
     - Every colour choice readable: the theme engine guarantees at least 4.5:1 for text on backgrounds and on the accent colour, for every preset and any custom colour, light and dark (fixes the known 4.4:1 cases). The self-test checks all presets plus 200 random colours.
     - Keyboard: every control reachable with Tab, a visible focus ring everywhere, menus and pickers work with arrow keys / Enter / Esc.
     - Screen readers: every icon-only button gets a name (the self-test lists any that don't); live areas for Mochi's messages.
     - "Reduce animations" in Windows is respected everywhere.
   - **Site permission prompts**: camera, microphone, location, notifications (today all silently blocked) → a bar under the toolbar: "example.com wants to use your camera — Allow / Block", remembered per site; **Settings → Site permissions** to change or forget them. Private windows ask every time and never remember. Fullscreen, copy and pointer lock stay allowed without asking.
   - **Clear browsing data**: Settings section + Ctrl+Shift+Delete — history, cookies and site data, cached files, downloads list; last hour / day / week / all time. Weekly-report stats keep their own "Clear my stats".
   - **Default browser**: the installer registers Burrow as a browser; Settings → "Make Burrow your default browser" opens Windows' default-apps page (Windows insists you confirm there). Links opened from other apps arrive as a new tab in the open Burrow window.
   - **Crash page**: when a tab's page crashes, a Burrow page with Mochi fainted and a Reload button, instead of a blank tab. **Split view is remembered** after a restart.
   - **Installer (electron-builder)**: a **one-click setup** (installs for your user in seconds, no admin; Start menu + desktop shortcuts; uninstaller in Windows Settings) **plus a portable .exe**. App name Burrow, the chosen icon (generated as a multi-size .ico from the pixel art).
   - **Updates (electron-updater + GitHub Releases)**: Burrow checks on launch and every 6 hours, downloads quietly, then Mochi says "Update ready — restart to get vX.Y.Z". Settings → About: version, "Check for updates", "Restart to update". **Unsigned for now** (Windows shows "Windows protected your PC" on first install: More info → Run anyway); signing (SignPath or Microsoft Store) can be added later without changing anything else.
   - **Releasing**: `npm version minor` then `npm run release` builds and uploads to GitHub Releases — this needs a GitHub token on your machine and is always run by you (Burrow never publishes on its own). First release: **v0.2.0**.
   - **Tidying**: the self-test's download check uses a local test server (no internet needed); stale "known issues" are removed.
   - **App icon**: **Mochi's pixel face on a Signal-red square** (chosen 2026-11-18 from five designs), drawn from Mochi's own sprite so it stays crisp from 16 px to 256 px.
   - Self-test: contrast for all presets + random colours, unnamed buttons, the permission bar (a local page asks for notifications/geolocation → Allow / Block / remembered / private forgets), clearing each kind of data, crash page via a forced renderer crash, split restored from a saved session, update flow with simulated "update available / downloaded" events. The installer is checked by building it and confirming both files exist and launch.
15. **v0.3.0 — "Soft paper" design system + UX fundamentals** (decided 2026-11-19; mockups compared five looks, then v2, then the UX additions). The layout, features and Mochi stay; how everything looks and behaves gets calmer and more consistent.
   - **a. Design tokens first** (written down once; every screen uses them):
     - Type scale: Display 30 · Title 20 · Body-long 15 (1.6 line height, ~65 characters a line) · UI 13 · Label 11 (small-caps sans). Headings weight 650 (was 800), letter spacing −0.02em.
     - Spacing on a 4/8 rhythm (4 · 8 · 12 · 16 · 24 · 32). Radius: 4 small (chips, keys) · 8 medium (buttons, inputs, rows) · 12 large (menus, cards).
     - Elevation: page → surface (inputs, cards: hairline) → floating (menus, toasts: one soft shadow, no hard border).
     - Motion: 120 ms (hover, press) · 180 ms (menus, panels) · 260 ms (Mochi, toasts), ease-out, all off with "reduce animations".
     - **Status colours separate from the brand accent**: danger red, warning amber, success green, info blue (coral then always means "Burrow / act here").
   - **b. Soft paper restyle** (fixes 1–8):
     1. Lighter headings (650).
     2. Tints instead of inverted black blocks: active tab = light tile + thin accent underline; selected menu row = soft accent tint with accent text; Search | Ask = soft toggle.
     3. Pixel font only for numbers, keys and tiny badges; words in small-caps sans.
     4. Accent reserved for the primary action, the current selection and focus (secondary buttons are quiet outlines).
     5. Clear elevation: address bar flush in the toolbar; menus float on a soft shadow.
     6. 8 px rhythm: tabs 34 px, toolbar 44 px, menu rows 32 px; more breathing room on the new tab.
     7. Distinct states: hover = faint ink tint · selected = soft accent tint · keyboard focus = 3 px soft accent halo.
     8. Bigger targets: toolbar buttons 34 px.
     - Warm grey ink (not near-black), hairline rules (not 2 px black), soft coral accent; **dark mode** gets the same softening (warm dark greys). The Colour setting still works: any colour is softened the same way. The theme engine gains the new tokens (tint, hover, status colours) and checks every text colour for 4.5:1.
   - **c. UX additions** (9–15):
     9. Honest address bar: lock or "Not secure" at the start; domain in full ink, the rest muted; page chips (reading time, star, reader, zoom) inside the bar only when they apply.
     10. Informative tabs: favicon or a loading spinner; × on hover and on the active tab only; hover tooltip with the full title, site and state (playing, asleep).
     11. A thin loading bar under the toolbar.
     12. Undo instead of "are you sure?": closing a tab, closing others / to the right, tidy-up → "3 tabs closed · Undo" toast.
     13. Status colours used for status (not secure, warnings, saved, updates), never the brand accent.
     14. Two voices: Mochi stays the friendly voice in the tab strip; system messages (downloads, undo, errors, updates) become plain toasts at the bottom left, so nothing important depends on Mochi's Lively / Quiet / Off setting.
     15. Density setting: Comfortable (default) or Compact (tabs 28, rows 26, text 12) for small screens.
   - Self-test: 4.5:1 for every token pair (all presets + random colours, light and dark), states distinguishable, address-bar parts, tab tooltip, loading bar, undo restores tabs, toasts vs Mochi, density sizes; screenshots of every screen in light and dark reviewed before release.
16. **v0.3.x — features agreed earlier** (2026-11-19):
   - **Search suggestions** in the address bar as you type, from your search engine (Google, Bing, DuckDuckGo, Brave, Ecosia, Startpage — each has a public suggestion address), mixed with history and bookmarks; arrow keys + Enter; on by default, a switch in Settings → Search engine; **off in private windows**; only what you type is sent, only to your chosen engine.
   - **Gestures**: touchpad two-finger swipe = Back / Forward (with an arrow that follows your fingers and commits past a threshold), pinch = zoom the page; **mouse gestures** (hold the right button and draw: ← back, → forward, ↓ new tab, ↓→ close tab) with a visible trail and a Settings switch. (Alt+arrows, mouse side buttons and Alt+Home are done in 0.2.2.)
   - **Tester badge**: testers enter a code you give them (Settings → About) → a "Tester" badge in About and a special Mochi outfit; the "What's new" popup keeps crediting testers by name (done in 0.2.2).
17. **v0.4.0 — the Burrow adventure** (Mochi's game, our own design): a small top-down adventure in a Game Boy-style 4-shade palette — Mochi explores a burrow and a meadow, talks to critters, solves little puzzles, collects carrots (which count as real carrots); progress is saved. A short design document (map, critters, puzzles, controls) comes first for your approval. Mochi Hop stays as the offline mini-game.
18. **v0.5.x — more features** (chosen 2026-11-19; each one ships as its own small release, in this order):
   - a) **Tab groups + pinned tabs**: right-click a tab → "Add to group" → name + colour; a group collapses to one coloured chip and expands again; drag tabs in and out; groups are saved with the session. Pinned tabs shrink to an icon at the left, survive restarts and can't be closed by "close others". Self-test: create / rename / collapse / drag between groups, restore after restart, pinned order.
   - b) **Ad & tracker blocker**: a well-tested filter engine (Ghostery's open-source adblocker for Electron) with EasyList + EasyPrivacy, refreshed weekly in the background; a shield in the address bar shows how many were blocked on this page; a per-site off switch; a total in the weekly report. On by default; Settings switch. Self-test: a local test page with fake ad/tracker requests is blocked, an allowed site is not.
   - c) **Screenshot tool** (Ctrl+Shift+S and the ☰ menu): visible area, a selected area (drag a box), or the whole long page; then copy, save as PNG, or open in a new tab. Self-test: each mode returns an image of the right size.
   - d) **Send to phone (QR)**: a QR icon in the address bar shows a QR code of the page address; scan it with your phone's camera. Made on your computer — nothing is sent anywhere. Self-test: the QR code decodes back to the page address.
   - e) **File converter + shrinker** for downloads (from the downloads list: "Convert…" / "Make smaller…"), all done on your computer, nothing uploaded. The original is always kept; the result is saved next to it with a new name:
     - Images: PNG ↔ JPG ↔ WebP; smaller = lower quality and/or smaller dimensions, with a before → after size preview.
     - PDF: PDF → images (one per page); images → one PDF; smaller = re-compress the pictures inside (text stays text).
     - Word (.docx): DOCX → PDF, DOCX → plain text / web page. (PDF → Word isn't offered: it can't be done well offline, and a bad result is worse than none.)
     - Self-test: every conversion on sample files from `tests/files/` opens correctly, "smaller" really is smaller, the original is untouched.
   - f) **"What are you here for?"**: opening a site on your limits list first asks your intention in one line ("reply to Sam", "10 minutes of videos"); Mochi shows it in the tab strip and checks in gently when your time is up or you drift to other pages. Skippable; a Settings switch.
   - g) **Endless-scroll nudge**: on any site, when Mochi notices a long unbroken stretch of endless scrolling (the page keeps growing as you scroll, for 10+ minutes), Mochi suggests a pause — once per stretch, never on reading pages. Respects Mochi's Lively / Quiet / Off.
   - h) **Focus schedule**: focus sessions that start by themselves at times you set (e.g. weekdays 9–12), with the days, times and blocked sites chosen in Settings → Focus; a 1-minute heads-up before it starts; you can still end one early.
   - Self-test for f–h uses the test clock (no real waiting).
19. Later: **password manager** (encrypted with Windows' own protection, autofill on login forms, "save password?" prompt, revealing a password asks for your Windows PIN) **+ password import** from other browsers.
20. Later (parked): **Mochi answers** inside Burrow using your own AI API key (optional, costs per question).

## Verification
- `npm install` and `npm start` after every phase, then check that phase's features by hand.
- Theme: try every preset + a few custom colours in light and dark mode, check text stays readable, and confirm the setting survives a restart.
- Mochi limit flow (self-test, with a local test site and a seconds-long budget): warnings fire at the right moments; Mochi walks to the right tab (even with many tabs), eats it, the tab closes; "1 more minute" works twice then is refused; reopening by address, bookmark, link and Ctrl+Shift+T all show the gate; the friction unlock grants 5 minutes and the next wait is longer; time in private windows counts; time only counts while the tab is visible.
- Volume: slider changes a test page's video volume; 0–100% on any page; the boost above 100% only appears where the page allows it.
- Tab sleeping: lower the debug threshold and confirm memory drops and the tab reloads when you click it.
- Command palette finds tabs, history, bookmarks and actions using only the keyboard.
- `npm run dist` produces an installer that installs and runs.
- Update the journal's feature table after each check.
