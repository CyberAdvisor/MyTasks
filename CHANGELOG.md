# Changelog

What changed in each version of My Tasks. The app shows its version at the bottom of the sidebar and on the Setup screen; clicking it opens the [Roadmap](https://mytasks.fyi/roadmap/), which shows what's planned.

Versions follow [Semantic Versioning](https://semver.org). The first change to the app in a milestone raises the middle number and later ones the last number; the first number changes only for a major release. Each pull request that changes the app adds its section here and sets the version in `package.json`. The format follows [Keep a Changelog](https://keepachangelog.com).

<a id="v1.8.4"></a>

## 1.8.4 — 2026-11-22

### Fixed

- **An Apple Pencil no longer reorders things by accident.** On iPad, the Pencil started a drag after the slightest movement, as a mouse does, so tapping a project in the sidebar could move it. It now drags only after a long press, as a finger does. A checklist item's ≡ handle still drags at once.

<a id="v1.8.3"></a>

## 1.8.3 — 2026-11-22

### Changed

- **Larger text on the Mac** (with a mouse or trackpad), closer to Things: task titles 16 px (were 15), the project or area line and the row's details 13 px (were 12), notes, checklist items and the open task's title a size larger, and rows 34 px high (were 32). iPhone and iPad touch sizes are unchanged.

<a id="v1.8.2"></a>

## 1.8.2 — 2026-11-21

### Added

- **Links in checklist items:** an item with a link, written as `[label](https://…)` or just the address, shows it clickable, opening in a new tab. A click or tap anywhere else on the item edits it as typed. Other marks, such as `**`, stay as typed in checklist items.

<a id="v1.8.1"></a>

## 1.8.1 — 2026-11-21

### Fixed

- **Links in notes open on iPhone and iPad.** A tap on a link did nothing.
- **Bullets in notes are solid** in an open task, not hollow circles.
- **"This is a copy of a repeating task"** no longer squeezes into a narrow column on a phone: Show Repeating Task moves under it when there isn't room.
- **A long task title wraps** in the open task instead of running off the edge. Return still closes the task, and a pasted line break becomes a space.

<a id="v1.8.0"></a>

## 1.8.0 — 2026-11-21

### Added

- **Formatted notes:** a task's or project's notes show **bold**, *italic*, bullet and numbered lists, and links once you leave them. Type `**bold**`, `*italic*` or `_italic_`, start lines with `- ` or `1. `, and write links as `[label](https://…)` or just the address. A click on a link opens it in a new tab; a click anywhere else on the notes edits them as typed. Notes are still saved as plain text, and only web and email links become clickable.

<a id="v1.7.0"></a>

## 1.7.0 — 2026-11-21

### Changed

- **A new logo:** "MT" above a check in a circle, in teal, in the sidebar, on Setup, in the browser tab, in every app icon and in the website's header. In a tab at its smallest size it shows just the MT. It follows the system's light or dark appearance in the tab, and Settings › Appearance in the app.

### Good to know

- **An installed app may keep its old icon** until it's removed and installed again. Your tasks stay in your gist, so after reinstalling, connect with your token and passphrase as before.

<a id="v1.6.4"></a>

## 1.6.4 — 2026-11-21

My Tasks as it is today: a free, open-source task manager that works offline and keeps your tasks in step across your devices through your own GitHub Gist, encrypted with your passphrase. There is no My Tasks server.

- **Lists:** Inbox, Today, Scheduled, Unscheduled, Deferred, Completed and Trash, with areas, projects and headings to organize everything.
- **Planning:** start dates and deadlines, typed dates ("next fri"), priorities P1–P5 with your own labels, contexts, tags (nested, with shortcuts), checklists and notes.
- **Today:** grouped by project, priority or context, with your Mac's calendar events through the calendar helper.
- **Repeating tasks and projects,** sequential projects, focus on one area, and Sort by Date.
- **Working fast:** Quick Entry, Quick Find, saved searches, selecting several tasks at once, drag and drop, swipe actions, multi-step undo and redo, and full keyboard shortcuts.
- **Your data:** encrypted sync, backup and restore, Archive, and Import from a CSV file, with a script that writes one from Things 3.
- **Everywhere:** installable on iPhone, iPad, Mac and PC, in light and dark.
