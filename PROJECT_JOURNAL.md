# Burrow — project journal

> Your plain-language guide to what's being built, why, and where things stand.
> Updated after every phase of work and every new decision. Latest entry is at the top of the decision log.

---

## 1. The pitch
**Burrow** is a desktop web browser for Windows that feels like a well-designed poster: a strict Swiss grid, bold flush-left type, crisp black rules, with pixel-art accents. It lives alongside **Mochi**, a small pixel bunny-mochi who reacts to what you do (greets you, celebrates finished downloads and streaks, nudges you during focus sessions). It has the everyday features you expect (tabs, bookmarks, history, downloads) plus standout ones: workspaces, split view, notes, reader mode, a Ctrl+K command palette, sleeping tabs, focus sessions, and gentle tools to stop doomscrolling (when your time on a site runs out, Mochi walks up to the tab's × and presses it).

Doomscroll control is **one feature among many**, not the main selling point.

---

## 2. How it works (simple version)

Burrow is built with **Electron**: a toolkit that bundles the Chromium engine (the engine inside Chrome) with Node.js, so we can write the browser's interface in HTML/CSS/JavaScript and still render every website properly.

```
┌──────────────────────────── Burrow window (BaseWindow) ────────────────────────────┐
│  UI view   ← our own HTML page: title bar, numbered tabs, address bar, panels       │
├────────────────────────────────────────────────────────────────────────────────────┤
│  Tab view  ← one per open tab; this is where websites load (sandboxed, isolated)   │
│  (+ overlay view for the command palette and focus screens, later)                 │
└────────────────────────────────────────────────────────────────────────────────────┘
          ▲                                   ▲
          │ messages (IPC) via a safe "bridge" │
          ▼                                   │
   Main process (Node.js) — the brain: creates tabs, saves settings, tracks time
```

- **Main process** = the back-office. It owns all the real state (which tabs exist, settings, history) and saves it to disk.
- **UI view** = the browser's own interface. It can't touch your computer directly; it asks the main process via a tiny, controlled API called `window.burrow`.
- **Tab views** = websites. They're sandboxed and know nothing about Burrow's internals.

---

## 3. Decision log

| Date | Decision | Options considered | Why |
|---|---|---|---|
| 2026-11-18 | **Releases are made by pushing a version tag** (GitHub Actions builds on Windows and publishes with GitHub's built-in token) | Release on every push to main; keep releasing from your PC | Every commit would otherwise reach everyone's Burrow at once; tags make releasing a deliberate step, and no personal token is needed on your PC |
| 2026-11-18 | **Google sign-in:** on accounts.google.com only, Burrow presents itself as Firefox (request headers, the page's navigator.userAgent, no Chromium client hints); everywhere else it stays Chrome | Leave it (Google blocks sign-in); pretend to be Google Chrome everywhere | Google refuses sign-in from browsers it sees as embedded Chromium. Presenting as Firefox only there is the usual approach of independent browsers and changes nothing for other sites. Google could change its checks later |
| 2026-11-18 | **MIT licence**; README with screenshots, issue templates (blank issues stay on for the in-app Report a bug) | GPL-3.0; no licence | Your pick: simple and common, and keeps the free SignPath signing option open |
| 2026-11-18 | **Release via GitHub Releases with auto-update, unsigned for now** (phase 14) | SignPath free signing (needs an open-source licence); Microsoft Store; installer only | Simplest that really updates itself; signing can be added later without changing anything. Cost: a one-time SmartScreen warning on first install |
| 2026-11-18 | **One-click per-user installer + portable .exe** | One-click only; classic wizard | Installs in seconds without admin; the portable copy runs from a USB stick or a college PC |
| 2026-11-18 | Phase 14 adds browser basics: **site permission prompts, clear browsing data, default browser, crash page + remembered split view** | Leave for later | Your picks; these are what people expect from a real browser |
| 2026-11-18 | App icon: **Mochi's pixel face on a Signal-red square** | Full body, peeking, face on dark, "B." wordmark | Your pick; bold colour, readable even at 16 px in the taskbar |
| 2026-11-18 | Releases are always **run by you** (`npm run release` with your GitHub token); Burrow never publishes anything by itself | Automatic publishing from the build | Publishing is public and permanent, so a person should press the button |
| 2026-11-18 | Text on the accent colour must reach 4.5:1: when neither white nor black does, the accent is nudged a little darker or lighter (Signal red: #E63027 → #E5271E) | Accept 4.4:1 | Readable buttons for everyone; the change is invisible |
| 2026-11-18 | Clear browsing data: the time range applies to history and the downloads list; **cookies and the cache are always cleared completely** | Pretend to clear cookies by date | Electron can't clear cookies or cache by date, and the screen says so honestly |
| 2026-11-18 | A crashed tab reuses the offline page ("Mochi fainted", Reload) and never reloads by itself | A separate crash page; auto-reload | Less code; auto-reloading a page that crashes could crash over and over |
| 2026-11-18 | Clicking Mochi on the new tab opens **a menu of things to do** (petting is one of them); private windows get only Pet and Mochi Hop | Keep clicking = a random line | You asked for Mochi to do stuff; a menu makes Mochi's features easy to find |
| 2026-11-18 | Self-test speed-ups: Mochi's eat animation runs 4× faster *in tests only*; timer checks call Burrow's once-a-second timer directly; "pause then check" became "check until true" — except checks that something does **not** happen, which keep their pause | Shorter pauses everywhere | Faster without weakening what the tests prove |
| 2026-11-18 | **Mochi Hop** is our own game: Mochi hops puddles and pebbles and collects carrots, drawn from Mochi's own sprite and your theme colours; five game carrots earn one real carrot (five a day) | A copy of a well-known offline game | Original, on-brand, and gives the carrots a playful source |
| 2026-11-18 | **Night mode never changes your saved theme**: it's a temporary override (warm amber, dark) that ends at 06:00 or when you switch it off; the page tint can be turned off separately | Switch your theme to dark | Morning-you gets your own theme back without doing anything |
| 2026-11-18 | Outfits are a few pixels placed relative to each pose's head, eyes and feet | Separate drawings per pose | Works in every pose (walking, eating, sleeping) automatically |
| 2026-11-18 | Risky downloads are saved under a **temporary name** until you press Keep | Pause the download until you decide | Pausing races with the download starting; a temporary name can't be opened by accident and works even after a restart |
| 2026-11-18 | "NOT SECURE" shows on every web page without HTTPS (your own computer's test servers excepted); Mochi only speaks up when you start typing a password | Warn on every such page | The chip is quiet and always there; Mochi only interrupts when it matters |
| 2026-11-18 | Tab tidy-up keeps the copy you're looking at (or used last) and never offers tabs that are playing sound or kept awake; closed ones can be reopened | Close all duplicates | Nothing you're using disappears, and nothing is lost |
| 2026-11-18 | Imported bookmarks keep their **folder as a label**; only the other browser's **bar items** go on Burrow's bookmarks bar | Put everything on the bar; build real folders | Burrow's bar showed every bookmark — 300 imported ones would bury yours. Real folders can come later |
| 2026-11-18 | History is read with **Node's built-in SQLite** (in Electron 45), from a temporary copy | Add a SQLite library | Nothing extra to install; the copy works while the other browser is open and can't change its files |
| 2026-11-17 | **Phases 10–13 planned** (details in PLAN.md): 10 right-click menus + window fixes, 11 import from other browsers, 12 helpful Mochi, 13 fun Mochi. The polish/installer phase moves to 14 | Do them inside the polish phase | Each is big enough to build, test and merge on its own |
| 2026-11-17 | Right-click menus are **Burrow-styled** (our own menus) | Native Windows menus | Same look as the rest of Burrow, and room for Burrow actions (Ask AI about a selection, open in split view) |
| 2026-11-17 | **Closing the last tab closes the window**; the last window quits Burrow | Always keep a new tab | You asked; it's what Chrome does. A workspace's last tab and Mochi eating the last tab still leave a new tab |
| 2026-11-17 | A window's only tab can be dragged onto another window (the empty window closes); tabs lift off in any direction and land where you drop them | Keep "last tab stays put" | You couldn't drag a torn-off tab back |
| 2026-11-17 | Import **bookmarks + history** now; **passwords later** with a proper password manager | Everything now; bookmarks only | Importing passwords needs somewhere safe to keep them first. Staying signed in can't be imported at all: Chrome and Edge lock their cookies to themselves |
| 2026-11-17 | Mochi gets all eight ideas: eye & break nudges, tab tidy-up, tab reminders, safety warnings (phase 12); offline game, carrots + outfits, reading time + idle life, bedtime wind-down (phase 13) | Fewer | Your picks |
| 2026-11-17 | **Phase 9 plan** (details in PLAN.md): weekly report records active time on **all sites** (not just limited ones), on your PC only, kept 5 weeks; private windows never recorded; a switch and "Clear my stats" in Settings → Focus | Only limited sites; ask at the first report | Your choice. "Top sites" needs every site; 5 weeks is enough for week-on-week comparisons without building a long history |
| 2026-11-17 | Weekly report arrives as a **Mochi nudge** on the first new tab of the week, opening a report page (also in ☰ and Ctrl+K) | Report opens by itself; no reminder | Noticeable but never in the way |
| 2026-11-17 | New-tab stat line **rotates to the most relevant kind fact** (time left, focus session, streak, focus done, memory saved), or shows nothing | Always screen time; streak only; no line | Keeps the "one gentle stat" rule from the design review; constant screen-time totals feel guilt-trippy |
| 2026-11-17 | Report extras: **compare to last week** and **Mochi's highlights**. Not now: save as image, suggesting limits | All four | Your pick |
| 2026-11-17 | **Time only counts when you're really there**: a limited site counts only while it's on screen, in the focused window, and you've touched the keyboard or mouse in the last minute | Count time a tab is open | A paused tab in the background shouldn't eat your budget |
| 2026-11-17 | When time's up, **every tab of that site closes**, in every window (private ones too) | Close only the tab you're looking at | Otherwise a second tab of the same site is an instant loophole |
| 2026-11-17 | The gate's breathing countdown is **checked by Burrow itself**, not just shown by the page | Trust the page's timer | A page can be tricked; the main process refuses an unlock that comes too early |
| 2026-11-17 | Per-tab volume: the tab's speaker now opens a **volume slider** (0–200%, mute, "Remember for this site") instead of muting straight away | Keep click-to-mute plus a separate control | One place for all sound settings; mute is still one click inside it |
| 2026-11-17 | **Phase 8 plan** (details in PLAN.md): daily per-site limits; Mochi warns (10/5/1 or 5/1 or 2/1 min left, by budget); at zero Mochi **eats the tab** (after a 5-s "1 more minute", twice a day); reopening shows the **Burrow gate** | Mochi presses the tab's × (original idea); no warnings | Your idea — eating the tab is more memorable and more Mochi |
| 2026-11-17 | Gate unlock = **friction, not a lock**: type a sentence + breathing countdown (10 s → 30 s → 60 s) for 5 more minutes | Hard lock until midnight; plain "continue" button | Never trapped, but never mindless |
| 2026-11-17 | Phase 8 extras: **focus sessions** (25/5), **private windows count** toward limits, **volume up to 200%** | "What are you here for?" pause (left out for now) | Your choice. Private windows would otherwise be an easy loophole |
| 2026-11-17 | Volume boost above 100% only where the page allows it | Always allow | Boosting routes sound through Web Audio, which some sites forbid — the video would go silent |
| 2026-11-17 | ☰ menu becomes a **control centre** (search, button rows, icon grid, tiles) | Grouped list; minimal menu + Ctrl+K | The 17-line list got crowded; a grid shows everything in 5 rows |
| 2026-11-17 | 5b ("Ask AI about this page") **postponed**; phases 6 and 7 done first | Keep the original order | Your call: sleeping tabs help every day |
| 2026-11-17 | **Tab sleeping**: tabs out of sight for 30 min (Settings: off / 15m / 30m / 1h / 2h) are unloaded but stay in the strip with a "zz"; clicking wakes them on the same page **with Back/Forward history**. Never sleeps: the tab(s) you see, tabs playing sound/video, "Keep this tab awake", or "never sleep" sites. Ctrl+K → "Put other tabs to sleep now" | Discard tabs with no history; only a manual button | Frees memory without losing your place |
| 2026-11-17 | **Restored tabs start asleep** and load only when you open them | Load every saved tab at startup | Much faster startup with many tabs (what Chrome/Edge do) |
| 2026-11-17 | "Memory freed" is an honest estimate: memory of the page processes that actually went away, measured just before | A made-up number | Processes can be shared between pages, so only freed ones count |
| 2026-11-17 | **Mochi**: new poses (sleepy, walking, press, celebrate, oops); walks into the tab strip before speaking; reactions to bookmarks, new workspaces, many tabs, split/reader first use, late nights. **Lively / Quiet / Off** in Settings → Mochi. Chatty reactions at most every 25 s and never over an important message | Mochi always on; reactions to everything | Personality without nagging; you decide how much |
| 2026-11-17 | **Split view asks which tab** goes on the right: a small picker under the ◫ button (also Ctrl+\\, ☰, Ctrl+K) lists this workspace's tabs plus "New tab"; arrows/Enter or 1–9 to pick | Always use the next tab | You asked to choose; the next tab was often the wrong one |
| 2026-11-17 | **Welcome tour** (first launch, replay from ☰ → Welcome tour or Ctrl+K): Mochi walks through 6 steps — Hello, Look (theme + colour, live), Search engine, AI (default + **Sign in** buttons), Keys (10 shortcuts), Go (summary). Skip any time | A static help page; no tour | First impressions matter; setting the essentials up front avoids surprises later |
| 2026-11-17 | AI **Sign in** opens the service's *own* sign-in page in a normal tab (claude.ai/login, chatgpt.com/auth/login, gemini.google.com). Burrow never handles passwords and doesn't try to detect whether you signed in | Burrow-made login forms; reading login cookies to show "signed in" | Typing passwords into a browser's own form for another site would be a phishing pattern; peeking at cookies isn't Burrow's business |
| 2026-11-17 | **Split view** (Ctrl+\\, toolbar ◫, menu, palette "Split with …"): the current tab on the left, the next tab (or a new one) on the right. The pair stays together — click either tab to see both; any other tab shows alone. Drag the divider to resize, double-click to swap. Clicking into a side makes it the active tab (an accent bar marks it) | Split into a separate window; fixed 50/50 | Feels like one window with two pages; the pair remembers itself |
| 2026-11-17 | **AI side panel** (Ctrl+Shift+A, toolbar ✦ AI): your chosen AI docked on the right, signed in with your normal session, stays open across tabs. Switch Claude/ChatGPT/Gemini in its header, drag its edge to resize, ↗ opens it in a tab. With the panel open, Ask AI goes to the panel. Off in private windows. Only one right-side panel at a time (AI or Bookmarks/History/…) | A panel per tab | Chat next to what you're reading, without losing it when you switch tabs |
| 2026-11-17 | **Notes**, one per website (by host, e.g. moodle.college.edu), saved as you type; list of all notes; export everything as one Markdown file (you choose where). Off in private windows | Notes per page address; notes synced online | Per-site is what you usually want ("notes for this course site"); Markdown opens anywhere |
| 2026-11-17 | **Reader mode** with Mozilla's Readability (Apache-2.0, the engine in Firefox): a book button appears on article pages (F9). Text size, serif option, "Original page" link. The article runs through a sanitiser *and* a page that forbids inline scripts | Write our own article extractor | Readability is battle-tested on millions of pages |
| 2026-11-17 | Reader safety: the article is extracted in an **isolated world** (the page's scripts can't interfere), then scripts, frames, forms, event handlers and `javascript:` links are removed before display | Show the article HTML as-is | Article HTML comes from websites; it must not be able to run code in a Burrow page |
| 2026-11-17 | **Ctrl+K command palette** searches actions, every open tab (all workspaces), bookmarks and history, plus Search / Ask AI rows. Matching is "fuzzy" (letters in order, e.g. "nwpr" finds New private window). Results open in the current tab only if you're on a new tab | Separate tab search + command list | One box to remember; shortcuts shown on each row teach you the keys |
| 2026-11-17 | Ask AI default: **Claude** (changeable in Settings → AI assistant). Claude and ChatGPT get your question in the address; **Gemini can't, so Burrow copies the question and Mochi says "Press Ctrl+V in Gemini"** | Skip Gemini | You wanted Gemini; copy-and-paste is the honest workaround |
| 2026-11-17 | New tab gets a **Search \| Ask** toggle that flips to Ask by itself when you type a question (in Smart mode); clicking it yourself overrides until you clear the box | Two separate boxes | Same box, clear which way Enter will go |
| 2026-11-17 | **AI in Burrow, in layers.** (1) "Ask AI" next to search — address bar, new tab, Ctrl+K, Settings — phase 4. (2) AI side panel docked beside the page — with split view, phase 5. (3) "Ask about this page / selected text" — after phase 5. (Later) Mochi answers with your own API key | AI built into Burrow from day one with an API key; a single "AI button" only | Many people now ask an AI instead of searching. Opening the AI sites you're already signed in to costs nothing, needs no keys, and works today; deeper features come step by step |
| 2026-11-17 | AI services offered: **Claude, ChatGPT, Gemini** (you pick a default in Settings). Where a site supports it, your question is filled in for you; Gemini may just open the chat | Also Perplexity | Your choice |
| 2026-11-17 | **Smart default:** text that looks like a question ("how…", "why…", ends in "?") offers Ask AI first; everything else offers search first. Both are always shown | Always search first; always AI first | Gets you to the right place in one keypress most of the time |
| 2026-11-17 | Page content is only sent to an AI when **you click** (Ask about this / Summarize); never in private windows; you see what's sent | Automatic page summaries | Privacy: pages can contain personal information |
| 2026-11-17 | **Git set up.** Repository on branch `main`, first commit `7ddfe98`. Commits use your GitHub "noreply" email, so your real email stays private. `.gitattributes` keeps one line-ending style | No version control | Every change can now be undone, compared, and backed up to GitHub |
| 2026-11-17 | **GitHub repo: public** — github.com/AnuragHarapanahalli/burrow (you created it) | Private | Lets anyone report bugs, and keeps the free SignPath signing option open |
| 2026-11-17 | **Report a bug**: a button beside the version opens a small form; submitting opens GitHub's *New issue* page already filled in (title, description, steps, "bug" label, Burrow version + system). The reporter presses Submit on GitHub | A relay server that files issues for them; a GitHub key inside the app | Free, nothing to run, and no secret key that someone could pull out of the app and misuse. Downside: reporters need a free GitHub account |
| 2026-11-17 | The bug report never includes the page you were on or anything personal — only Burrow/Windows/Electron versions, and that's a checkbox you can untick | Attach the current page address automatically | Privacy: page addresses can contain personal info |
| 2026-11-17 | New features get their own **branch** (first one: `feature/bug-report`) and are merged into `main` when done | Commit straight to main | Keeps `main` always working |
| 2026-11-17 | **Ctrl+N opens a new window**; any number of normal windows, each with its own tabs and workspaces. All windows open at quit come back next time; closing one of several windows forgets its tabs | One window only; or restore every window ever closed | Same behaviour as Chrome, which people already expect |
| 2026-11-17 | **Drag tabs to reorder** (strip and sidebar); the others slide aside | Reorder with keyboard only | You asked; it's how every browser works |
| 2026-11-17 | **Pull a tab down to open it in a new window**; drop it on another window's tabs to move it there. The *same live page* moves (video keeps playing, forms keep their text). Private tabs can be reordered but not pulled out; a window's last tab stays put | Reload the page in the new window | Moving the live page is faster and loses nothing |
| 2026-11-17 | Tab and workspace numbers are unique across all windows | Per-window numbering | A moved tab can't collide with one already in the new window; quick links scoped to a workspace stay correct |
| 2026-11-17 | Burrow now supports **several windows**: per-window code moved to `main/window.js`; `main.js` keeps app-wide things (settings, history, bookmarks) and sends each message to the window it came from | Keep one-window code and bolt on a second window | Private windows need their own tabs, interface and session; a clean split avoids mix-ups between windows |
| 2026-11-17 | **Private window** (Ctrl+Shift+N): brand-new in-memory session per window, always dark with a striped tab strip, Mochi in sunglasses. No history, no saved tabs, downloads list kept in memory; storage wiped on close. Bookmarks you add still save | Share one private session for all private windows | Separate sessions mean two private windows can't see each other's logins either |
| 2026-11-17 | Closing the main window quits Burrow (private windows close with it) | Keep private windows open on their own | Simpler; avoids a "ghost" app with no main window |
| 2026-11-17 | **Find in page** is a bar under the toolbar (not a floating box) | Floating box over the page like Chrome | A floating box would block clicks on the page; a bar lets you keep scrolling while searching |
| 2026-11-17 | **Zoom** steps match Chrome (25%–500%), remembered **per site**; Ctrl+wheel works; a "110%" chip appears in the address bar only when not at 100%. Private windows use but don't save zoom | One zoom for everything | Some sites have tiny text; you set it once per site |
| 2026-11-17 | **Picture-in-picture** button appears in the address bar once media plays; also in the ☰ menu. **Tab speaker** shows on tabs making sound — click to mute | Always-visible PiP button | Only shows up when it's useful |
| 2026-11-17 | Quick links can be **global or for one workspace** (chosen in the link form: "All workspaces" / "Only College"). Workspace links vanish with their workspace | Separate link lists per workspace | Most links (Mail, Drive) are wanted everywhere; a few (Moodle) only in one place |
| 2026-11-17 | Settings sections are **dropdowns** that show their current value when closed; only one open at a time; "Mode" renamed "Theme" | Long scrolling list | Settings is scannable at a glance; you open only what you want to change |
| 2026-11-17 | New-tab footer: "Made with ♥ by Anurag · v0.1.0". The heart is a pixel heart in the accent colour; the version is read from `package.json` | Hard-coded version text | Bumping the version in one place updates it everywhere automatically |
| 2026-11-17 | **Releases (proposed, not set up yet):** GitHub Releases + `electron-builder` + `electron-updater` — see section 11 | update.electronjs.org; Microsoft Store; manual zips | Free, simplest to run, and the app can update itself |
| 2026-11-17 | **Editable quick links** on the new tab: Edit → rename, change address, remove, add (max 8), drag to reorder. Saved in settings, shared by every new tab. Only web addresses (http/https) are accepted, checked again by the main process | Fixed links; editing in Settings | You asked to edit them; editing in place is the most direct. The double check stops a malicious page from planting a `javascript:` link |
| 2026-11-17 | **Search engine: you choose.** The new tab asks once (Google, Bing, DuckDuckGo, Brave, Ecosia, Startpage); changeable in Settings. Google until you pick | DuckDuckGo as a fixed default (what I had) | You asked why DuckDuckGo — I'd picked it for privacy without asking. A choice screen respects your preference |
| 2026-11-17 | THEME and LIBRARY buttons replaced by one **☰ menu**; theme lives in Menu → Settings | Keep a toolbar button for theme | Theme is set once and rarely touched; it shouldn't take permanent toolbar space |
| 2026-11-17 | Downloads button only appears once you have downloads, with an "arrow into tray" icon that bounces while downloading | Always-visible ⇩ glyph | The old ⇩ wasn't recognisable; hiding it until needed keeps the toolbar calm (same as Chrome) |
| 2026-11-17 | Tabs are one line: `01  icon  Title  ×`; the Ctrl+number hint moved into the tooltip | Number + `^1` stacked above the title | You found the stacked numbering cluttered |
| 2026-11-17 | Bookmarks bar on by default, toggle with Ctrl+Shift+B / menu / Settings; overflow goes in a » menu | Off by default | You asked for it; it makes bookmarks one click away |
| 2026-11-17 | **Motion:** tabs slide in/shrink out, buttons press down, menus pop, panel slides, star pops, reload spins, download arrow bounces. Short (80–320 ms) and switched off when Windows "reduce animations" is on | No motion; long playful animations | Motion shows what happened (a tab really closed, a menu came from that button) without slowing you down |
| 2026-11-17 | Menus and address suggestions float **over** websites by briefly lifting Burrow's interface above the page (the interface is see-through below the toolbar) | Shrinking the page to make room; a separate overlay window | Feels like a normal browser dropdown; the same trick will power the Ctrl+K command palette |
| 2026-11-17 | Tabs move to a left **sidebar** automatically past 8 tabs ("Auto"), or always Top / always Side (Customize, 03 TABS) | Shrinking tabs forever; scrolling only | Numbered tabs stay readable; matches the plan's overflow rule |
| 2026-11-17 | Downloads save straight to your Downloads folder (no "Save as" dialog), with "(1)", "(2)" added to avoid overwriting | Ask every time | Same as Chrome's default; fewer clicks |
| 2026-11-17 | History keeps the latest 5,000 pages; clearing it needs two clicks | Unlimited; one click | Keeps the file small; prevents accidents |
| 2026-11-17 | Workspace delete also closes its tabs, and needs a second click ("Delete?") | Move tabs to Home | Simple and predictable; the confirm click prevents mistakes |
| 2026-11-15 | Websites get **no** permissions (camera, mic, location, notifications) until Burrow has a proper "Allow / Block" prompt; only fullscreen, copy-to-clipboard and pointer lock are allowed | Electron's default: allow everything silently | Electron grants every permission by default, which is unsafe for a browser |
| 2026-11-15 | Default search engine: DuckDuckGo (Google/Bing available in code, setting later) | Google | Privacy-friendly default |
| 2026-11-15 | Remove "Electron" from the browser's user-agent string | Leave it | Some sites block or downgrade unknown browsers |
| 2026-11-15 | Electron **45.3.2** (not 39) | Electron 39 | npm flagged 12 security advisories in older Electron; a browser must run a patched engine |
| 2026-11-15 | Fonts installed from npm (`@fontsource`) instead of downloading from Google | Google Fonts CDN | Works offline, no requests to Google on every launch |
| 2026-11-14 | Design locked; development starts | — | User approved after 5 design rounds |
| 2026-11-14 | Chrome-style theme picker ("Customize Burrow"): preset swatches, custom colour, or Windows accent; Light / Dark / System. Whole palette generated from one colour | One fixed palette; four fixed palettes | User wanted to choose colours like in Chrome. Generating from one colour keeps every choice readable |
| 2026-11-14 | Design review accepted: hide grid lines, search bigger than clock, one gentle stat, Mochi only when relevant | Keep visible grid, giant clock, full stats on every tab | Grid lines are noise over websites; new tab is for searching; constant stats feel guilt-trippy |
| 2026-11-14 | v1 extra features: Ctrl+K command palette, tab sleeping, focus sessions, picture-in-picture, weekly report | Unlockable outfits, scroll desaturation (moved to v2) | Useful daily; fits the theme |
| 2026-11-14 | No Chrome extensions in v1 | Partial support via a library | Electron's extension support is limited; keeps v1 simple |
| 2026-11-14 | Design language: **Swiss grid + pixel** | Cozy pixel, Sleek glass, Retro OS, Neon night | User's direction after seeing cozy pixel variants |
| 2026-11-14 | Fonts: Inter Tight (UI) + Silkscreen (pixel numbers/labels, min 11px) | Pixelify Sans | Swiss clarity + a pixel accent; pixel font kept away from body text for readability |
| 2026-11-14 | Name **Burrow**, mascot **Mochi** | Nook/Pip, Woah/Damn-o, Kite/Kip, and ~10 others | A snug home on the web; cute, memorable |
| 2026-11-14 | Mochi is a companion everywhere (not just for limits) | New-tab only; toggle | Gives the browser its personality |
| 2026-11-14 | Standout features: workspaces, split view, notes + reader mode, doomscroll tools | Built-in ad blocker (not picked) | User's choice |
| 2026-11-14 | Platform: **Electron**, plain HTML/CSS/JS, no build step | Chrome extension, Tauri | Real browser engine, full control over UI; no Rust needed; simple to run |

---

## 4. Design spec

**Layout rules**
- 12-column grid as hidden structure (optional "Show grid lines" toggle in Customize).
- Flush-left text, 2px rules in the text colour to separate regions, 1px rules in the line colour inside regions.
- One accent use per screen (active-tab number, one highlight).
- Tabs are numbered `01 02 03…` and Ctrl+1–9 jumps to them. Active tab is inverted (text colour background).

**Typography**
- Inter Tight: all UI and body text. Weights 400 / 500 / 800.
- Silkscreen (pixel): clock, small labels, tab numbers, badges. Never below 11px, never for URLs or paragraphs.

**Colour (generated from one "seed" colour)**
| Token | Light mode | Dark mode |
|---|---|---|
| `--bg` page | seed hue, low saturation, 95% lightness | seed hue, 7% lightness |
| `--fg` text & rules | seed hue, 9% lightness | 94% lightness |
| `--muted` secondary text | 36% lightness | 66% lightness |
| `--line` hairlines | 84% lightness | 18% lightness |
| `--surface` inputs/cards | 99% lightness | 11% lightness |
| `--accent` | the seed itself | seed lifted to ≥62% lightness |
| `--on-accent` text on accent | black or white, picked by contrast | dark |

Presets: Signal red (default), Tomato, Klein, Matcha, Plum, Teal, Amber, Graphite.

**Mochi**
- 12×10 pixel sprite with a 1-pixel outline in the text colour; body white/cream; cheeks in the accent colour.
- Poses: idle, blink/sleepy, happy, wave (later: walk, press, celebrate).
- Appears only with a reason; quiet mode turns off non-essential appearances; respects "reduce motion".

---

## 5. Feature status

| Feature | Status |
|---|---|
| Project journal | ✅ done |
| Electron scaffold, custom title bar | ✅ done (tested 2026-11-17) |
| Numbered tabs, navigation, address bar | ✅ done (tested) |
| Theme engine + Customize Burrow panel | ✅ done (tested light/dark, Klein, Matcha, grid lines) |
| New-tab page with Mochi | ✅ done (tested) |
| Session restore + keyboard shortcuts | ✅ done (restore tested) |
| Workspaces (create, rename, delete, switch; Ctrl+Shift+1–9) | ✅ done (tested) |
| Tab sidebar (auto beyond 8 tabs, or always top/side) | ✅ done (tested) |
| Reopen closed tab (Ctrl+Shift+T) | ✅ done (tested) |
| Address-bar suggestions from bookmarks + history | ✅ done (tested) |
| Bookmarks (star, Ctrl+D, panel with search) | ✅ done (tested) |
| History (panel grouped by day, search, remove, clear all) | ✅ done (tested) |
| Downloads (progress, pause, cancel, open, show in folder; Mochi says when done) | ✅ done (tested) |
| Search engine chooser + Settings list | ✅ done (tested) |
| ☰ menu (replaces THEME / LIBRARY buttons) | ✅ done (tested) |
| Bookmarks bar with show/hide | ✅ done (tested) |
| Motion pass (tabs, buttons, menus, panel) | ✅ done (open/close tested) |
| Editable quick links on new tab | ✅ done (tested, incl. rejecting javascript: links) |
| Quick links per workspace or global | ✅ done (tested) |
| Settings as dropdowns | ✅ done (tested) |
| Footer with version | ✅ done (tested) |
| Auto-updates via GitHub Releases | proposed (needs a GitHub repo) |
| Find in page (Ctrl+F, F3, match case) | ✅ done (tested) |
| Zoom per site (Ctrl +/−/0, Ctrl+wheel, menu row) | ✅ done (tested) |
| Private window (Ctrl+Shift+N) | ✅ done (tested: own session, no history, no cookie leak) |
| Picture-in-picture | ✅ done (tested with a test video) |
| Tab speaker + click to mute | ✅ done (tested) |
| New window (Ctrl+N) + restore all windows | ✅ done (tested) |
| Drag tabs to reorder | ✅ done (tested with real mouse drags) |
| Pull a tab out into a new window / onto another window | ✅ done (tested) |
| Git + GitHub repo | ✅ set up |
| Report a bug (opens a prefilled GitHub issue) | ✅ done (tested) |
| Ctrl+K command palette | ✅ done (tested) |
| Ask AI: address bar, new tab toggle, palette, Settings (Claude / ChatGPT / Gemini, Smart default) | ✅ done (tested) |
| Split view (resize, swap, focus follows click) | ✅ done (tested with real mouse drags) |
| AI side panel | ✅ done (tested; test never contacts AI sites) |
| Notes per site + Markdown export | ✅ done (tested) |
| Reader mode | ✅ done (tested with a local article containing hidden script tricks) |
| Split view tab picker | ✅ done (tested) |
| Welcome tour (first run + replay) | ✅ done (tested every step) |
| Tab sleeping (timer, keep awake, never-sleep sites, sleep now, lazy restore) | ✅ done (tested) |
| Mochi poses, walk-in, reactions, Lively/Quiet/Off | ✅ done (tested) |
| Daily site limits + Settings → Focus (suggestions, budgets, streak) | ✅ done (tested) |
| Mochi's warnings, "1 more minute" (twice a day), Mochi eats the tab | ✅ done (tested) |
| The Burrow gate + friction unlock (sentence + breathing, 10 s → 30 s → 60 s) | ✅ done (tested, incl. early-unlock refusal and private windows) |
| Focus sessions (25 min focus / 5 min break, bar + timer) | ✅ done (tested) |
| Per-tab volume 0–200% + remember per site | ✅ done (tested; boost refused for audio from other sites) |
| ☰ control-centre menu | ✅ done (tested) |
| Weekly report (time per site, 5 weeks, on this PC; private windows never recorded) | ✅ done (tested) |
| New-tab stat line (time left / focus session / streak / focus done / memory saved) | ✅ done (tested every case) |
| Monday nudge from Mochi + ☰ Report tile + Ctrl+K "Weekly report" | ✅ done (tested) |
| Settings → Focus: "Keep a weekly report" switch + "Clear my stats" | ✅ done (tested) |
| Right-click menus: pages, links, images, selected text, text boxes, video/audio, tabs, tab strip, bookmarks bar, address bar | ✅ done (tested with real right-clicks) |
| Tab menu: duplicate, move to workspace / window, close others / to the right, sleep, volume… | ✅ done (tested) |
| Edit a bookmark (name + address) | ✅ done (tested) |
| Last tab closes the window | ✅ done (tested, incl. workspace and Mochi exceptions) |
| Drag a window's only tab onto another window; drop where you let go, with a marker | ✅ done (tested) |
| Import bookmarks + history from Chrome, Edge, Brave, Vivaldi, Opera, Firefox (Settings → Import, welcome tour, Ctrl+K) | ✅ done (tested with fake profiles; counts checked on your real Chrome + Edge) |
| Eye breaks (20 s every 20/30/45 min) + 90-minute stretch nudge | ✅ done (tested) |
| Tab tidy-up: duplicates + tabs not opened in 3 days, with a review list | ✅ done (tested) |
| Remind me about this tab (1 h, this evening, tomorrow morning, pick a time) | ✅ done (tested) |
| "NOT SECURE" chip + Mochi warning before typing a password without HTTPS | ✅ done (tested) |
| Risky downloads (.exe, .bat…) held until you press Keep or Discard | ✅ done (tested) |
| Offline / can't-reach page with Mochi Hop (also Ctrl+K "Play Mochi Hop"); returns to the site when it answers | ✅ done (tested) |
| Carrots (focus sessions, days within limits, eye breaks, Mochi Hop) + wardrobe: scarf, bow tie, glasses, beanie, crown | ✅ done (tested) |
| Reading time chip ("7 MIN READ") on articles | ✅ done (tested) |
| Mochi's idle life on the new tab: naps when you're away, wakes waving, eyes follow the pointer, fidgets; "Welcome back!" | ✅ done (tested) |
| Bedtime: heads-up, night mode (warm, dim Burrow + warm tint on pages), gentle "it's late", ends at 06:00 | ✅ done (tested) |
| Click Mochi on the new tab: pet, Mochi Hop, focus session, tidy up, my week, wardrobe, night mode, settings | ✅ done (tested) |
| Welcome tour: "Mochi" step (what Mochi does + eye breaks and bedtime), right-click in the shortcuts | ✅ done (tested) |
| Readable text with every colour (4.5:1 or more, all presets + any custom colour, light and dark) | ✅ done (tested with 200 random colours) |
| Site permission prompts (camera, microphone, location, notifications) + Settings → Site permissions | ✅ done (tested) |
| Clear browsing data (Settings + Ctrl+Shift+Delete) | ✅ done (tested) |
| Default browser: installer registration, Settings button, links from other apps open as tabs | ✅ done (link handling tested; registration checked in the installed app) |
| Crash page ("Mochi fainted") + split view remembered after a restart | ✅ done (tested with a forced crash) |
| PDF links open in the tab (Chromium's built-in viewer) | ✅ done |
| App icon (Mochi's face on red), one-click installer + portable .exe, auto-update from GitHub Releases, Settings → About | ✅ done (built locally; update flow tested with simulated events) |
| Windows installer | planned |

---

## 6. File map
```
WOAHDAMN/
├─ package.json           project info + dependencies (Electron, the two fonts) + "npm start"
├─ PLAN.md                the full development plan
├─ PROJECT_JOURNAL.md     this file
├─ main/                  ── the "brain" (Node.js, runs once) ──
│  ├─ main.js             starts the app; settings, theme, burrow:// pages, permissions; routes messages to windows
│  ├─ window.js           one Burrow window (normal or private): frame, interface, tabs, shortcuts, find, PiP, AI panel
│  ├─ permissions.js      site permissions: ask (bar), remember per site, private windows never remember
│  ├─ updates.js          auto-update from GitHub Releases (installed app only)
│  ├─ fun.js              carrots + outfits, Mochi Hop scores, bedtime arithmetic
│  ├─ care.js             Mochi's helpful side: eye/stretch breaks, tab tidy-up, tab reminders
│  ├─ importer.js         finds other browsers' profiles and reads their bookmarks + history (read-only copies)
│  ├─ ctxmenu.js          right-click menus for web pages: what to offer, and running the chosen item
│  ├─ stats.js            weekly report data: time per site per day + daily counts, kept 5 weeks (stats.json)
│  ├─ focus.js            focus tools: daily limits, time counting, warnings, "1 more minute", gate unlock, focus sessions (focus.json)
│  ├─ volume.js           per-tab volume: sets the page's audio/video volume, boosts above 100% where allowed
│  ├─ notes.js            notes, one per website (notes.json); Markdown export
│  ├─ reader.js           reader mode: runs Mozilla Readability safely and hands the article to the reader page
│  ├─ tabs.js             tabs + workspaces: create/close/switch, reopen closed, session restore
│  ├─ library.js          history + bookmarks (history.json / bookmarks.json), address suggestions
│  ├─ downloads.js        saves downloads to your Downloads folder, tracks progress (downloads.json)
│  ├─ selftest.js         developer-only: drives Burrow and saves screenshots (BURROW_SELFTEST=<folder>)
│  ├─ store.js            saves settings + open tabs to a JSON file (crash-safe writes)
│  └─ url.js              turns address-bar text into a URL or a search
├─ preload/               ── safe bridges between pages and the brain ──
│  ├─ ui-preload.js       gives Burrow's interface its `window.burrow` controls
│  └─ tab-preload.js      gives Burrow's own pages (new tab) a read-only theme + search; websites get nothing
├─ shared/                ── code used by both the brain and the pages ──
│  ├─ theme.js            the colour engine: one seed colour → every colour token, with contrast checks
│  ├─ ai.js               Ask AI: the AI sites, how to open each one, and "does this look like a question?"
│  └─ mochi.js            Mochi's pixel sprites (idle, blink, happy, wave) drawn as SVG
└─ ui/                    ── what you see ──
   ├─ base.css            fonts + colour variables shared by every Burrow page
   ├─ index.html          the browser's interface (one page)
   ├─ ui.css / ui.js      tab strip, sidebar tabs, toolbar, Mochi popping into the strip
   ├─ overlay.js          things that float over websites: workspace menu, address suggestions
   ├─ panel.css / panel.js   side panel: Bookmarks, History, Downloads, Settings
   ├─ bmbar.js            the bookmarks bar (and its » overflow menu)
   ├─ find.js             the find-in-page bar
   ├─ drag.js             dragging tabs: reorder, pull out into a new window
   ├─ palette.js          the Ctrl+K command palette
   ├─ panes.js            split-view divider, reader button, AI panel, notes
   ├─ mochi-react.js      Mochi's little reactions (bookmarks, workspaces, late nights…)
   ├─ focus-ui.js         the countdown chip, focus-session bar, and Mochi eating a tab
   ├─ volume.js           the tab volume slider
   ├─ site-ui.js          the permission bar; Settings → Site permissions, Clear browsing data, About Burrow
   ├─ fun-ui.js           the wardrobe and bedtime settings
   ├─ care-ui.js          eye-break countdown, tidy-up list, "remind me" picker, risky-download warning
   ├─ ctxmenu.js          right-click menus: the menu itself, tabs, strip, bookmarks bar, text boxes, drop marker
   └─ pages/newtab/       the new-tab page (clock, search, Mochi, search-engine chooser)
      ├─ quicklinks.js    the editable quick links
      └─ bugreport.js     the "Report a bug" form
   ├─ pages/reader/       the reader view (reader.html / .css / .js, with its own sanitiser)
   ├─ pages/welcome/      Mochi's welcome tour (welcome.html / .css / .js)
   ├─ pages/gate/         the Burrow gate shown when a site is closed (gate.html / .css / .js)
   ├─ pages/report/       the weekly report (report.html / .css / .js)
   └─ pages/offline/      "no internet" / "can't reach" page with Mochi Hop (offline.html / .css / .js)
scripts/make-icon.js      draws the app icon from Mochi's sprite → build/icon.ico (16–256 px), build/icon.png, ui/icon.png
build/installer.nsh       extra installer steps: registers Burrow as a browser with Windows (and removes it on uninstall)
scripts/selftest.js       `npm test`: runs the self-test (all of it, or chosen parts) and prints a summary
```

**`burrow://` addresses** — Burrow's own pages live at made-up addresses served from the project folder:
`burrow://newtab/` is the new tab; `burrow://app/...` serves the interface, shared code and fonts (only from allowed folders).

---

## 7. How to run
1. Install [Node.js](https://nodejs.org) (v20 or newer).
2. In this folder, run `npm install` once (downloads Electron, ~100 MB).
3. Run `npm start` to open Burrow.
4. To make the Windows installer and portable copy: `npm run dist` → `dist/Burrow-Setup-<version>.exe` and `dist/Burrow-<version>-portable.exe` (nothing is uploaded).
5. **To release a new version** (you decide when): `npm version patch` (or `minor`), then `git push --follow-tags`. Pushing the version tag makes GitHub build Burrow on its own Windows machine and publish the release (see `.github/workflows/release.yml`, progress under the repo's **Actions** tab); every installed Burrow then updates itself. Ordinary pushes without a tag never release anything. Backup, from your own PC: `$env:GH_TOKEN = [Environment]::GetEnvironmentVariable("GH_TOKEN", "User"); npm run release`.

**Checking nothing broke (the self-test):**
- `npm test` runs every check (about 200, under 2 minutes). Burrow opens, drives itself, then closes. Don't click in its window while it runs.
- `npm test -- phase8` runs one part only (about 40 s). Parts: basics, phase3, phase4, phase5, welcome, phase6, phase7, phase8, phase9, phase10, phase11, phase12, phase13, phase14, windows. Several work too: `npm test -- phase7 phase8`.
- `npm test -- readme` retakes the README screenshots (clean demo data) into `docs/screenshots`; it never runs as part of a normal `npm test`.
- `npm test -- --slow` also lists the 30 slowest checks, to see where time goes.
- It prints only the parts, how long each took, and anything that failed. Screenshots and the full log go to `.selftest/` (not saved in Git). It uses its own throwaway profile, so your real Burrow is untouched.

Your settings and open tabs are saved in `%APPDATA%\burrow\burrow-state.json`. Delete it to reset Burrow. History, bookmarks and the downloads list sit next to it in `history.json`, `bookmarks.json` and `downloads.json`.

**Shortcuts so far:** Ctrl+\\ split view · Ctrl+Shift+A AI panel · Ctrl+Shift+E notes · F9 reader view · Ctrl+K command palette · Ctrl+N new window · Ctrl+F find (Enter / Shift+Enter, F3) · Ctrl+= / Ctrl+- / Ctrl+0 zoom · Ctrl+Shift+N private window · Ctrl+Shift+B bookmarks bar · Ctrl+T new tab · Ctrl+Shift+T reopen closed tab · Ctrl+Shift+1–9 switch workspace · Ctrl+D bookmark · Ctrl+H history · Ctrl+J downloads · Ctrl+Shift+O bookmarks · Ctrl+W close · Ctrl+L address bar · Ctrl+Tab / Ctrl+Shift+Tab switch · Ctrl+1–8 jump to tab, Ctrl+9 last tab · Ctrl+R / F5 reload · Alt+←/→ back/forward · F12 developer tools · middle-click a tab to close it.

---

## 8. Glossary
- **Electron** — toolkit for building desktop apps with web tech; ships Chromium + Node.js.
- **Chromium** — the open-source engine behind Chrome; renders websites.
- **Main process** — the Node.js "brain" of the app; one per app.
- **Renderer** — any web page Electron shows (our UI, or a website).
- **WebContentsView** — a rectangle in the window that shows one web page. Burrow uses one for its UI and one per tab.
- **IPC** (inter-process communication) — messages passed between the main process and pages.
- **Preload** — a small script that runs before a page loads and exposes a safe, limited API to it.
- **contextIsolation / sandbox** — security settings that stop websites from touching your computer or Burrow's internals.
- **Seed colour** — the one colour you pick; every other theme colour is calculated from it.

---

## 9. Progress log
**2026-11-17 — Phase 1 done and tested**
- Burrow launches: custom title bar, numbered tabs, address bar, Customize panel, new-tab page with Mochi.
- Built a **self-test mode** (`main/selftest.js`): set `BURROW_SELFTEST=<folder>` and Burrow drives itself (opens a site, new tab, dark mode, panel, grid lines, closes a tab), saving screenshots to that folder. It uses a throwaway profile, so your real settings are never touched.
- Bugs found by the self-test and fixed:
  1. Pixel font didn't load on the new tab. Cause: browsers block fonts shared between different `burrow://` addresses unless the server says it's OK (a rule called CORS). Fix: Burrow now sends that permission for its own pages only.
  2. Mochi had no eyes in dark mode (eyes and body were both light). Fix: Mochi always uses a dark "ink" colour for eyes and outline.
  3. Long tab titles were cut mid-letter. Fix: they now end in "…".
- Electron's 158 MB download was checked against Electron's official checksum before use.

**2026-11-17 — Phase 2 done and tested (15/15 self-test checks pass)**
- Added: workspaces, sidebar tabs, reopen closed tab, address suggestions, bookmarks, history, downloads, Mochi popping into the tab strip when a download finishes.
- The self-test now checks each feature and prints PASS/FAIL. Downloads in the test go to a test folder, never your real Downloads.
- Bugs found and fixed: suggestion list stayed open over the panel; sites without an icon left a blank gap before the tab title; a label wrapped onto two lines; a typo that stopped the app from starting.
- Also confirmed: Burrow's interface refuses to run text as code (a security setting called CSP), which protects it if a malicious page title ever slipped through.

**2026-11-17 — Your feedback round (29/29 self-test checks pass)**
- Tab close/open motion, button press motion, menus pop in, panel slides in.
- Bookmarks bar (Ctrl+Shift+B), ☰ menu, Settings (search engine, mode, colour, tabs, layout), new download icon, one-line tabs, search engine chooser.
- How the tab animation works: tabs used to be redrawn from scratch on every change, so nothing could animate. Now each tab is a lasting element; a closed tab gets a "closing" style that shrinks it before it's removed.
- Fixed while building: two scripts both defined a helper called `host`, which would have stopped the interface loading.

**2026-11-17 — Editable quick links (36/36 self-test checks pass)**
- New-tab links can be edited, added, removed and reordered.
- Self-test screenshots now force a fresh paint first (background windows paint lazily, which had produced an out-of-date screenshot).

**2026-11-17 — Workspace links, settings dropdowns, footer (43/43 checks pass)**
- Bugs found by the self-test and fixed:
  1. **Link names lost every letter "s"** ("Lectures" became "Lecture"). Cause: a missing backslash in the code that tidies up spaces in names, so it removed "s" instead of extra spaces. Two similar slips in "www." handling were fixed too, and all patterns were re-checked.
  2. **A new tab sometimes didn't know its workspace.** Cause: the page asked for its settings while its scripts were still loading, and the answer could arrive before the quick-links code existed. Fix: the quick-links code now fetches its own copy once loaded.

**2026-11-17 — Phase 3 done (62/62 self-test checks pass)**
- Find in page, per-site zoom, private windows, picture-in-picture, tab speaker/mute.
- The self-test now also proves privacy: private browsing adds nothing to history and its cookies don't appear in normal browsing.
- Polish from screenshots: private windows hide the workspace arrow; untitled pages show their address instead of "New tab".
- Repeated lesson: code generated through scripts lost backslashes twice more (in a test). Every regex is now checked with a syntax check before running.

**2026-11-17 — Windows and tab dragging (73/73 self-test checks pass)**
- Ctrl+N new windows, drag to reorder, pull tabs out, drop tabs onto other windows; every open window is restored on restart.
- The self-test now uses **real mouse input** (press, move with the button held, release) instead of pretending.
- Bug found: the new drag code silently didn't load because it reused a name (`tabEls`) already used by another interface script — all interface scripts share one space for names. Fixed, and the self-test now checks that **every interface script loaded**, so this kind of clash can't hide again.

**2026-11-17 — Git + Report a bug (79/79 self-test checks pass)**
- Git repository created; GitHub repo connected.
- "Report a bug" button + form (also in the ☰ menu). Where reports go is set in `package.json` → `bugs.url`.
- Fixes found by the self-test: the title box used the browser's built-in "required" bubble instead of Burrow's own message; the test now records the address Burrow opens, because GitHub redirects signed-out visitors to its sign-in page first.

### How to use Git day to day
- See what changed: `git status` and `git diff`.
- Save a checkpoint: `git add -A` then `git commit -m "what you changed"`.
- Back up to GitHub: `git push`.
- Undo uncommitted changes to a file: `git restore path/to/file`.

**2026-11-17 — Phase 4 done (93/93 self-test checks pass)**
- Ctrl+K command palette; Ask AI in the address bar, new tab (Search | Ask), palette and Settings.
- The self-test checks the exact addresses Burrow would open for Claude/Gemini **without** actually visiting those sites.
- Discovered: in Electron 45, *reading* the clipboard is asynchronous (returns a "promise"). Burrow only writes to it, so only the test needed changing.

**2026-11-17 — Phase 5 done (119/119 self-test checks pass)**
- Split view, AI side panel, notes with Markdown export, reader mode.
- The self-test starts its own tiny web server with a fake article that hides a script, a booby-trapped image and a `javascript:` link — and checks none of it survives or runs in reader view.
- Fixed while testing: the panel's section tabs wrapped onto two lines with five sections; a test helper threw away results of self-contained snippets.

**2026-11-17 — Split picker + welcome tour (130/130 self-test checks pass)**
- Split view lets you pick the tab; first launch shows Mochi's 6-step welcome tour (replayable).
- The self-test walks through every tour step, and records the AI sign-in pages instead of really opening them.
- Bug found from a screenshot: in the split picker a tab whose icon failed to load had its title squeezed to "E…" (the missing icon shifted the columns). Icons now sit in a fixed slot.
- Note: your own Burrow will show the welcome tour once on its next launch (your profile hasn't seen it yet).
- **Flaky checks fixed.** Two checks failed on busy runs ("typing a note saves it", "removing a link saves it") because they paused a fixed time before reading a saved value. The self-test now has an \`until()\` helper that keeps checking for up to 4 seconds; nine such checks use it. Burrow itself was fine.

**2026-11-17 — Phases 6 + 7 done (150/150 self-test checks pass)**
- Tab sleeping (with history kept) and lazy restore; Mochi's new poses, walk-in, reactions and Lively/Quiet/Off.
- How sleeping works: the tab's page is closed, but Burrow keeps its address, title, icon and its whole Back/Forward list; waking rebuilds the page and restores that list.
- Known limit: a page that held unsaved typing (a half-written message on some sites) loses it when it sleeps — those sites belong in "never sleep".

**2026-11-17 — Phase 8 done (202/202 self-test checks pass)**
- Daily site limits, Mochi's warnings, "1 more minute", Mochi eating the tab, the Burrow gate with its friction unlock, focus sessions, per-tab volume, and the ☰ control centre.
- The self-test runs a tiny local "doomscroll" site with a short limit and goes through the whole day: warning → two snoozes → eaten → every way back in (new tab, Ctrl+Shift+T, typing, links) lands on the gate → unlock refused too early → unlock after breathing → private window gated too → focus session.
- Fixed while testing: the gate's countdown timer was created after its first tick (harmless, but fragile).
- Note: one older check (dragging the split divider) failed once while the test window was covered by another window. It passed on the other runs.

**2026-11-17 — Faster self-test + two fixes (204/204 checks pass, 107 s)**
- The self-test used to pause a fixed time after each step (about 110 s of pauses, ~4–5 minutes per run). It now waits only until each page has actually loaded, is split into parts you can run on their own, and has an `npm test` command. Full run: ~107 s.
- Fixed: Mochi's "1 more minute" bubble ran under the window's minimise/maximise/close buttons. It's now measured and kept left of them, and the self-test checks it.
- Fixed: closing a window before its interface finished loading showed a "JavaScript error in the main process" box.

**2026-11-17 — Phase 9 done (239/239 self-test checks pass, ~2 min)**
- Weekly report page, the new-tab stat line, Mochi's Monday nudge, and the report switch / "Clear my stats" in Settings → Focus.
- How the numbers are made: the same once-a-second timer that counts limits now also adds a second to every site on screen in the window you're using (never private windows). Each day is one small record; days older than 5 weeks are deleted.
- The self-test fills in two made-up weeks and checks every number on the report page (totals, "30 min less than last week", days within limits, top sites, highlights), each stat-line case, and that the nudge comes only once a week.
- Self-test fix: when you used the computer during a run, the test window sat behind your other windows and Windows/Chromium slowed it down (no screenshots, stalled animations, failed mouse drags). In test mode Burrow now keeps full speed when covered. Your normal Burrow is unchanged.
- Another self-test fix: the split-view picker check assumed three tabs were open, which was only true in a full run. Now the split section opens its own third tab, so the part also passes on its own.

**2026-11-17 — Phase 10 done (277/277 self-test checks pass, ~2 min)**
- Right-click menus everywhere, Burrow-styled; closing the last tab closes the window; tabs can be dragged back between windows.
- How page menus stay safe: when you right-click a page, Chromium tells Burrow what was under the pointer (a link, an image, selected text…). Burrow builds the menu and remembers those details itself. The interface only sends back "item X of menu number N", and Burrow checks that item was really on that menu before doing anything. A web page can't add items or trigger them.
- The self-test right-clicks a local test page with real mouse input (page, link, selected text, image, text box) and runs the actions; checks that items not on the menu (or from an old menu) are ignored; and drops a single-tab window onto the main window at the 2nd slot.
- Test fix: one check compared window counts against a number taken while an extra test window was still open.

**2026-11-18 — Phase 11 done**
- Import bookmarks and history from other browsers: Settings → Import, a new "Bring your stuff" step in the welcome tour (now 7 steps), and Ctrl+K.
- How it works: Burrow looks in the usual folders where each browser keeps its profiles (Chrome, Edge, Brave, Vivaldi, Opera in %LOCALAPPDATA% / %APPDATA%; Firefox via its profiles.ini), copies the bookmarks file and history database to a temporary folder, reads them, and deletes the copies.
- Gotcha found: Chrome stores visit times as microseconds since the year 1601 — numbers too big for ordinary JavaScript numbers. They're read as "BigInts" and converted.
- The self-test builds fake Chrome (two profiles), Edge and Firefox profiles in its own folder, so it never reads your real browsers. Separately, a counts-only check on your real Chrome and Edge confirmed the real formats read correctly (nothing imported).

**2026-11-18 — Phase 12 done (331/331 self-test checks pass, ~2.5 min)**
- Helpful Mochi: eye breaks and stretch nudges, tab tidy-up, "remind me about this tab", a NOT SECURE chip with a password warning, and risky downloads held for Keep / Discard.
- Bug found by the self-test: when picking which duplicate to keep, a copy opened later could win over the one on screen. The tab on screen now always wins.
- Mochi's warnings were shortened after a screenshot showed the strip cutting off "click me".
- When you last looked at each tab is now saved with your session, so "not opened in 3 days" still works after a restart.

**2026-11-18 — Phase 13 done (370/370 self-test checks pass, ~2.7 min)**
- Fun Mochi: Mochi Hop on Burrow's own offline / can't-reach page, carrots and a five-outfit wardrobe, a reading-time chip, Mochi's idle life on the new tab, and bedtime with night mode.
- Bug found by the self-test: Mochi's sprite didn't appear in the game, and the game froze. An SVG drawn as a picture needs a namespace line that inline SVG doesn't; the failed picture then broke the game loop. Both are fixed, and the loop now survives a bad frame.
- How "back online" works: the offline page asks Burrow every 5 seconds (and the moment Windows reports a connection) to check whether the site answers. If it does and you're not mid-game, the tab goes back to the site; mid-game, a "Return to the page" link appears instead.

**2026-11-18 — Mochi menu, tour update, faster self-test (389/389 checks, 119 s)**
- Clicking Mochi on the new tab opens a menu: Pet Mochi, Play Mochi Hop, start/end a focus session, tidy up tabs, my week, wardrobe, night mode, Mochi settings — with your carrots shown.
- The welcome tour has a new "Mochi" step (now 8 steps): six cards for Mochi's jobs, plus eye breaks and bedtime you can set right there. The shortcuts step now mentions right-click menus, and the summary includes Mochi's settings.
- Self-test: 162 s → 119 s while adding 19 checks. Each check's time is now recorded (`npm test -- --slow`). About half the run had been fixed pauses; 46 of them now wait only as long as needed, and 23 that prove something does *not* happen were left alone (one more was left alone on purpose because it would have passed without proving anything).
- Small fix found from a screenshot: Mochi's hello bubble could appear under the open menu.

**2026-11-18 — Phase 14 done**
- Accessibility: readable colours everywhere (checked with all presets and 200 random colours), names on every button and field (checked automatically), Mochi's messages announced to screen readers; the existing "reduce animations" handling covers every page.
- Browser basics: site permission prompts, clear browsing data, default browser + links from other apps, a crash page, split view after a restart, PDF viewing.
- Installer: `npm run dist` makes a one-click installer and a portable .exe with the Mochi icon; installed copies update themselves from GitHub Releases.
- The self-test's download check now uses a local test server (no internet needed for it).
- Checked the packaged app itself (the files inside the installer) with three test parts. Found and fixed: before your first release, the installed app said "Couldn't check for updates" (GitHub has no releases yet); that now counts as "You have the latest version".
- npm's audit flags some build tools (electron-builder's helpers); they only run on your PC to package Burrow and are not inside the app — the app's own packages have no known problems.

**2026-11-18 — First release (v0.2.0) and a release fix**
- Your first `npm run release` created **two** v0.2.0 releases: electron-builder uploads the installer and the portable copy at the same time, and when no release exists yet both uploads create one. `latest.yml` (needed for auto-update) didn't arrive.
- Fix: `npm run release` now runs `scripts/release.js`, which creates the one release first (or stops if there are duplicates), then builds and uploads into it, and finally checks that all four files are there (installer, blockmap, portable, latest.yml).

## 10. Known issues / next up
- Quick links can only be reordered with the mouse (no keyboard reordering yet).
- Picture-in-picture only finds videos on the page itself, not inside embedded frames (e.g. a YouTube video embedded on another site).
- Google sign-in relies on Google accepting a Firefox identity on its sign-in pages; if Google changes its checks, sign-in could be refused again.
- **Next:** your first release (v0.2.0) when you're ready; then the parked items (phase 15 password manager, "Ask AI about this page", Mochi answers).
- Installers are **unsigned**: the first install shows "Windows protected your PC" (More info → Run anyway). Signing (SignPath or Microsoft Store) can be added later.
- Updates only work in the installed copy; the portable .exe has to be replaced by hand.
- Night mode's page tint is a see-through layer on top of each page; a few sites with unusual layering may show it slightly differently.
- Imported bookmark folders are shown as labels, not real folders you can open and close.
- Right-click menus on media inside embedded frames (a YouTube video embedded on another site) may not control the video; the menu still shows. Phase 5b ("Ask AI about this page") is still postponed.
- The weekly report counts time by website address, so a site's time is split if it uses several addresses (e.g. youtube.com and youtu.be).
- Volume control only reaches audio/video on the page itself, not inside embedded frames; sites that play sound through Web Audio (some games) aren't affected by the slider.
- Time limits use the site's address (youtube.com covers m.youtube.com too) — apps on other domains (e.g. youtu.be short links) redirect first, so they're caught when they land.
- Ask AI relies on Claude's and ChatGPT's "question in the address" links; if they ever change them, the question may stop being filled in (the site still opens).

### Roadmap at a glance
| Phase | What | Status |
|---|---|---|
| 1–3 | Tabs, workspaces, library, theming, find, zoom, private & multiple windows, tab dragging, bug reports | ✅ done |
| 4 | Ctrl+K command palette + Ask AI in search | ✅ done |
| 5 | Split view + AI side panel, notes, reader mode | ✅ done |
| 5b | Ask AI about this page / selected text | postponed |
| 6 | Tab sleeping | ✅ done |
| 7 | Mochi animations + reactions | ✅ done |
| 8 | Focus tools (limits, Mochi eats the tab, the gate, focus sessions) + per-tab volume + control-centre menu | ✅ done |
| 9 | New-tab stat + weekly report | ✅ done |
| 10 | Right-click menus, last tab closes the window, drag tabs back between windows | ✅ done |
| 11 | Import bookmarks + history from Chrome, Edge, Brave, Vivaldi, Opera, Firefox | ✅ done |
| 12 | Mochi, helpful: eye & break nudges, tab tidy-up, tab reminders, safety warnings | ✅ done |
| 13 | Mochi, fun: offline game, carrots + outfits, reading time + idle life, bedtime wind-down | ✅ done |
| 14 | Polish, accessibility, site permissions, clear data, default browser, crash page, installer + auto-update | ✅ done |
| 15 | Password manager + password import | later |
| later | Mochi answers with your own AI key; code signing; auto-updates | parked |

---

## 11. Versions and updates (plan)

**Version numbers** follow *semantic versioning*: `MAJOR.MINOR.PATCH` (e.g. 0.1.0).
- PATCH (0.1.**1**) — bug fixes only.
- MINOR (0.**2**.0) — new features.
- MAJOR (**1**.0.0) — first "finished" release, or big breaking changes.
The number lives in `package.json` only; the new-tab footer reads it from there.
To bump it: `npm version patch` (or `minor` / `major`) — this edits package.json and makes a Git tag.

**Recommended update system (simplest that really auto-updates):**
1. Put the project on **GitHub** (a public repo, or a separate public repo just for releases).
2. Add **electron-builder** — turns Burrow into a Windows installer (`Burrow-Setup-0.2.0.exe`).
3. Add **electron-updater** — on launch, Burrow checks GitHub Releases; if there's a newer version it downloads it quietly and Mochi says "Update ready — restart to get v0.2.0".
4. To release: `npm version minor` → `npm run release` (builds + uploads to GitHub Releases). Everyone's Burrow updates itself.

**Things to know:**
- Without a code-signing certificate (~$100–400/yr), Windows SmartScreen shows "Windows protected your PC" on first install (click *More info → Run anyway*). Updates still work. Fine for friends/college; buy a certificate later if Burrow goes public.
- Private GitHub repos can't be used by the updater without putting a secret token inside the app, so the releases must be public.

**Code signing — decided 2026-11-18: unsigned for now (GitHub Releases + auto-update). Options for later:**
- *Microsoft Store* (free for individuals; Store signs MSIX packages, no SmartScreen warning, Store handles updates; each version is reviewed). Recommended if Burrow stays closed-source.
- *SignPath Foundation* (free, but Burrow must be open source with an OSI licence in a public repo; publisher shows as "SignPath Foundation"; builds run on GitHub Actions; works with GitHub Releases + auto-update).
- Not suitable: Azure Artifact Signing (individuals only in USA/Canada, ~$9.99/mo); self-signed certificates (Windows doesn't trust them).
