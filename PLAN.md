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
1. Journal + scaffold: window, custom title bar, single tab navigation, theme engine with the Customize panel.
2. Numbered tabs + overflow sidebar, workspaces, omnibox, shortcuts, session restore.
3. Bookmarks, history, downloads, find, zoom, private window, PiP.
4. Ctrl+K command palette.
5. Split view (draggable divider), notes panel + .md export, reader mode.
6. Tab sleeping (`webContents` discard after N idle minutes, ZZ badge).
7. Mochi: sprite engine, poses (idle, wave, happy, sleepy, walk, press, celebrate), reaction events, quiet mode.
8. Focus tools: per-site daily limits (active time only), Mochi walks to the tab's × and presses it (2 snoozes/day), time's-up gate, mindful pause, focus sessions + focus mode schedule.
9. New-tab stat line + weekly Burrow report.
10. Polish, accessibility check (AA contrast for every seed colour), electron-builder Windows installer.

## Verification
- `npm install` and `npm start` after every phase, then check that phase's features by hand.
- Theme: try every preset + a few custom colours in light and dark mode, check text stays readable, and confirm the setting survives a restart.
- Mochi limit flow: a debug "limit in seconds" setting with YouTube set to 20 s. Mochi warns at 80%, walks to the right tab's × even with many tabs, presses it, and the tab closes. Snooze works twice, then is refused. Reopening shows the gate.
- Tab sleeping: lower the debug threshold and confirm memory drops and the tab reloads when you click it.
- Command palette finds tabs, history, bookmarks and actions using only the keyboard.
- `npm run dist` produces an installer that installs and runs.
- Update the journal's feature table after each check.
