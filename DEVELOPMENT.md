# Developing My Tasks

Technical notes for running My Tasks locally and finding your way around the code. For what the app is, see the [README](README.md).

## Run it

Requires Node 20 or later.

```bash
npm install
npm run dev      # local dev server: the app at http://localhost:5173/app/
npm test         # unit tests (Vitest)
npm run check    # type-check (svelte-check)
npm run build    # production build in dist/: the website, with the app in dist/app/
npm run preview  # serve dist/ as GitHub Pages does: website at http://localhost:4173/, app at /app/
```

The dev server serves only the app. To see the website, run `npm run build` then `npm run preview`.

The app shows only its Setup screen until it is connected to a GitHub Gist, so you need a personal access token (classic, `gist` scope) to get past it.

## Tech

Svelte 5 and TypeScript, built with Vite. Data lives in IndexedDB through Dexie. Sync goes to the user's own GitHub Gist, encrypted in the browser with Web Crypto (PBKDF2-SHA-256 and AES-256-GCM). There is no server.

## Project layout

```
src/
  lib/model/    Types, dates, ids, ordering and the list membership rules (pure functions)
  lib/db/       IndexedDB schema (Dexie), all data operations (repo.ts), and
                transactions, the change log and undo (history.ts)
  lib/sync/     Sync through the user's GitHub Gist: setup, encryption, merging
  lib/drag/     Pointer-events drag and drop, and its pure calculations
  lib/pwa/      Install and offline: which browser, the install prompt, updates
  lib/state/    Live data, routing and transient UI state
  lib/          shortcuts.ts (key bindings), commands.ts (what they do),
                actions.ts (shared actions), version.ts (the version stamp)
                and csp.ts (the Content Security Policy)
  components/   Sidebar, rows, the to-do card, menus, dialogs, Setup
  views/        Built-in lists, project and area pages, Settings
site/           The website at the root of mytasks.fyi (plain HTML and CSS), copied
                around the app by the build; site/sw.js retires the old root service worker
scripts/        serve.mjs, the server behind npm run preview
tests/          Unit tests; tests/fakeGitHub.ts fakes the gist API
```

## Data

- Every change runs in one IndexedDB transaction and is written to a local change log.
- Inside a transaction, Dexie loses track of it, and commits it too early (`PrematureCommitError`), in two cases:
  - awaiting a plain `async` helper before the first database request (load settings first);
  - a read awaited through two levels of `async` helpers more than once (for example a helper that calls a read helper, in a loop).
  So helpers that only read (`liveChecklist`, `siblingKeys`, `shiftedKey`, `loadSettings` in `repo.ts`) return Dexie's own promise with `then` and are not `async`. The unit tests' in-memory database does not show this; check multi-record operations in a browser.
- Records are never removed: a deletion sets `deletedAt`, so it syncs like any other change.
- Sync merges record by record; the later `modifiedAt` wins.
- This device's token, gist id and encryption key live in a separate database, `mytasks-device`, and never sync.

## Install and offline

`vite-plugin-pwa` writes the web app manifest and a Workbox service worker that precaches the whole app, so it opens with no connection. The icons are made at build time from `public/favicon.svg` (`pwa-assets.config.ts`). The service worker handles only the app's own files: requests to GitHub always go to the network.

The dev server has no service worker. To try install, offline or updates, run `npm run build` then `npm run preview`.

- **Install.** Chrome and Edge show their own install prompt; on Safari and in Firefox, Install My Tasks opens a guide with the steps. In a Safari tab, the sidebar warns that data can be cleared, because Safari clears a site's storage after 7 days unused unless it is installed.
- **Updates.** The app checks for a new version on start, hourly, and when you switch back to it. A new version installs in the background and waits. The "Update available" banner's Restart saves any edit in progress, then switches; nothing reloads by itself.
- **Title bar.** The `theme-color` tags in `index.html` give the installed window the sidebar's grey; `src/lib/theme.ts` keeps them in step with Appearance.

## Keyboard

Press `?` in the app for the full list. Installed, My Tasks uses the full shortcuts, including Cmd/Ctrl chords. In a browser tab, keys the browser keeps for itself (Cmd/Ctrl+N, T, R and others) are replaced by single-letter fallbacks, and `/` opens Quick Find.

## Hosting and security

My Tasks is served as static files from GitHub Pages: the website at https://mytasks.fyi and the app at https://mytasks.fyi/app/. Every push to main runs `.github/workflows/deploy.yml`: unit tests, type check and build, then publish `dist/`. A failing step stops the deploy. `site/CNAME` names the domain.

The domain is where each device keeps its data (the browser's storage belongs to the site's address, not its path), so it must never change. The app moved from the root to `/app/` in 0.5.0 on the same domain, so every device kept its data. Two files keep earlier installs working:

- `site/sw.js` replaces the old root service worker: it deletes that worker's caches (not the app's), unregisters it and reloads open pages.
- `site/assets/site.js`, on the home page, forwards old links (`mytasks.fyi/#/today`) to the app, and sends an app installed before the move, which still starts at the root, straight to `/app/`.

The app links to the website from Setup, the sidebar's ? button and Settings › About My Tasks, always in a new tab (`src/lib/website.ts`, `SiteLink.svelte`): opened inside an installed app, the website's home page would send it straight back to `/app/`. Setup won't connect until the user ticks that they have read the risks and limitations; this device records when, and the Limitations page's "Last updated" date (`LIMITATIONS_UPDATED`). **When the Limitations page changes, update its date and `LIMITATIONS_UPDATED` together**; `tests/website.test.ts` checks they match.

The website has its own, stricter policy (`SITE_CSP` in `src/lib/csp.ts`): its own scripts and styles only, nothing inline, and no connections. `tests/website.test.ts` checks every page for it, the shared header and footer, and every link.

The built page carries a strict Content Security Policy in a `<meta>` tag (`src/lib/csp.ts`, added by `vite.config.ts`): scripts only from the app, no `eval`, and no connections except the app and GitHub's gist API. GitHub Pages can't send headers, so `frame-ancestors` and violation reports are not available. The dev server leaves the policy out, because it needs its own live-reload connection; `npm run preview` serves a build with it.

## Versions

The app shows its version and commit at the bottom of the sidebar, for example `v0.2.0 (a1b2c3d)`, and links it to that version's section of [CHANGELOG.md](CHANGELOG.md). Each pull request that changes the app adds a changelog section and sets the version in `package.json`: the middle number for new features, the last for fixes. 1.0.0 is the first release at mytasks.fyi.

The commit is read when the dev server starts or the app is built, so restart `npm run dev` after switching branches.

## Milestones

v1 is built in milestones, each a pull request.

| Milestone | Scope | Status |
| --- | --- | --- |
| 1 | Data model, sidebar, the seven lists, to-dos, areas, projects and headings | Done |
| 2 | Tags, When and deadline pickers, checklists and notes, priority and its automatic rules, Settings | Done |
| 3 | Saved searches, Today grouping, search and Quick Find, Quick Entry | Done |
| 4 | Drag and drop, keyboard shortcuts, undo | Done |
| 4a | Area ⋯ menu, contexts, project link under the open card | Done |
| 4b | To-do right-click menu | Done |
| 5 | 5a Completed list and subtitle; 5b themes; 5c when completed items move; 5e encrypted gist sync; 5f install and offline; 5g hosting at mytasks.fyi | Done |
| 6 | Finishing v1.0, one pull request at a time: 6a fixes (keys typed right after N, final Empty Trash); 6b calendar events in Today, after a throwaway sign-in prototype; 6c empty-state illustrations; 6d phone gestures; 6e resizable sidebar and sidebar blur; 6f three logo candidates | Next: 6a |

The title-bar area and long-list speed moved to v1.1.
