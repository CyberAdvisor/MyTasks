# My Tasks

**Getting Things Done Daily.** A free, open-source task manager in the style of Things, built as an installable web app (PWA). All data stays on your device.

- Live app: https://mytasks.fyi (from Milestone 5)
- License: MIT

## Status

v1 is being built in milestones. Each milestone is a pull request.

| Milestone | Scope | Status |
| --- | --- | --- |
| 1 | Data model, sidebar, the seven lists, to-dos, areas, projects and headings | In review |
| 2 | Tags, When and deadline pickers, checklists and notes, priority and its automatic rules | Planned |
| 3 | Saved searches, Today grouping, search and Quick Find, Quick Entry | Planned |
| 4 | Drag and drop, keyboard shortcuts, undo | Planned |
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

## Project layout

```
src/
  lib/model/    Types, dates, ids, ordering and the list membership rules (pure functions)
  lib/db/       IndexedDB schema (Dexie) and all data operations (repo.ts)
  lib/state/    Live data, routing and transient UI state
  components/   Sidebar, rows, the to-do card, dialogs
  views/        Built-in lists, project and area pages
tests/          Unit tests for the model and data operations
```

Data rules follow the design document: every change runs in one transaction and is written to a local change log, so sync can be added later without a schema rewrite.
