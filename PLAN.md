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
9. New-tab stat line + weekly Burrow report.
10. Polish, accessibility check (AA contrast for every seed colour), electron-builder Windows installer.
11. Later (parked): **Mochi answers** inside Burrow using your own AI API key (optional, costs per question).

## Verification
- `npm install` and `npm start` after every phase, then check that phase's features by hand.
- Theme: try every preset + a few custom colours in light and dark mode, check text stays readable, and confirm the setting survives a restart.
- Mochi limit flow (self-test, with a local test site and a seconds-long budget): warnings fire at the right moments; Mochi walks to the right tab (even with many tabs), eats it, the tab closes; "1 more minute" works twice then is refused; reopening by address, bookmark, link and Ctrl+Shift+T all show the gate; the friction unlock grants 5 minutes and the next wait is longer; time in private windows counts; time only counts while the tab is visible.
- Volume: slider changes a test page's video volume; 0–100% on any page; the boost above 100% only appears where the page allows it.
- Tab sleeping: lower the debug threshold and confirm memory drops and the tab reloads when you click it.
- Command palette finds tabs, history, bookmarks and actions using only the keyboard.
- `npm run dist` produces an installer that installs and runs.
- Update the journal's feature table after each check.
