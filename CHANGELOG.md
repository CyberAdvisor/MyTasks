# Changelog

What changed in each version of My Tasks. The app shows its version at the bottom of the sidebar and on the Setup screen; clicking it opens that version's section here.

Versions follow [Semantic Versioning](https://semver.org): until the first release at mytasks.fyi (1.0.0), the middle number goes up for new features and the last number for fixes. Each pull request that changes the app adds its section here and sets the version in `package.json`. The format follows [Keep a Changelog](https://keepachangelog.com).

<a id="v0.4.2"></a>

## 0.4.2 — 2026-11-12

### Fixed

- Duplicate Project no longer fails when the project's to-dos have no checklist. Before, the copy was made but could not be undone, and it was not synced until the next change. (#27)

<a id="v0.4.1"></a>

## 0.4.1 — 2026-11-12

### Fixed

- Keys typed right after New To-Do (N, Space or Cmd+N) go into the new to-do's title. Before, the first few were lost or ran as commands. (#25)
- Empty Trash is final, as its confirmation says: Cmd+Z no longer brings the items back. On touch devices, an Undo toast still showing is hidden. Empty Trash also no longer fails with an error when the Trash holds several items. (#25)

<a id="v0.4.0"></a>

## 0.4.0 — 2026-11-12

### Added

- My Tasks is published at [mytasks.fyi](https://mytasks.fyi). Every change merged to main is tested, built and published automatically. (#23)

### Security

- A strict Content Security Policy: the app runs only its own scripts, never `eval`, and connects to nothing but itself and GitHub's gist API. (#23)

<a id="v0.3.0"></a>

## 0.3.0 — 2026-11-12

### Added

- My Tasks installs as an app and opens with no connection. Every file it needs is kept on the device. (#22)
- Install My Tasks at the bottom of the sidebar in Chrome, Edge and Firefox. In Chrome and Edge it opens the browser's install prompt; in Firefox it explains that Firefox can't install web apps. (#22)
- In a Safari tab, on iPhone, iPad or Mac, the sidebar warns that Safari clears a tab's data after 7 days unused, with a link to the install steps. (#22)
- On iPhone and iPad, Setup asks you to install My Tasks first, because the Home Screen app keeps its own data, separate from Safari. (#22)
- When a new version is ready, an "Update available" banner offers Restart. The app checks for a new version when you switch back to it. Restart saves what you're typing first; the app never reloads by itself. (#22)
- App icons for the Home Screen, Dock and taskbar, made from the logo. (#22)

### Changed

- The installed app's title bar is the sidebar's grey, light or dark with the theme, instead of blue. (#22)

<a id="v0.2.2"></a>

## 0.2.2 — 2026-11-12

### Changed

- The README now describes what My Tasks is: free, private and secure, with a screenshot of Today and a comparison with Things 3 and Todoist. It warns that the app is a work in progress and not yet for important data. The technical notes and milestone table moved to DEVELOPMENT.md. (#21)

<a id="v0.2.1"></a>

## 0.2.1 — 2026-11-12

### Fixed

- After the network came back, the sidebar kept saying Offline until the next change or Sync Now. While offline, the app now tries again every 15 seconds. (#19)

<a id="v0.2.0"></a>

## 0.2.0 — 2026-11-12

### Added

- The version and commit of the build, for example `v0.2.0 (a1b2c3d)`, beside the sync status at the bottom of the sidebar and on the Setup screen. It links to this changelog. (#18)

### Changed

- The subtitle is now "Plan. Do. Succeed." (#18)
- The sync status at the bottom of the sidebar keeps the last sync time on one line, beside the version. Being offline or a sync problem now shows on its own line above it. (#18)

<a id="v0.1.0"></a>

## 0.1.0 — 2026-11-12

Everything built before versioning started (#1 to #17):

- Milestones 1 to 4: the data model, the sidebar and its lists, to-dos, areas, projects and headings; tags, When and deadline pickers, checklists, notes, priority and its automatic rules, Settings; search, Quick Find, saved searches, Today grouping and Quick Entry; drag and drop, keyboard shortcuts and undo. (#1 to #5)
- Area ⋯ menu and blue menu icons, contexts on to-dos, and the project link under the open card. (#7 to #9)
- Logbook renamed Completed (#10); light and dark themes (#11); Today's sidebar counts add up to the list (#12); when completed items move to Completed (#13).
- The user's GitHub Gist as the data store, encrypted with a passphrase. (#14)
- The to-do right-click menu, as in Things. (#15)
- Move to Completed moved from a header button into the ⋯ menus, and Today's grouping moved from a bar into its ⋯ menu. (#16, #17)
