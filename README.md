# My Tasks

**Plan. Do. Succeed.** A free, open-source task manager in the style of Things, built as an installable web app (PWA). All data stays on your device.

- Live app: https://mytasks.fyi (from Milestone 5)
- License: MIT

## Status

v1 is being built in milestones. Each milestone is a pull request.

| Milestone | Scope | Status |
| --- | --- | --- |
| 1 | Data model, sidebar, the seven lists, to-dos, areas, projects and headings | Done |
| 2 | Tags, When and deadline pickers, checklists and notes, priority and its automatic rules, Settings | Done |
| 3 | Saved searches, Today grouping, search and Quick Find, Quick Entry | Done |
| 4 | Drag and drop, keyboard shortcuts (including Cmd/Ctrl+G to cycle Today grouping), undo | Done |
| 5 | Install, export/import and backups, themes, hosting at mytasks.fyi, accessibility | Planned |

## Develop

Requires Node 20 or later.

```bash
npm install
npm run dev      # local dev server
npm test         # unit tests (Vitest)
npm run check    # type-check (svelte-check)
npm run build    # production build in dist/
```

## Versions

The app shows its version and commit beside the sync status at the bottom of the sidebar, for example `v0.2.0 (a1b2c3d)`, and links it to that version's section of [CHANGELOG.md](CHANGELOG.md). Each pull request that changes the app adds a changelog section and sets the version in `package.json`: the middle number for new features, the last for fixes. 1.0.0 is the first release at mytasks.fyi.

The commit is read when the dev server starts or the app is built, so restart `npm run dev` after switching branches.

## Project layout

```
src/
  lib/model/    Types, dates, ids, ordering and the list membership rules (pure functions)
  lib/db/       IndexedDB schema (Dexie), all data operations (repo.ts), and
                transactions, the change log and undo (history.ts)
  lib/drag/     Pointer-events drag and drop, and its pure calculations
  lib/state/    Live data, routing and transient UI state
  lib/          shortcuts.ts (key bindings) and commands.ts (what they do)
  components/   Sidebar, rows, the to-do card, dialogs
  views/        Built-in lists, project and area pages
tests/          Unit tests for the model and data operations
```

## Keyboard

Press `?` in the app for the full list. Installed, My Tasks uses the Things shortcuts. In a browser tab, keys the browser keeps for itself (Cmd/Ctrl+N, T, R and others) are replaced by single-letter fallbacks, and `/` opens Quick Find.

## Data

Data rules follow the design document: every change runs in one transaction and is written to a local change log, so sync can be added later without a schema rewrite.
