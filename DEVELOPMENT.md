# Developing My Tasks

Technical notes for running My Tasks locally and finding your way around the code. For what the app is, see the [README](README.md).

## Run it

Requires Node 20 or later.

```bash
npm install
npm run dev      # local dev server: the app at http://localhost:5173/app/
npm test         # unit tests (Vitest)
npm run test:ui  # interface tests (Playwright): builds, then runs real browsers
npm run check    # type-check (svelte-check)
npm run build    # production build in dist/: the website, with the app in dist/app/
npm run preview  # serve dist/ as the host does: website at http://localhost:4173/, app at /app/
npm run screenshots  # retake the README and website screenshots
npm run screenshots:book  # take the book's screenshots into book/shots/
```

The dev server serves only the app. To see the website, run `npm run build` then `npm run preview`.

The app shows only its Setup screen until it is connected to a GitHub Gist, so you need a personal access token (classic, `gist` scope) to get past it.

## Interface tests

`npm run test:ui` builds the app and runs `e2e/` in real browsers against it, served on port 4174 as `npm run preview` serves it (`playwright.config.ts`). Every test runs in desktop Chromium and desktop WebKit (close to Safari, the reference platform); `e2e/phone.spec.ts` runs in WebKit at iPhone size. They cover what the unit tests can't see: real IndexedDB transactions, Web Crypto, the Content Security Policy, the service worker, the website as served, and the phone layout.

- In the pull request check they run only when the PR can reach the app. A PR that changes only `site/`, `docs/` or the top-level `.md` files (`scripts/websiteOnly.mjs`, job `scope` in the workflow) skips them, and the main branch rule accepts the skipped check.
- GitHub is faked: `e2e/fakeGitHub.ts` answers the browser's requests from the unit tests' `FakeGitHub`, so nothing reaches GitHub. Two browser contexts given the same `FakeGitHub` act as two devices sharing a gist.
- `e2e/app.ts` holds the shared steps: connecting through Setup, adding a task, and `watchErrors`, which collects uncaught errors and console errors, so a test can expect none.
- The first run needs the browsers: `npx playwright install chromium webkit`. They go in your user folder, so no admin rights are needed.
- `npx playwright test --project=chromium` runs one browser; `npx playwright show-report` opens the last report.
- `npm run perf` is the NFR-7 timing run, by hand only (`perf/`, its own config): it seeds 4,000 open and 1,000 completed tasks straight into IndexedDB, then prints how long Quick Find, typing in a task's title around a save, a check-off and a change to 200 selected tasks take in desktop Chromium, with the long tasks (over 50 ms) and a CPU profile. It asserts nothing and isn't part of `npm run test:ui` or the PR check. Build with `sourcemap: true` for a run to name the functions in its profiles.
- `npm run screenshots` retakes `docs/images/today.png` and the Home page's `site/assets/shots/` from the current code, with Marcus Reyes's sample from the book (below), Today grouped by his priorities (`e2e/screenshots.shoot.ts`, `playwright.screenshots.config.ts`). It uses Playwright's Chromium (installed as above); run it on a Mac, so the text is in the Mac's font. It isn't part of `npm run test:ui`; `tests/backup.test.ts` checks the sample still passes Restore's checks.
- `npm run screenshots:book` takes the book's screenshots into `book/shots/` (not in git), one per picture, named for its chapter, from Marcus Reyes's sample in `e2e/marcusData.ts`: his tasks restored as a backup and his calendar sealed into the faked gist (`addCalendar` in `e2e/app.ts`), with the clock fixed at 8:45 a.m. (`e2e/book.shoot.ts`; `e2e/marcusPage.ts` opens the sample for both commands). Everything is built for the day it runs. Both samples share the record builders in `e2e/sampleRecords.ts`, and `tests/backup.test.ts` checks Marcus's backup and calendar pass the app's checks.
- **A change that a user can see or that touches the database gets an interface test**, alongside its unit tests.
- **Before adding a test, check the existing ones for overlap**, and extend a test that already covers the code rather than adding a near-copy. Test files are named by feature (`tests/priority.test.ts`, `e2e/sortByDate.spec.ts`), and test names say "tasks", like the app.
- **Lists read the focused snapshot.** Views read `snapshot` (`src/lib/state/live.ts`), which is the whole database narrowed to the focused area, if any (FR-22.1, `src/lib/model/focus.ts`); that's how every list, count, Quick Find and saved search follows the focus without code of its own. Read `fullSnapshot` only where every area must show whatever the focus, as the Move dialog's places do. The focus is kept on the device (`src/lib/state/focus.ts`) and never syncs.
- **Menus share their commands.** A project's, area's or saved search's ⋯ menu and its right-click menu in the sidebar (`SidebarMenu.svelte`, items from `src/lib/model/sidebarMenu.ts`) run the same functions in `actions.ts` and ask with the same confirmations from `dialogs.ts`; change them there, not in a view.

## Tech

Svelte 5 and TypeScript, built with Vite. Data lives in IndexedDB through Dexie. Sync goes to the user's own GitHub Gist, encrypted in the browser with Web Crypto (PBKDF2-SHA-256 and AES-256-GCM). There is no server.

## Project layout

```
src/
  lib/model/    Types, dates, ids, ordering and the list membership rules (pure functions)
  lib/db/       IndexedDB schema (Dexie), all data operations (repo.ts), and
                transactions and undo (history.ts)
  lib/sync/     Sync through the user's GitHub Gist: setup, encryption, merging
  lib/calendar/ Calendar events from the Mac helper's calendar.json: checks, day
                rules and wording (events.ts, pure), and the live state (calendar.ts)
  lib/drag/     Pointer-events drag and drop, and its pure calculations
  lib/pwa/      Install and offline: which browser, the install prompt, updates
  lib/state/    Live data, routing and transient UI state
  lib/          shortcuts.ts (key bindings), commands.ts (what they do),
                actions.ts (shared actions), dialogs.ts (shared confirmations),
                menuNav.ts (keys and placement for the right-click menus),
                version.ts (the version stamp) and csp.ts (the Content Security Policy)
  components/   Sidebar, rows, the task card, menus, dialogs, Setup
  views/        Built-in lists, project and area pages, Settings
site/           The website at the root of mytasks.fyi (plain HTML and CSS), copied
                around the app by the build; site/sw.js retires the old root service worker
scripts/        serve.mjs, the server behind npm run preview
helper/         Scripts for the user's Mac, standard Python 3: things_export.py (Things 3 to
                the import CSV) and calendar_sync.py (calendar events to calendar.json in
                the gist; needs the cryptography package). Tests: python3 -m unittest
                discover helper; helper/testdata/calendar-envelope.json is shared with
                tests/calendarEnvelope.test.ts, which proves the app can decrypt it
tests/          Unit tests; tests/fakeGitHub.ts fakes the gist API
e2e/            Interface tests (Playwright); e2e/fakeGitHub.ts puts the same fake in the browser
```

## Data

- Every change runs in one IndexedDB transaction. (A local change log was written until 1.3.7; nothing read it, so it was removed and is emptied at launch.)
- Inside a transaction, Dexie can lose track of it and commit too early (`PrematureCommitError`). Since 1.1.9, `tx` (`history.ts`) gives Dexie an `async` callback, which keeps the transaction open across awaits in nested `async` helpers; before, a helper awaiting another in a loop failed, in the browser and in the unit tests (`tests/sequential.test.ts`, "transactions"). Still, don't await a plain `async` helper before the first database request (load settings first), and keep read-only helpers (`liveChecklist`, `siblingKeys`, `shiftedKey`, `loadSettings` in `repo.ts`) returning Dexie's own promise with `then`. Check multi-record operations in a browser too.
- Records are never removed: a deletion sets `deletedAt`, so it syncs like any other change. A deleted record keeps only `id`, `deletedAt` and `modifiedAt` (a tombstone): delete with `bury` (`src/lib/db/bury.ts`), never by setting `deletedAt` yourself. Uploads and merges strip deleted records too (`src/lib/model/tombstone.ts`). Undo keeps its own full copy, so it can still restore a deleted record.
- Undo and redo (`history.ts`) keep the last 10 steps in memory, lost on reload. Undoing a step saves the records as they are as its redo step, and any new tracked change clears redo. A sync that writes a record (`tx` with `fromSync`) marks every kept step holding it stale, and a stale step is dropped rather than applied, so it never overwrites another device's newer edit.
- A change to several selected tasks (FR-10.1, `src/lib/bulk.ts`) runs the one-task change for each inside `undoGroup`, so it is one undo step, the automatic rules run per task, and the `onTodosChanged` listeners hear once, at the end of the group (one "where it went" message). The selection itself is pure (`src/lib/model/selection.ts`) and lives in `ui.selection`; setting `ui.selectedId` selects one row. On touch, Select mode (FR-10.2, `ui.selecting`) makes a tap toggle a row, and its floating bar (`SelectBar.svelte`) opens the task menu (`RowMenu.svelte`) for the selection, even of one task.
- Only read fields other than those three after filtering out deleted records.
- Sync merges record by record; the later `modifiedAt` wins. A `modifiedAt` later than now, from the gist or on this device, counts as now; the corrected copy is pushed and saved on this device. The merge records the time this device had for each row it writes (`seen` in `payload.ts`), and `applyRemote` writes a row only while the device still has that time, or when the row is later, so an edit made during a sync is never overwritten.
- This device's token, gist id and encryption key live in a separate database, `mytasks-device`, and never sync.
- Schema upgrades are per-record steps in `src/lib/db/migrations.ts`. Dexie's upgrade blocks in `database.ts` call them, and `upgradeList` uses the same steps for a list from an older version (a gist, or a backup file). **A new schema version adds its step there, a `this.version(n)` block, an entry in `STEPS`, and raises `SCHEMA_VERSION`.**
- Schema 5 (1.1.1) adds `collapsed` to headings (FR-2.7); areas already had it. Both sync like any field, and collapsing runs with `tx(…, { track: false })`, so it is never an undo step.
- Schemas 6 and 7 (1.1.9) add `releasedBy` and `releasedFrom` to tasks (7 adds `givenContextId` to `releasedFrom`; 6 existed only in local testing): which task's completion moved a task of a sequential project into Today, and where it was before, so unchecking or Reset Other Tasks can return it (FR-17.5, FR-17.6). Sequential projects themselves are a synced setting, `sequentialTags` (`src/lib/model/sequential.ts` holds the rules). **A synced setting needs both a rule in `validate.ts` (`SETTING_VALUES`) and an entry in `SYNCED_SETTINGS` (`payload.ts`)**; `tests/sync.test.ts` checks the two match (1.1.9 shipped without the second, so the setting didn't sync).
- Schema 8 (1.1.12) adds `sortByDate` to projects and headings (FR-2.8). `projectSections` orders a group by date only when given today's date (the project page passes it); counts and sequential projects call it without, so they keep manual order. Like collapsing, the choice syncs and is never an undo step.
- Schema 9 (1.2.12) adds `repeat` and `repeatOf` to tasks (FR-4.1 to FR-4.4). A task whose `repeat` is set is a repeating task's template: its `startDate` is its next copy's date (null while an after-completion repeat waits for its copy to be done), and it is never in Today, the Inbox or the counts, never checked off, and never released by a sequential project (`src/lib/model/lists.ts`, `sequential.ts`). The date rules, wording and copy ids are pure (`src/lib/model/repeat.ts`). `sweepRules` makes due copies first (at launch, on return and at midnight), and completing a copy dates an after-completion repeat's next one (`repo.ts`). **A copy's id comes from its template's id and date (`copyId`)**, the same on every device, so two devices making the same copy at midnight produce one record; a copy that exists, even deleted, isn't made again. Missed dates make one copy, for the latest.
- **A dated task or project is never Deferred** (1.5.3): `datedOutOfDeferred` (`lists.ts`) says what to correct; `sweepRules` corrects such records at launch (it syncs), `readBackup` corrects a backup's, and Import reads a deferred row with a `start_date` as a date. The app's own actions (`setWhen`, `createTodo`, Move to Deferred) never make one.
- Schema 11 (1.6.0) adds `repeat` and `repeatOf` to projects (FR-4.6), the same fields and rule as tasks. A project whose `repeat` is set is a repeating project's template; **`visibleTodos` hides a template's tasks**, so they are in no list, search or count, only on its own page, and the automatic rules and sequential release skip them. `makeProjectCopy` copies the whole project (headings not archived, tasks not trashed or under an archived heading, checklists), **every record's id from its template record's id and the date (`copyId`)**, so two devices make one copy. `setProjectRepeat` makes a first copy due now from the project as it is, then clears its tasks' dates and stops any repeating task inside. Templates are listed in Scheduled through `TodoGroup.projects`. From 1.6.1 (FR-4.6), a change that would give a template's task a date or close it goes through `ui.guardTemplate` (the `changeWhen`, `changeDeadline` and `changeStatus` helpers in `actions.ts`, and `ui.check`): it asks "Create Copy Now?", and `repo.copyNowForTasks` makes the next copy and returns its tasks' ids for the change, all one undo step. `closeProject` on a template closes its next copy early instead (`nextProjectCopyNow`). The template's Repeat › commands are `projectRepeatAction` (`actions.ts`), shared by its ⋯ and right-click menus; Stop… and deleting a template are confirmed through `ui.projectConfirm`. From 1.6.2, Import's `repeat` columns work on project rows: the plan makes the template (never matched by name to an existing project), refuses a dated or repeating task inside it, and `importRows` makes a copy that is due. The Things script writes a repeating project's template (Things keeps it as a separate record, in Someday) with its repeat columns and leaves its copies out.
- Schema 10 (1.5.2) changes no records: it marks lists that may hold the synced setting `showCalendarEvents` (FR-21.3), so older apps ask to be updated (see Sync).
- Nested tags and tag shortcuts (1.2.16, FR-6.1b, FR-6.4) use `parentTagId` and `shortcut`, stored and synced since schema 1, so no schema change. The tree rules are pure (`src/lib/model/tags.ts`: `descendantIds`, `tagTree`, `tagPills`). `nestTag` refuses a loop on one device, but two devices can still make one by nesting two tags under each other at once; **every walk of the tree keeps a visited set**, and `tagTree` lists tags caught in a loop at the top level, so they stay reachable. The shortcut keys are decided in `tagShortcut` (`shortcuts.ts`) only after the app's own bindings, so those always win.
- `readLocal` (`src/lib/sync/local.ts`) reads every synced table and the settings in one read transaction, so uploads and backup files are one consistent snapshot.
- Once a device is connected, the app asks the browser to keep its storage (`navigator.storage.persist()`); the answer isn't shown.

## Sync

- Everything read from the gist or uploaded to it is checked first (`src/lib/sync/validate.ts`): every field of every record and setting, with its type; a missing or unknown field fails. Only a record's own fields count, and each rule must return exactly `true`. Dates must be real; timestamps must be exactly as `toISOString()` writes them; `sortKey` and `todaySortKey` must be keys fractional-indexing accepts. A record id or setting key appearing twice fails (`isPayload` in `payload.ts`). Deleted records are checked on `id`, `deletedAt` and `modifiedAt` only (anything else is dropped by the merge). **When you add a field to a record type in `src/lib/model/types.ts`, add it to `validate.ts` too**; `tests/checks.test.ts` builds every kind of record through the app and fails otherwise.
- The gist file must use 600,000 PBKDF2 iterations, a 16-byte salt and a 12-byte IV, and be at most 5 MB (`src/lib/sync/crypto.ts`); a longer file isn't fetched in full. A file that fails any check is never applied. Every create and write goes through `sealPayload` (`cycle.ts`), which refuses (`toolarge`) an encrypted file over 5 MB, so the gist keeps its last good file.
- **Syncing only what changed** (NFR-7, `syncOnce` in `cycle.ts`). Each sync leaves a mark in this device's settings (`lastSync`: the gist file's IV, random for every write, and `stampOf` this device's list, a hash of every record's and synced setting's id and `modifiedAt`). When the next sync reads a file with the same IV, the gist is unchanged, and this device already holds everything in it, since records are never removed; so nothing is decrypted, checked or merged: with the same stamp nothing more is done, otherwise this device's list is uploaded (`tests/sync.test.ts` checks it equals a full merge's result). A list with a time later than now still takes the full sync. Every other action (Change Token, Change Passphrase, Enter Passphrase, Recreate Gist, Restore) clears the mark, and a stale mark only ever leads to a full sync. **Every change to a record or synced setting must set its `modifiedAt`**, or the stamp won't see it. GitHub's ETag with `If-None-Match` would skip the download too, but WebKit fails the 304 answer as a CORS error (conv. 2026-11-17-E), so it isn't used. `toBase64` and `fromBase64` (`crypto.ts`) use the browser's own `Uint8Array` functions where they exist.
- New passphrases need at least 12 characters (`MIN_PASSPHRASE`); entering an existing one has no minimum.
- Syncs and the Settings actions (Change Token, Change Passphrase, Enter Passphrase, Recreate Gist) run one at a time across every open window, under one Web Lock (`src/lib/sync/lock.ts`); without Web Locks they still run one at a time within the window. Each one first reads this device's saved settings inside the lock (and makes them the window's copy), so it never uses settings another window has changed since; it does nothing if the device was disconnected.
- Change Token accepts a token only when the GitHub account it belongs to (`/user`) owns the gist; a token that can't reach the gist is refused too.
- Disconnect stops new syncs, takes the same lock (so it waits for a running one in any window), clears this device, then tells the other windows over a `BroadcastChannel`; they stop and reload to Setup.
- Every GitHub request, its answer included, has a 30-second limit (`REQUEST_TIMEOUT_MS`); no answer in time counts as offline, so the 15-second offline retries take over.
- A rate limit schedules the next try for just after its reset time (or GitHub's `Retry-After`, or a minute when it gives neither).
- The full text of a long gist file is fetched only from `https://gist.githubusercontent.com`.
- A list read from the gist (`checkList` in `cycle.ts`) from a newer schema is refused (`newer`); one from an older schema is upgraded with `upgradeList`, checked, and marked `upgradedFrom` (in memory only), so the merge pushes it back at the current schema.
- **A new synced setting needs a new schema version**, even with no record change (schema 10, 1.5.2, added `showCalendarEvents`): an older app fails a setting it doesn't know as not valid (`malformed`), but refuses a newer schema with a message to update (`newer`).
- **Calendar events** (FR-21.2 to FR-21.4, 1.5.2). The Mac helper (`helper/calendar_sync.py`) writes `calendar.json` to the same gist, sealed like the tasks but with `app: "mytasks-calendar"` (`parseEnvelope(content, 'mytasks-calendar')`). `readGistFiles` reads it in the same request as the tasks, and `syncOnce` hands it to `receiveCalendar` (`src/lib/calendar/calendar.ts`) before the tasks; it is opened only when its IV changed, and never fails a sync (a file it can't open shows a problem in Settings › Calendar Events). The last file is kept encrypted in `mytasks-device` (row `calendar`, beside the sync settings), so events show at launch and offline, and Disconnect removes it. `readCalendar` (`events.ts`) checks the contents: a bad event is left out, and only `#rrggbb` colours and http(s) links reach the page. While the app is on screen it also syncs every 15 minutes (`REFRESH_MS`), so new events arrive without a change. Scheduled is grouped by day, month and year (FR-21.6): `scheduledGroups` (`lists.ts`) makes day groups for the next 7 days, the rest of the month (`range`), `SCHEDULED_MONTHS` months, then years, each with the dates it covers (`from`, `to`), and `ScheduledEvents.svelte` lists a group's events: a day's by time (`eventsOn`), a later group's once each on its first day there, a repeating one counted (`periodLines`); year groups have none. Today's block (`CalendarEvents.svelte`) also shows each calendar's name. The helper reads this month and 1 to 6 more (`last_day`, `config_months`; older settings in weeks read one). The events are display only: nothing in the app writes to a calendar or opens Calendar.

## Back up and restore (FR-12.8)

- `src/lib/backup.ts` builds the file: a header (`format: "mytasks-backup"`, `formatVersion`, `schema`, `savedAt`, `appVersion`) and the same tables and synced settings as the gist, from `readLocal`. It is unencrypted, and holds nothing from `mytasks-device`. Saving needs no network. In the installed iPhone and iPad app it goes through the share sheet (`saveMethod`); everywhere else it is an ordinary download. Messages say "downloaded", never "backed up".
- `readBackup` checks a file completely before anything changes: at most 5 MB, the format marker, the format version and schema (older upgraded, newer refused), then `checkList`, the gist's own checks, and at most 5,000 tasks (`toomany`).
- **Long lists drawn in steps** (NFR-7, `src/lib/state/rowLimit.svelte.ts`): a view draws its first 150 rows across all its groups, in screen order (each `TodoList` gets `start`, the rows before it, from `startsOf`), and `MoreRows.svelte` after its last list adds 150 more when it comes within about a screen of the bottom. The limit resets in `ui.enterView`. Anything that reads the view's rows from the page must see them all, so it calls `rowLimit.drawAll()` first: Select All, Down or Shift+Down from the last drawn row, Cmd+Down on it, a drag's start, a new task's placement (`createInline`), `beforeprint`, and a task to be shown (`ui.scrollId`, in `TodoList`). A new command that reads `main [data-row-id]` needs the same.
- **The task limit** (NFR-7, `src/lib/model/limits.ts`): 5,000 tasks that aren't deleted, counting Completed and the Trash, since about 6,000 typical tasks fill the 5 MB gist file. `ensureRoom` in `repo.ts` refuses, with `TaskLimitError`, any change that adds tasks past it: new tasks, Duplicate (a selection all or nothing), Duplicate Project and Convert to Project. A repeating task's next copy and tasks arriving by sync are never refused. `main.ts` turns an unhandled `TaskLimitError` into the "No room for more tasks" message, so every command is covered in one place; the sidebar warns from 4,500 (`SyncStatus.svelte`).
- **Several tasks, one save** (NFR-7, `src/lib/bulk.ts`): a change to the selected tasks runs every task's change inside one `undoGroup` and one `tx`, so the database is read again once, not once per task, and the change is all or nothing. Check a row against the selection with `ui.isSelected` (a set), and get the selected tasks with `ui.selectedTodos($todoById)`, never by going through every task.
- **Quick Find searches on Return** (FR-9.1, NFR-7, `QuickFind.svelte`): typing only edits the text; Return runs `quickFind`, and the next Return opens the highlighted result. Typing again clears the results.
- `SyncEngine.restore` runs under the sync lock. It reads and opens the gist first (any error: nothing changes), builds the replacement (`replacement` in `payload.ts`: the backup's records and synced settings stamped now; a tombstone stamped now for every other id on the device or in the gist; defaults for synced settings the file lacks), and checks it with `sealPayload` (validation and 5 MB). Then `replaceLocal` writes the device in one transaction, reading its ids again inside it, and the gist is overwritten. If only that write fails, the device is restored and the next sync pushes it (`pending`). Restore clears the undo and redo steps. `tests/backup.test.ts` has the named test of this policy with two devices.

## Install and offline

`vite-plugin-pwa` writes the web app manifest and a Workbox service worker that precaches the whole app, so it opens with no connection. The icons are made at build time from `public/favicon.svg` (`pwa-assets.config.ts`). The service worker handles only the app's own files: requests to GitHub always go to the network.

The dev server has no service worker. To try install, offline or updates, run `npm run build` then `npm run preview`.

- **Install.** Chrome and Edge show their own install prompt; on Safari and in Firefox, Install My Tasks opens a guide with the steps. In a Safari tab the sidebar shows the same Install My Tasks line; it no longer warns that Safari can clear a tab's data after 7 days unused, since the tasks are also in the gist (Limitations item 6).
- **Updates.** The app checks for a new version on start, hourly, and when you switch back to it. A new version installs in the background and waits. The "Update available" banner's Restart saves any edit in progress, then switches; nothing reloads by itself.
- **Title bar.** The `theme-color` tags in `index.html` give the installed window the sidebar's grey; `src/lib/theme.ts` keeps them in step with Appearance.

## Keyboard

Press `?` in the app for the full list. Installed, My Tasks uses the full shortcuts, including Cmd/Ctrl chords. In a browser tab, keys the browser keeps for itself (Cmd/Ctrl+N, T, R and others) are replaced by single-letter fallbacks, and `/` opens Quick Find.

## Hosting and security

My Tasks is served as static files from Cloudflare (since 2026-11-16; before that, GitHub Pages): the website at https://mytasks.fyi and the app at https://mytasks.fyi/app/. DNS for mytasks.fyi is at Cloudflare; Porkbun remains the registrar. Every push to main runs `.github/workflows/deploy.yml`: `npm audit --omit=dev` (known vulnerabilities in the packages the app ships), unit tests, type check and build, then publish `dist/`. Pull requests run that job without publishing, and a second job, `interface`, which runs the interface tests in Chromium and WebKit (stopped after 15 minutes if it hangs) and keeps Playwright's report for 7 days when one fails; a pull request is merged only once both pass. A push to main doesn't run the interface tests again on the same code (since 2026-11-18: it doubled each deploy, and a stalled GitHub machine held one up for half an hour). A failing step stops the deploy. `site/CNAME` names the domain for GitHub Pages, which a fork uses; Cloudflare takes the domain from `wrangler.jsonc`. The website's [Your own copy](https://mytasks.fyi/self-hosting/) page (`site/self-hosting/`) explains hosting a fork, for people who want their own copy.

- **Where it deploys.** With the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, the `deploy-cloudflare` job builds again from the same commit and uploads `dist/` to Cloudflare with Wrangler (`wrangler.jsonc`: a Worker that serves only the files, no Worker code). Without them (as in a fork), the `deploy` job publishes to GitHub Pages as before. `site/_headers` gives Cloudflare the headers GitHub Pages can't send: `frame-ancestors 'none'`, `nosniff`, a referrer policy, and `no-cache` on `site.css` and the service workers. The pages' own policies stay in their meta tags; a second full policy in a header would also apply, and the website's would block the app's sync. `wrangler.jsonc` names mytasks.fyi as the Worker's custom domain; a copy deployed to its own Cloudflare account changes that line to its own domain. To check the Cloudflare setup locally: `npm run build`, then `npx wrangler@4.163.0 dev` serves `dist/` as Cloudflare would.
- **Permissions.** The workflow can only read the repo; only the GitHub Pages deploy job can publish to Pages (`pages: write`, `id-token: write`). The Cloudflare token can only edit Workers.
- **Pinned actions.** Each action is pinned to a full commit hash, with its version in a comment, so a moved tag can't change what runs.
- **Dependabot** (`.github/dependabot.yml`) opens one grouped pull request a month for npm packages and one for GitHub Actions, and updates the pinned hashes. Test and merge them like any other pull request. Major TypeScript updates are ignored until `svelte-check` accepts TypeScript 7; remove that rule from `dependabot.yml` when it does.

The domain is where each device keeps its data (the browser's storage belongs to the site's address, not its path), so it must never change. The app moved from the root to `/app/` in 0.5.0 on the same domain, so every device kept its data. Two files keep earlier installs working:

- `site/sw.js` replaces the old root service worker: it deletes that worker's caches (not the app's), unregisters it and reloads open pages.
- `site/assets/site.js`, on the home page, forwards old links (`mytasks.fyi/#/today`) to the app, and sends an app installed before the move, which still starts at the root, straight to `/app/`.

The app links to the website from Setup, the sidebar's ? button, Settings › About My Tasks (including the Book page) and the version stamp (the Roadmap page), always in a new tab (`src/lib/website.ts`, `SiteLink.svelte`): opened inside an installed app, the website's home page would send it straight back to `/app/`. Setup won't connect until the user ticks that they have read the risks and limitations; this device records when, and the Limitations page's "Last updated" date (`LIMITATIONS_UPDATED`). **When the Limitations page changes, update its date and `LIMITATIONS_UPDATED` together**; `tests/website.test.ts` checks they match.

The website has its own, stricter policy (`SITE_CSP` in `src/lib/csp.ts`): its own scripts and styles only, nothing inline, and no connections. `tests/website.test.ts` checks every page for it, the shared header and footer, and every link.

The built page carries a strict Content Security Policy in a `<meta>` tag (`src/lib/csp.ts`, added by `vite.config.ts`): scripts only from the app, no `eval`, and no connections except the app and GitHub's gist API. On Cloudflare, `site/_headers` adds `frame-ancestors 'none'`; GitHub Pages (used by forks) can't send headers, so the app also checks whether it is inside a frame when it starts (`src/lib/framed.ts`); if so it starts nothing and shows a message with a link that opens it on its own. The dev server leaves the policy out, because it needs its own live-reload connection; `npm run preview` serves a build with it.

## Versions

The app shows its version and commit at the bottom of the sidebar and on Setup, for example `v0.2.0 (a1b2c3d)`, and links it to the website's [Roadmap](https://mytasks.fyi/roadmap/) page. 1.0.0 (2026-11-13) was the first release at mytasks.fyi. From Milestone 8, the first pull request in a milestone that changes the app raises the middle number (1.1.0), and later ones in the same milestone raise the last number (1.1.1); the first number changes only for a major release.

Release steps for each pull request that changes the app:

1. Set the version in `package.json`: the middle number for the milestone's first pull request that changes the app, the last number for later ones.
2. Add a section to [CHANGELOG.md](CHANGELOG.md).
3. Each pull request that finishes a planned item marks it done on the Roadmap page (`site/roadmap/index.html`), with a ✓ and the version it arrived in; when a milestone completes or a planned feature changes, update the page too. Update its "Last updated" date whenever it changes, in the same pull request.

The website names a version only on the Roadmap page and the Book page, which names the version the book reflects (`tests/website.test.ts`, which also checks that version is no newer than the app's).

**The book.** *My Tasks, Your Way* is free as an EPUB and PDF on the Book page (`site/book/`), with the same file names for every edition, and is also listed free at major online book outlets (the website names no store). Its screenshots come from `npm run screenshots:book` (`e2e/marcusData.ts`). A new edition replaces the two files, updates the Book page's edition, version, sizes and edition history, and has new ISBNs if the book changes substantially.

The commit is read when the dev server starts or the app is built, so restart `npm run dev` after switching branches.

## Milestones

v1 is built in milestones, each a pull request.

| Milestone | Scope | Status |
| --- | --- | --- |
| 1 | Data model, sidebar, the seven lists, tasks, areas, projects and headings | Done |
| 2 | Tags, When and deadline pickers, checklists and notes, priority and its automatic rules, Settings | Done |
| 3 | Saved searches, Today grouping, search and Quick Find, Quick Entry | Done |
| 4 | Drag and drop, keyboard shortcuts, undo | Done |
| 4a | Area ⋯ menu, contexts, project link under the open card | Done |
| 4b | Task right-click menu | Done |
| 5 | 5a Completed list and subtitle; 5b themes; 5c when completed items move; 5e encrypted gist sync; 5f install and offline; 5g hosting at mytasks.fyi | Done |
| 6 | Finishing touches: 6a fixes (keys typed right after N, final Empty Trash); the website and the Setup acknowledgment (0.5.0, 0.6.0); the Roadmap page and "tasks" wording (0.7.0) | Done |
| 7 | Ready for release (1.0.0): the security and privacy review and its fixes (0.7.1 to 0.9.1); back up and restore (0.10.0) | Done |
| 8 | Tidy and polish (1.1.0 to 1.1.18): interface tests, the logo, collapsible areas and headings, a resizable and hideable sidebar, empty states, print, sidebar menus, start-date marks, start dates and deadlines, sequential projects, the full check with iPhone and iPad testing | Done |
| 9 | This website (with 1.1.19 and 1.1.20): the self-hosting guide, the Compare page, r/mytasksfyi, donations, common questions, Ways to organize, the About page, a simpler header and footer | Done |
| 10 | Power editing (from 1.2.0): the heading on rows (1.2.0); where a task went when it leaves the Inbox (1.2.1) or is added out of view (1.2.2); focus on an area (1.2.3); typed dates (1.2.4); Tab through an open task (1.2.5); task entry (1.2.6); multi-step undo and redo (1.2.7); selecting and changing several tasks (1.2.8), on touch too (1.2.9); a tag icon on phone rows (1.2.11); repeating tasks (1.2.12), completing or skipping the next one early (1.2.13); dragging onto the sidebar's lists, several tasks at once and between Today's groups (1.2.14); swipe actions on touch (1.2.15); nested tags and tag shortcuts (1.2.16); speed with up to 5,000 tasks: the task limit (1.2.17), long lists drawn in steps (1.2.18), Quick Find on Return and saving several tasks at once (1.2.19), syncing only what changed (1.2.20) | Done |
| 11 | Review fixes (1.3.0 to 1.3.15), from the code and functional review of 1.2.20: a message when a change can't be saved (1.3.0); compact phone rows (1.3.1); dragging checklist items by a handle, on touch too (1.3.2, spacing fixed in 1.3.3, the others sliding apart in 1.3.4); the filter bar showing tags only (1.3.5); typed text saved when the app is hidden (1.3.6); the unused change log removed (1.3.7); repeating tasks kept right (1.3.8); one menu per project and area (1.3.9); long titles wrapping on phones (1.3.10); a filter in the Move dialog, the gear for Settings (1.3.11); dates in US order, the calendar from Sunday (1.3.12); tidy-up (1.3.13); one gap above the first task, Sync now from the sidebar (1.3.14); deleted-item markers cleaned up after 180 days (1.3.15) | Done |
| 12 | Import (1.4.0 to 1.4.5): a CSV format for areas, projects, headings, tasks, checklists and repeating tasks (the website's Import page); Import… in Settings (1.4.0), its own section (1.4.1); Archive (1.4.2); what's in your gist (1.4.3); a Things 3 script that writes the file (1.4.4); the website's pages brought up to date (1.4.5) | Done |
| 13 | Calendar events (1.5.0 to 1.5.4): a helper on the Mac that writes the chosen calendars' events to the gist (1.5.0), asking macOS for access (1.5.1); events in Today and Scheduled, with a details panel, and Scheduled grouped by day, month and year (1.5.2); a dated task never in Deferred (1.5.3); the tag bar kept clear of the events (1.5.4); the Privacy, Security, Limitations and Compare pages | Done |
| 14 | Repeating projects (1.6.0 to 1.6.2): a project repeats as a task does, each copy the whole project, with the template's banner and Scheduled (1.6.0); working ahead, completing, pausing and stopping a repeating project (1.6.1); Import and the Things script bringing repeating projects in (1.6.2); the Guide's Repeating tasks and projects section | Done |
| 15 | New logo (1.7.0): MT above a check in a circle, in teal, for the app, its icons and the website; screenshots on the website and in the README retaken; the book updated with its pictures retaken | Done |

The backlog is on the website's [Roadmap](https://mytasks.fyi/roadmap/) page.
