# Changelog

What changed in each version of My Tasks. The app shows its version at the bottom of the sidebar and on the Setup screen; clicking it opens the [Roadmap](https://mytasks.fyi/roadmap/), which shows what's planned.

Versions follow [Semantic Versioning](https://semver.org). The first change to the app in a milestone raises the middle number and later ones the last number; the first number changes only for a major release. Each pull request that changes the app adds its section here and sets the version in `package.json`. The format follows [Keep a Changelog](https://keepachangelog.com).

<a id="v1.13.1"></a>

## 1.13.1 — 2026-11-25

### Added

- The calendar helper on a Mac turns tasks' reminders into Apple Reminders, in one list for all gists chosen at setup (a list of yours, or one named My Tasks, made for it; 0 leaves reminders off). Each open task with a reminder gets one, with its project's name in the notes; a repeating task gets one repeating reminder, and an after-completion repeat or a repeating project one for each copy. Changing a task's title or reminder changes it; completing the task completes it; canceling, trashing or deleting it, or clearing its reminder, removes it. Anything else set in Reminders, such as Urgent, is left alone, and a reminder ticked or deleted there isn't made again. The helper says so in each gist's calendar file, so the Reminder field appears in the app, and Settings › Calendar Events says "Reminders: on". The helper's `status` shows the list and each gist's number of reminders.
- The helper now has two files, `calendar_sync.py` and `reminders.py`; the Guide's setup lines download both, and update a helper already installed.

<a id="v1.13.0"></a>

## 1.13.0 — 2026-11-25

### Added

- A task can have a reminder: a date and time, set with the bell in the task's card, Reminder… in the task menu (for several selected tasks too), or Cmd+Shift+R (R in a browser tab). Its picker reads typed dates and times ("tomorrow 9am", "fri 2:30pm", "in 2 hours"), and offers Later Today, Tomorrow and On the start date, a calendar and a time. A repeating task keeps only the time, and each copy reminds at that time on its own day. The row shows a small bell. The reminder field shows once the calendar helper on a Mac turns this gist's reminders into Apple Reminders, which comes in the next update.
- Import's CSV format has a `reminder` column: `2026-11-26 09:00`, or the time only for a repeating task.

### Changed

- Tasks and the gist move to schema 15. Every device needs this version before it can sync again; an older one asks to be updated.

<a id="v1.12.0"></a>

## 1.12.0 — 2026-11-25

### Added

- Import… reads Todoist's own export files (a project's ⋯ › Import & export › Export to CSV, with Use relative dates unticked), one project per file, several at once. Sections become headings, labels in a task's name become tags, p1–p3 become P1–P3, descriptions and comments go into the notes, and English dates, deadlines and repeats ("every friday", "every 1st", "every! 3 days") are read. A sub-task becomes a task of its own, naming its parent in its notes. A date that can't be read, and a reminder, are kept as text in the notes. The preview says the file was read as a Todoist export and names each project. The Guide's "Importing from Todoist" section gives the steps and the limits.

<a id="v1.11.8"></a>

## 1.11.8 — 2026-11-24

### Changed

- Wording: gists live in your GitHub account, and a device connects to several of them. The Change Token dialog says the new token is used for every gist connected on the device that used the old one; the Guide, Limitations and Roadmap pages say the same.

<a id="v1.11.7"></a>

## 1.11.7 — 2026-11-24

### Fixed

- Adding an existing gist under a new name wrote the name using the copy of the gist read when its passphrase was entered, so a change another device synced to that gist in the meantime was left out until that device synced again. Add Gist… now reads the gist again just before writing the name.

<a id="v1.11.6"></a>

## 1.11.6 — 2026-11-24

### Changed

- The sidebar now also warns when a gist's file nears its 5 MB limit: from 4.5 MB it says "Your gist is 4.6 MB of 5 MB. Make room", as it does from 4,500 tasks, so tasks with long notes or checklists don't reach the limit unannounced. With both near, it shows both. The size is the gist's as of the last sync. The Guide's "How many tasks" section explains both limits.

<a id="v1.11.5"></a>

## 1.11.5 — 2026-11-24

### Changed

- Change Token (Settings › Sync) now gives the new token to every gist on the device that used the old one, not only the open gist, after checking that it reaches each of them from the same GitHub account. A gist added with a different token keeps its own. Use Change Token once on each device.

<a id="v1.11.4"></a>

## 1.11.4 — 2026-11-24

### Fixed

- After every gist on a device was disconnected, a gist set up there again could take the old gist's place, so adding the old gist back later failed, and wrote its new name into it first. Disconnecting the last gist now starts the device afresh, Add Gist… checks the device before writing anything to the gist, and a device already in this state gives the gist being added a name of its own.

<a id="v1.11.3"></a>

## 1.11.3 — 2026-11-24

### Changed

- The calendar helper on your Mac lets you choose the calendars for each gist, such as only your work calendar in Work. Its setup lists your calendars once, then asks for each gist: press Return for all, or 0 for none. How many months ahead is still set once for all gists. Settings from earlier versions keep working: each gist gets the calendars chosen before, until you run setup again.

<a id="v1.11.2"></a>

## 1.11.2 — 2026-11-24

### Changed

- The calendar helper on your Mac writes your events to every one of your gists, each encrypted with that gist's own passphrase. Its setup asks for each gist's passphrase in turn, by the gist's name; press Return to skip one. `status` shows a line for each gist.
- A gist's name is now also in its description on GitHub, such as "My Tasks · Work", in plain text, so the helper can show it before you enter the passphrase. It updates the next time the gist syncs a change. Your tasks stay encrypted.
- If you change one gist's passphrase, the helper stops writing to that gist only; your other gists keep getting events.
- A gist the helper has no passphrase for, such as one added after its setup, says so in Settings › Calendar Events, with a reminder to run the helper's setup again.

<a id="v1.11.1"></a>

## 1.11.1 — 2026-11-24

### Added

- Add Gist…, in Settings › Sync and in the gist switcher: add another gist to this device, such as Work and Personal. Pick one of your other My Tasks gists and enter its passphrase, or create a new gist with its own passphrase, then give it a name and a colour. The app then opens the new gist.
- With more than one gist on the device, a band under the sidebar's header shows the open gist's name in its colour. Click it to switch to another gist, add one, or manage them. On phones the band is at the top of the lists, and each page shows the gist's name under its title.
- Settings › Sync lists your gists, with Rename… for the open one (its name and colour, kept in the gist so your other devices show them) and Switch for the others.

### Changed

- With more than one gist, Disconnect This Device becomes Disconnect This Gist: it removes only the open gist from this device, and the app opens another.

<a id="v1.11.0"></a>

## 1.11.0 — 2026-11-24

### Added

- Groundwork for several gists on one device (Milestone 19), such as Work and Personal: each gist will have its own copy of its tasks on the device, its own passphrase, and a name and colour. Nothing changes on screen yet; adding and switching gists come in the next version.
- Each gist has a name and a colour, kept encrypted in the gist so every device shows the same. A gist from before this version is named **Default**, and can be renamed once naming arrives.

### Changed

- Backup and archive file names include the gist's name, such as "My Tasks Default backup 2026-11-24 0905.json".
- The theme (Light, Dark or System) is kept for the device rather than with the tasks, so it stays the same whichever gist is open. Your current choice carries over.
- Every device needs this version before it syncs with a device that has it: an older version says "Update needed — reload the app".

<a id="v1.10.5"></a>

## 1.10.5 — 2026-11-23

### Fixed

- Giving a sequential project's next task a later start date (or Deferred) now sticks: the project waits for it, and nothing moves into Today until that date. Before, the next sync put the task straight back in Today. This also applies to a task dated later before its turn: when its turn comes, the project waits for its date instead of bringing it in early.

<a id="v1.10.4"></a>

## 1.10.4 — 2026-11-23

### Fixed

- On phones, Today's ⋯ and Hide / Show dropped to a second line under the title; they now stay on one line.

<a id="v1.10.3"></a>

## 1.10.3 — 2026-11-23

### Added

- Today has a small **Hide** button after its ⋯ when it holds completed tasks: it hides them for now and becomes **Show**, which brings them back. A task you check off still shows for a moment first. The choice is for that device only, and completed tasks show again whenever the app opens.

<a id="v1.10.2"></a>

## 1.10.2 — 2026-11-23

### Added

- While a device is offline, the sidebar counts the changes waiting to sync: "Offline · 3 changes not synced". Until it syncs, those changes are only on that device.

<a id="v1.10.1"></a>

## 1.10.1 — 2026-11-23

### Added

- When a change you made is replaced by a later change to the same part of the task on another device (such as both of you changing its title), your device now tells you after it syncs: "1 of your changes was replaced by a later change from another device", with each task or project and what was replaced, or that it was deleted on another device. Click a task to open it; OK closes the notice. Nothing of the replaced change is kept. No notice when both devices made the same change, or for a priority set automatically.

<a id="v1.10.0"></a>

## 1.10.0 — 2026-11-23

### Changed

- Changes to different parts of the same task on two devices are now all kept. If one device completes a task while offline and another adds a note to it, the task ends up completed with the note, on both. A task's parts are whether it's done, its title, its notes, its dates, its priority, its context, its tags and where it is; projects work the same way. When the same part is changed on two devices before they sync, the later change still wins.
- **Every device needs this version before it can sync again.** A device still on 1.9 says "Update needed — reload the app" until it's updated. (Database schema 13: each task and project records when each of its parts last changed. Your gist grows by a few percent; the 5,000-task limit stays.)

<a id="v1.9.4"></a>

## 1.9.4 — 2026-11-22

### Fixed

- A device opened after a while no longer reopens tasks you completed on another device meanwhile. When the app opened or came back, it moved tasks into Today and made repeat copies from the device's older copy before syncing, and those changes, being newer, replaced the completions on every device. It now syncs first, then moves tasks into Today. Offline, it moves them once the sync gives up.

<a id="v1.9.3"></a>

## 1.9.3 — 2026-11-22

### Changed

- Choosing a priority of None keeps a task in Today without one, but no longer locks it out of the automatic priorities for good. Once the task is outside Today, or enters Today again (a new start date, a sequential project's release, a repeat's copy), the automatic P2, a sequential project's priority and the automatic P1 for a due task apply to it again. Tasks left with a chosen None outside Today are freed the next time My Tasks opens.

<a id="v1.9.2"></a>

## 1.9.2 — 2026-11-22

### Fixed

- A device still on 1.8 or earlier now says "Update needed — reload the app", rather than "Sync error", once the Unscheduled setting from 1.9.0 is in your gist. (Database schema 12; no data changes.)

<a id="v1.9.1"></a>

## 1.9.1 — 2026-11-22

### Changed

- Scheduled lists each day's tasks by priority, P1 first and tasks with no priority last. Tasks with the same priority keep their order.

<a id="v1.9.0"></a>

## 1.9.0 — 2026-11-22

### Added

- Unscheduled shows the first 3 tasks of each project or area, with a grey Show All under the rest. Show All opens that group, and Show 3 under it closes it again. Settings › Unscheduled sets how many: 1, 2, 3, 5, 10, 20 or All.

<a id="v1.8.6"></a>

## 1.8.6 — 2026-11-22

### Fixed

- A task or project that repeats after completion no longer gets stuck when its current copy is moved to the Trash or deleted. The next copy is dated from that day, as when a copy is done. Any already stuck are released the next time My Tasks opens.
- Create Next Copy makes the copy even when that day's copy was deleted (it did nothing before).

<a id="v1.8.5"></a>

## 1.8.5 — 2026-11-22

### Changed

- **Limitations page:** item 7, now "What a web app can't do on its own", says reminders are coming through the helper on a Mac (Mac only for now), instead of ruling them out. Its "Last updated" date, which Setup records when you accept the limitations, is now November 22, 2026.

<a id="v1.8.4"></a>

## 1.8.4 — 2026-11-22

### Fixed

- **An Apple Pencil no longer reorders things by accident.** On iPad, the Pencil started a drag after the slightest movement, as a mouse does, so tapping a project in the sidebar could move it. It now drags only after a long press, as a finger does. A checklist item's ≡ handle still drags at once.

<a id="v1.8.3"></a>

## 1.8.3 — 2026-11-22

### Changed

- **Larger text on the Mac:** task titles 16 px (were 15), the project or area line and the row's details 13 px (were 12), notes, checklist items and the open task's title a size larger, and rows 34 px high (were 32). iPhone and iPad touch sizes are unchanged.

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
