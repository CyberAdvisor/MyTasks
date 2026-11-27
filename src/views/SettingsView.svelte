<!--
  Settings (design doc, Section 5.10 FR-14.13 and Section 5.4 FR-6.1).
  - Sync (FR-19.6 to FR-19.8): Your gists (FR-19.16: each gist on this
    device with Rename… or Switch, then Add Gist…), then the active gist's
    connection, its problems and their fixes, Sync Now, Change Token, Change
    Passphrase, Disconnect.
  - Calendar Events (FR-21.3): once the Mac helper has written this gist's
    calendar file, show or hide its events, when it last wrote them or why
    they can't be read; with the helper's setup marker, only that it must be
    set up for this gist; with no file, only a pointer to the Guide's setup.
  - Backup (FR-12.8): Save Backup downloads a file of all synced data;
    Restore from Backup… checks a file, confirms, then replaces everything.
  - Archive (FR-12.11): old completed items to a CSV file, then removed
    (ArchiveControls).
  - Import From Other Apps (FR-12.6): Import… adds a CSV file's tasks
    (ImportButton).
  - Appearance (FR-V.3): System, Light or Dark.
  - Task Titles (FR-1.12): whether this device reads dates and details typed
    in a task's title; off until switched on.
  - Completed Items: when completed items move to Completed (FR-12.2) and
    the two "move to the bottom" switches (FR-12.7, FR-7.5).
  - Priority Settings: P1–P5 labels and the two automatic-rule switches.
  - Sequential Projects (FR-17.1): tags that make a project sequential.
  - Tags: create, rename, reorder, nest, give shortcuts and delete (the Manage Tags window; TagList).
  - Contexts (FR-18.2): the same, for the contexts a to-do can be in.
  - About My Tasks: links to the website's pages, each in a new tab.
  Changes save as soon as a field is left or a switch is flipped.
-->
<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import ViewHeader from '../components/ViewHeader.svelte';
  import ChoiceDialog from '../components/ChoiceDialog.svelte';
  import ImportButton from '../components/ImportButton.svelte';
  import ArchiveControls from '../components/ArchiveControls.svelte';
  import NamedList from '../components/NamedList.svelte';
  import TagList from '../components/TagList.svelte';
  import Segmented from '../components/Segmented.svelte';
  import { settings, snapshot } from '../lib/state/live';
  import { setTheme, theme } from '../lib/state/theme';
  import { readTitles, setReadTitles } from '../lib/titleEntry';
  import { bySortKey } from '../lib/model/order';
  import { descendantIds } from '../lib/model/tags';
  import {
    DEFAULT_PRIORITY_LABELS,
    PRIORITIES,
    UNSCHEDULED_LIMITS,
    cleanLabels,
    gistName,
    type MoveToCompleted,
    type Theme,
  } from '../lib/model/settings';
  import * as repo from '../lib/db/repo';
  import type { ID, Priority } from '../lib/model/types';
  import SyncDialog, { type SyncForm } from '../components/SyncDialog.svelte';
  import RenameGistDialog from '../components/RenameGistDialog.svelte';
  import { deviceGists } from '../lib/gists/onDevice.svelte';
  import { activeDbName } from '../lib/gists/active';
  import { ui } from '../lib/state/ui.svelte';
  import SiteLink from '../components/SiteLink.svelte';
  import { COMMUNITY } from '../lib/website';
  import SequentialTags from '../components/SequentialTags.svelte';
  import { sync } from '../lib/sync/sync.svelte';
  import { errorText, problemText, whenSynced } from '../lib/sync/messages';
  import {
    BackupError,
    backupFileName,
    backupProblemText,
    buildBackup,
    countsOf,
    countsText,
    readBackup,
    type Backup,
  } from '../lib/backup';
  import { saveFile } from '../lib/saveFile';
  import { fileSizeText } from '../lib/model/overview';
  import { calendar, helperState, latestTime, remindersOn } from '../lib/calendar/calendar';
  import { ticksWrittenAt } from '../lib/reminders/ticks';
  import { formatTimestamp } from '../lib/model/dates';

  const THEME_OPTIONS: { value: Theme; label: string }[] = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];

  const MOVE_OPTIONS: { value: MoveToCompleted; label: string }[] = [
    { value: 'immediately', label: 'Immediately' },
    { value: 'daily', label: 'Daily' },
    { value: 'manually', label: 'Manually' },
  ];

  let contexts = $derived(bySortKey($snapshot.contexts));
  /** The tag or context waiting for delete confirmation. */
  let deleting = $state<{ kind: 'tag' | 'context'; id: ID; title: string } | null>(null);

  /** The sync form open, if any. */
  let syncForm = $state<SyncForm | null>(null);
  let confirmDisconnect = $state(false);
  let syncBusy = $state(false);
  let syncError = $state('');

  /** Run a Sync button's action, showing an error under the buttons. */
  async function syncAction(action: () => Promise<void>) {
    syncError = '';
    syncBusy = true;
    try {
      await action();
    } catch (e) {
      syncError = errorText(e);
    } finally {
      syncBusy = false;
    }
  }

  /** Rename… is open (FR-19.14). */
  let renaming = $state(false);
  /** Several gists on this device: Disconnect then removes only the open one (FR-19.16). */
  let severalGists = $derived(deviceGists.list.length > 1);
  /** Whether the Mac helper has written this gist's calendar file (Calendar Events' three states). */
  let helper = $derived(helperState($calendar));
  /** When the helper last wrote this gist (calendar.json or ticks.json), once it has written its calendar file. */
  let helperUpdatedAt = $derived(helper === 'ready' ? latestTime($calendar.updatedAt, $ticksWrittenAt) : null);

  /** Switch to another gist, then start again on it (FR-19.11). */
  function switchGist(db: string) {
    void syncAction(async () => {
      await sync.switchTo(db);
      location.replace(location.pathname);
    });
  }

  /** Disconnect clears this gist from the device, then the app restarts on another gist or at Setup. */
  async function onDisconnectChoice(v: string | null) {
    confirmDisconnect = false;
    if (v !== 'disconnect') return;
    await sync.disconnect();
    location.replace(location.pathname);
  }

  // ---------------------------------------------------------------------------
  // Backup (FR-12.8)
  // ---------------------------------------------------------------------------

  let fileInput: HTMLInputElement;
  /**
   * A checked backup waiting for the restore confirmation. Raw: a deep
   * reactive copy would hand proxies to IndexedDB, which can't store them.
   */
  let pendingRestore = $state.raw<Backup | null>(null);
  /** The confirmation's note after Save Backup First; once a file is saved, its button goes. */
  let savedFirst = $state('');
  let savedFirstOk = $state(false);
  let backupBusy = $state(false);
  let backupMessage = $state('');
  let backupError = $state('');
  /** "In your gist": counted again after each sync, and after Archive. */
  let counts = $state<Awaited<ReturnType<typeof repo.gistCounts>> | null>(null);
  $effect(() => {
    void sync.config?.lastSyncedAt;
    void archiveMessage;
    repo.gistCounts().then((c) => (counts = c));
  });
  /** Archive's result and problem lines (FR-12.11). */
  let archiveMessage = $state('');
  let archiveError = $state('');
  /** Import From Other Apps' result and problem lines (FR-12.6). */
  let importMessage = $state('');
  let importError = $state('');
  /** Replace With Gist (a device away too long) waiting for its confirmation. */
  let askReplace = $state(false);
  /** The note under the away message after its Save Backup. */
  let awayBackup = $state('');

  /**
   * Save a backup file of this device's tasks. Returns the message to show:
   * the browser started a download, or the share sheet took the file. It
   * says "downloaded", never "backed up": whether the file was kept is up to
   * the browser and the user. Empty when the share sheet was dismissed.
   */
  async function saveBackup(): Promise<string> {
    const now = new Date();
    const name = backupFileName(now, $settings.gistLabel);
    const file = new File([await buildBackup(now.toISOString())], name, { type: 'application/json' });
    const result = await saveFile(file);
    if (result === 'dismissed') return '';
    return result === 'shared' ? `Backup file shared: ${name}. Choose Save to Files to keep it.` : `Backup file downloaded: ${name}`;
  }

  async function onSaveBackup() {
    backupMessage = backupError = '';
    try {
      backupMessage = await saveBackup();
    } catch (e) {
      console.error(e);
      backupError = 'The backup file couldn’t be saved. Try again.';
    }
  }

  /** A file was picked: check it completely, then ask before restoring. */
  async function onBackupPicked() {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    backupMessage = backupError = '';
    try {
      pendingRestore = readBackup(await file.text());
      [savedFirst, savedFirstOk] = ['', false];
    } catch (e) {
      backupError = e instanceof BackupError ? backupProblemText(e.code) : 'This file couldn’t be read. Nothing was changed.';
    }
  }

  async function onRestoreChoice(v: string | null) {
    const backup = pendingRestore;
    if (v === 'save') {
      try {
        const done = await saveBackup();
        if (done) [savedFirst, savedFirstOk] = [done, true];
      } catch (e) {
        console.error(e);
        savedFirst = 'The backup file couldn’t be saved. Try again.';
      }
      return;
    }
    pendingRestore = null;
    if (v !== 'restore' || !backup) return;
    backupBusy = true;
    try {
      const result = await sync.restore(backup.list);
      const from = `Restored from the backup saved ${whenSynced(backup.savedAt)}.`;
      if (result === 'synced') backupMessage = from;
      else if (result === 'pending') backupMessage = `${from} Your gist will be updated at the next sync.`;
    } catch (e) {
      backupError = `Restore needs a working sync connection, so nothing was changed. ${errorText(e)}`;
    } finally {
      backupBusy = false;
    }
  }

  /** Save one priority label; an empty label returns to its default (FR-14.3). */
  function saveLabel(p: Priority, input: HTMLInputElement) {
    const labels = [...$settings.priorityLabels];
    labels[p - 1] = input.value;
    const clean = cleanLabels(labels);
    input.value = clean[p - 1];
    void repo.setSetting('priorityLabels', clean);
  }

  function resetLabel(p: Priority) {
    const labels = [...$settings.priorityLabels];
    labels[p - 1] = DEFAULT_PRIORITY_LABELS[p - 1];
    void repo.setSetting('priorityLabels', labels);
  }

  /** What deleting a tag also does: its nested tags go too (FR-6.1b). */
  function deleteTagMessage(id: ID): string {
    const nested = descendantIds(id, $snapshot.tags).size - 1;
    const also = nested === 1 ? ' The tag nested under it is deleted too.' : nested > 1 ? ` The ${nested} tags nested under it are deleted too.` : '';
    return `It will be removed from every task, project and area. The items themselves stay.${also}`;
  }

  function onDeleteChoice(v: string | null) {
    const item = deleting;
    deleting = null;
    if (v !== 'delete' || !item) return;
    void (item.kind === 'tag' ? repo.deleteTag(item.id) : repo.deleteContext(item.id));
  }

  /** Enter in a text field saves it by leaving the field. */
  const blurOnEnter = (e: KeyboardEvent) => {
    if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
  };
</script>

<ViewHeader title="Settings">
  {#snippet icon()}<Icon name="settings" size={26} color="var(--text-2)" />{/snippet}
</ViewHeader>

<section aria-labelledby="sync-heading">
  <h2 id="sync-heading">Sync</h2>
  <h3 id="your-gists">Your Gists</h3>
  <ul class="gists" aria-labelledby="your-gists">
    {#each deviceGists.list as g (g.db)}
      {@const open = g.db === activeDbName()}
      <li>
        <span class="gist-dot" style={`background: var(--gist-${g.label.colour})`} aria-hidden="true"></span>
        <span class="gist-name">{gistName(g.label)}</span>
        {#if open}<span class="gist-open">Open</span>{/if}
        {#if open}
          <button type="button" class="outline" onclick={() => (renaming = true)}>Rename…</button>
        {:else}
          <button type="button" class="outline" disabled={syncBusy} onclick={() => switchGist(g.db)}>Switch</button>
        {/if}
      </li>
    {/each}
  </ul>
  <p class="sync-buttons"><button type="button" class="outline" onclick={() => (ui.addingGist = true)}>Add Gist…</button></p>
  {#if severalGists}<h3>{gistName(deviceGists.active?.label ?? $settings.gistLabel)}</h3>{/if}
  {#if sync.status === 'error' && sync.problem}
    <p class="sync-problem" role="alert"><Icon name="alert" size={15} color="var(--danger)" /> {problemText(sync.problem, sync.retryAt)}</p>
    {#if sync.problem === 'passphrase'}
      <p><button type="button" class="btn-primary" onclick={() => (syncForm = 'enter-passphrase')}>Enter New Passphrase</button></p>
    {:else if sync.problem === 'away'}
      <p class="sync-buttons">
        <button
          type="button"
          class="outline"
          onclick={async () => {
            try {
              awayBackup = await saveBackup();
            } catch {
              awayBackup = 'The backup file couldn’t be saved. Try again.';
            }
          }}>Save Backup</button
        >
        <button type="button" class="btn-primary" disabled={syncBusy} onclick={() => (askReplace = true)}>Replace With Gist</button>
      </p>
      {#if awayBackup}<p class="help">{awayBackup}</p>{/if}
    {:else if sync.problem === 'notfound'}
      <p><button type="button" class="btn-primary" disabled={syncBusy} onclick={() => syncAction(() => sync.recreateGist())}>Recreate Gist</button></p>
    {/if}
  {:else if sync.status === 'offline'}
    <p class="sync-state"><Icon name="cloud-off" size={16} /> Offline — changes are saved on this device and sync when you’re back online.</p>
  {:else}
    <p class="sync-state"><Icon name="check" size={16} color="var(--c-logbook)" /> Connected to GitHub Gist</p>
  {/if}
  {#if sync.config}
    <p class="help">
      Gist {sync.config.gistId.slice(0, 8)}…{#if sync.config.lastSyncedAt}&nbsp;· Last synced {whenSynced(sync.config.lastSyncedAt)}{/if}{#if helperUpdatedAt}&nbsp;· Calendar helper last updated {whenSynced(helperUpdatedAt)}{/if}
    </p>
  {/if}
  {#if sync.config && counts}
    <table class="overview" aria-label="In your gist">
      <caption>In your gist</caption>
      <thead><tr><th></th><th>Open</th><th>Completed</th><th>In Trash</th><th>Deleted</th></tr></thead>
      <tbody>
        {#each [['Tasks', counts.tasks], ['Projects', counts.projects]] as const as [label, c] (label)}
          <tr><th scope="row">{label}</th><td>{c.open}</td><td>{c.completed}</td><td>{c.trash}</td><td>{c.deleted}</td></tr>
        {/each}
      </tbody>
    </table>
    <p class="help">
      File size: {sync.config.lastSync?.chars ? fileSizeText(sync.config.lastSync.chars) : 'after the next sync'}{#if sync.config.lastSyncedAt}&nbsp;· as of the last sync, {whenSynced(sync.config.lastSyncedAt)}{/if}.
      Completed includes canceled items; Deleted counts the small markers kept so other devices delete their copies too,
      cleared after 180 days.
    </p>
  {/if}
  <div class="sync-buttons">
    <button type="button" class="outline" disabled={sync.status === 'syncing'} onclick={() => syncAction(() => sync.syncNow())}>
      {sync.status === 'syncing' ? 'Syncing…' : 'Sync Now'}
    </button>
    <button type="button" class="outline" onclick={() => (syncForm = 'token')}>Change Token</button>
    <button type="button" class="outline" onclick={() => (syncForm = 'change-passphrase')}>Change Passphrase</button>
    <button type="button" class="outline danger" onclick={() => (confirmDisconnect = true)}>
      {severalGists ? 'Disconnect This Gist' : 'Disconnect This Device'}
    </button>
  </div>
  {#if syncError}<p class="form-error" role="alert">⚠ {syncError}</p>{/if}
  <p class="help">
    Your tasks are encrypted with your passphrase before they reach GitHub. Disconnecting removes your tasks, token
    and key from this device; your tasks stay in your gist.
  </p>
</section>

<section aria-labelledby="calendar-heading">
  <h2 id="calendar-heading">Calendar Events</h2>
  {#if helper === 'none'}
    <p class="help">
      Calendar events and reminders need the My Tasks helper on a Mac.
      <SiteLink page="guide" hash="calendar">How to set it up</SiteLink>
    </p>
  {:else if helper === 'setup'}
    <p class="sync-problem" role="alert">
      <Icon name="alert" size={15} color="var(--danger)" /> Calendar events aren’t set up for this gist. On your Mac, run
      the calendar helper’s setup again.
    </p>
  {:else}
    <label class="switch-row">
      <input
        type="checkbox"
        role="switch"
        checked={$settings.showCalendarEvents}
        onchange={(e) => repo.setSetting('showCalendarEvents', e.currentTarget.checked)}
      />
      <span>Show calendar events in Today and Scheduled</span>
    </label>
    {#if $calendar.problem === 'passphrase'}
      <p class="sync-problem" role="alert">
        <Icon name="alert" size={15} color="var(--danger)" /> The calendar events were written with a different passphrase.
        On your Mac, run the calendar helper’s setup again.
      </p>
    {:else if $calendar.problem === 'unreadable'}
      <p class="sync-problem" role="alert">
        <Icon name="alert" size={15} color="var(--danger)" /> The calendar events in your gist couldn’t be read. Update the
        calendar helper on your Mac.
      </p>
    {:else if $calendar.data && $calendar.updatedAt}
      <p class="help">
        Last updated {formatTimestamp($calendar.updatedAt)} · {$calendar.data.events.length}
        {$calendar.data.events.length === 1 ? 'event' : 'events'} from {$calendar.data.calendars.length}
        {$calendar.data.calendars.length === 1 ? 'calendar' : 'calendars'}
      </p>
    {:else}
      <p class="help">No calendar events yet.</p>
    {/if}
    {#if $remindersOn}
      <p class="help">
        Reminders: on. The calendar helper on your Mac adds your tasks’ reminders to Apple Reminders.
      </p>
    {/if}
    <p class="help">
      Events come from the calendars on your Mac, through the calendar helper, encrypted in your gist like your tasks.
      They are read-only here. <SiteLink page="guide" hash="calendar">Set up the calendar helper</SiteLink>
    </p>
  {/if}
</section>

<section aria-labelledby="backup-heading">
  <h2 id="backup-heading">Backup</h2>
  <div class="sync-buttons">
    <button type="button" class="outline" onclick={onSaveBackup}>Save Backup</button>
    <button type="button" class="outline" disabled={backupBusy} onclick={() => fileInput.click()}>
      {backupBusy ? 'Restoring…' : 'Restore from Backup…'}
    </button>
    <input bind:this={fileInput} type="file" accept=".json,application/json" hidden onchange={onBackupPicked} />
  </div>
  {#if backupMessage}<p class="backup-done" role="status">{backupMessage}</p>{/if}
  {#if backupError}<p class="form-error" role="alert">⚠ {backupError}</p>{/if}
  <p class="help">
    The backup file is a copy of your tasks and synced settings that you keep yourself. It is not encrypted: anyone
    who can open it can read your tasks. Restoring replaces all your tasks, on every device, with the file’s.
  </p>
</section>

<section aria-labelledby="archive-heading">
  <h2 id="archive-heading">Archive</h2>
  <ArchiveControls onmessage={(t) => (archiveMessage = t)} onerror={(t) => (archiveError = t)} />
  {#if archiveMessage}<p class="backup-done" role="status">{archiveMessage}</p>{/if}
  {#if archiveError}<p class="form-error" role="alert">⚠ {archiveError}</p>{/if}
  <p class="help">
    Saves completed tasks and projects to a new CSV file, then removes them from My Tasks on every device, so your gist
    stays small. Removing them can’t be undone, so keep the file; Import… can bring them back from it.
  </p>
</section>

<section aria-labelledby="import-heading">
  <h2 id="import-heading">Import From Other Apps</h2>
  <div class="sync-buttons">
    <ImportButton disabled={backupBusy} onmessage={(t) => (importMessage = t)} onerror={(t) => (importError = t)} />
  </div>
  {#if importMessage}<p class="backup-done" role="status">{importMessage}</p>{/if}
  {#if importError}<p class="form-error" role="alert">⚠ {importError}</p>{/if}
  <p class="help">
    Add tasks from a CSV file in My Tasks’ format, or from one or more Todoist exports. What’s in the file is added to
    your tasks; nothing is replaced. The file’s columns, a template and a sample are on
    <SiteLink page="import">Import from other apps</SiteLink>.
  </p>
</section>

<section aria-labelledby="appearance-heading">
  <h2 id="appearance-heading">Appearance</h2>
  <div class="setting-row">
    <span>Theme</span>
    <Segmented
      label="Theme"
      options={THEME_OPTIONS}
      value={$theme}
      onchange={(v) => setTheme(v)}
    />
  </div>
  <p class="help">System follows your device's light or dark setting.</p>
</section>

<section aria-labelledby="titles-heading">
  <h2 id="titles-heading">Task Titles</h2>
  <label class="switch-row">
    <input type="checkbox" role="switch" checked={$readTitles} onchange={(e) => setReadTitles(e.currentTarget.checked)} />
    <span>Read dates and details from task titles</span>
  </label>
  <p class="help">
    When you type a new task's title, or add to one, words such as “tomorrow 9am”, “by fri”, “every mon”, p1,
    #tag and @context set the task's Start Date, deadline, reminder, repeat, priority, tags and context. Words in
    quotes stay in the title. This device only.
    <SiteLink page="guide" hash="title-words">How it reads titles</SiteLink>
  </p>
</section>

<section aria-labelledby="completed-heading">
  <h2 id="completed-heading">Completed Items</h2>
  <div class="setting-row">
    <span>Move completed items to Completed</span>
    <Segmented
      label="Move completed items to Completed"
      options={MOVE_OPTIONS}
      value={$settings.moveToCompleted}
      onchange={(v) => repo.setSetting('moveToCompleted', v)}
    />
  </div>
  <p class="help">
    Until they move, completed items stay in their list, struck through. Daily moves them at
    midnight. Manually waits for Move Completed Items.
  </p>
  <label class="switch-row">
    <input
      type="checkbox"
      role="switch"
      checked={$settings.sinkCompleted}
      onchange={(e) => repo.setSetting('sinkCompleted', e.currentTarget.checked)}
    />
    <span>Move completed tasks to the bottom of the list</span>
  </label>
  <label class="switch-row">
    <input
      type="checkbox"
      role="switch"
      checked={$settings.sinkChecked}
      onchange={(e) => repo.setSetting('sinkChecked', e.currentTarget.checked)}
    />
    <span>Move checked items to the bottom of the checklist</span>
  </label>
</section>

<section aria-labelledby="unscheduled-heading">
  <h2 id="unscheduled-heading">Unscheduled</h2>
  <div class="setting-row">
    <label for="unscheduled-limit">Tasks shown per project</label>
    <select
      id="unscheduled-limit"
      value={String($settings.unscheduledLimit ?? 'all')}
      onchange={(e) => repo.setSetting('unscheduledLimit', e.currentTarget.value === 'all' ? null : Number(e.currentTarget.value))}
    >
      {#each UNSCHEDULED_LIMITS as n (n ?? 'all')}<option value={String(n ?? 'all')}>{n ?? 'All'}</option>{/each}
    </select>
  </div>
  <p class="help">Projects and areas with more show a Show All button under their tasks.</p>
</section>

<section aria-labelledby="prio-heading">
  <h2 id="prio-heading">Priority Settings</h2>

  <h3>Labels</h3>
  <p class="help">Give each priority your own name. The order P1 (highest) to P5 never changes.</p>
  <ul class="rows">
    {#each PRIORITIES as p (p)}
      {@const label = $settings.priorityLabels[p - 1]}
      <li>
        <span class="prio prio-{p}">P{p}</span>
        <input
          class="text"
          value={label}
          aria-label="Label for P{p}"
          maxlength="24"
          onchange={(e) => saveLabel(p, e.currentTarget)}
          onkeydown={blurOnEnter}
        />
        {#if label !== DEFAULT_PRIORITY_LABELS[p - 1]}
          <button type="button" class="btn-plain small" onclick={() => resetLabel(p)}>Reset</button>
        {/if}
      </li>
    {/each}
  </ul>

  <h3>Automatic priority</h3>
  <label class="switch-row">
    <input
      type="checkbox"
      role="switch"
      checked={$settings.autoP1}
      onchange={(e) => repo.setSetting('autoP1', e.currentTarget.checked)}
    />
    <span>Set P1 automatically for due and overdue tasks in Today</span>
  </label>
  <label class="switch-row">
    <input
      type="checkbox"
      role="switch"
      checked={$settings.defaultP2}
      onchange={(e) => repo.setSetting('defaultP2', e.currentTarget.checked)}
    />
    <span>Set P2 by default for tasks added to Today</span>
  </label>
  <p class="help">
    These rules only fill in a priority you have not chosen yourself. Turning a switch off keeps the
    priorities it already set.
  </p>
</section>

<section aria-labelledby="seq-heading">
  <h2 id="seq-heading">Sequential Projects</h2>
  <SequentialTags />
</section>

<section aria-labelledby="tags-heading">
  <h2 id="tags-heading">Tags</h2>
  <p class="help">Drag a tag onto another, or use its ⋯ button, to nest it there. Click a tag’s box and press a key to give it a shortcut.</p>
  <TagList ondelete={(t) => (deleting = { kind: 'tag', id: t.id, title: t.title })} />
</section>

<section aria-labelledby="contexts-heading">
  <h2 id="contexts-heading">Contexts</h2>
  <p class="help">Where or how a task can be done, such as Home, Office or Phone. A task has one context or none.</p>
  <NamedList
    items={contexts}
    icon="context"
    noun="Context"
    onrename={repo.renameContext}
    onmove={repo.moveContext}
    ondelete={(c) => (deleting = { kind: 'context', ...c })}
    onadd={repo.createContext}
  />
</section>

<section aria-labelledby="about-heading">
  <h2 id="about-heading">About My Tasks</h2>
  <p class="help">Each opens in a new tab.</p>
  <ul class="about">
    <li><SiteLink page="home">Website</SiteLink></li>
    <li><SiteLink page="guide">Guide</SiteLink></li>
    <li><SiteLink page="book">The book: My Tasks, Your Way</SiteLink></li>
    <li><SiteLink page="limitations">Risks and limitations</SiteLink></li>
    <li><SiteLink page="privacy">Privacy</SiteLink></li>
    <li><SiteLink page="security">Security</SiteLink></li>
    <li><a href={COMMUNITY} target="_blank" rel="noopener noreferrer">Help and community (r/mytasksfyi)</a></li>
  </ul>
</section>

{#if syncForm}
  <SyncDialog form={syncForm} onclose={() => (syncForm = null)} />
{/if}

{#if renaming}
  <RenameGistDialog label={$settings.gistLabel} onclose={() => (renaming = false)} />
{/if}

{#if askReplace}
  <ChoiceDialog
    title="Replace this device’s tasks?"
    message="This device’s tasks and settings will become exactly the ones in your gist. Anything changed here and not yet synced will be lost."
    choices={[{ label: 'Replace', value: 'replace', danger: true }]}
    onchoose={(v) => {
      askReplace = false;
      if (v === 'replace') void syncAction(async () => {
        await sync.replaceWithGist();
        await sync.syncNow();
      });
    }}
  />
{/if}

{#if confirmDisconnect && severalGists}
  <ChoiceDialog
    title={`Disconnect “${gistName($settings.gistLabel)}”?`}
    message="This gist’s tasks, token and key are removed from this device, and your other gists stay. Its tasks stay in the gist, and Add Gist… can bring it back."
    choices={[{ label: 'Disconnect', value: 'disconnect', danger: true }]}
    onchoose={onDisconnectChoice}
  />
{:else if confirmDisconnect}
  <ChoiceDialog
    title="Disconnect this device?"
    message="Your tasks, token and key are removed from this device. Your tasks stay in your gist, and you can connect again with your token and passphrase."
    choices={[{ label: 'Disconnect', value: 'disconnect', danger: true }]}
    onchoose={onDisconnectChoice}
  />
{/if}

{#if pendingRestore}
  <ChoiceDialog
    title="Replace all your tasks with this backup?"
    message={`This backup was saved ${whenSynced(pendingRestore.savedAt)} and holds ${countsText(countsOf(pendingRestore.list))}.`}
    points={[
      'Everything created since the backup is deleted, and everything changed since goes back to the backup’s version.',
      'Your other devices match the backup when they next sync. Changes they haven’t synced yet are overwritten, but a task created there and not yet synced is kept.',
      'A backup from another gist replaces your tasks rather than adding to them.',
      'This device’s appearance, token, passphrase and gist connection don’t change.',
      'Restore can’t be undone.',
    ]}
    note={savedFirst}
    choices={[
      ...(savedFirstOk ? [] : [{ label: 'Save Backup First', value: 'save' }]),
      { label: 'Restore', value: 'restore', danger: true },
    ]}
    onchoose={onRestoreChoice}
  />
{/if}

{#if deleting?.kind === 'tag'}
  <ChoiceDialog
    title={`Delete the tag “${deleting.title}”?`}
    message={deleteTagMessage(deleting.id)}
    choices={[{ label: descendantIds(deleting.id, $snapshot.tags).size > 1 ? 'Delete Tags' : 'Delete Tag', value: 'delete', danger: true }]}
    onchoose={onDeleteChoice}
  />
{:else if deleting}
  <ChoiceDialog
    title={`Delete the context “${deleting.title}”?`}
    message="It will be cleared from every task and saved search that uses it. The tasks themselves stay."
    choices={[{ label: 'Delete Context', value: 'delete', danger: true }]}
    onchoose={onDeleteChoice}
  />
{/if}

<style>
  .about {
    list-style: none;
    padding: 0;
    margin: 4px 0 0;
    display: flex;
    flex-wrap: wrap;
    gap: 8px 20px;
    font-size: 14px;
  }
  .about :global(a) {
    color: var(--accent-text);
    text-decoration: none;
  }
  .about :global(a:hover) {
    text-decoration: underline;
  }
  .sync-state,
  .sync-problem {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 4px 0 6px;
    font-size: 15px;
  }
  .sync-problem {
    color: var(--danger);
    font-size: 14px;
    line-height: 1.45;
  }
  .backup-done {
    font-size: 14px;
    margin: 6px 0 4px;
  }
  /* Your Gists (FR-19.16): one row per gist on this device. */
  .gists {
    list-style: none;
    margin: 6px 0 10px;
    padding: 0;
    max-width: 420px;
  }
  .gists li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 0;
    border-bottom: 1px solid var(--rule);
    font-size: 14px;
  }
  .gist-dot {
    flex: none;
    width: 9px;
    height: 9px;
    border-radius: 50%;
  }
  .gist-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .gist-open {
    font-size: 12px;
    color: var(--text-3);
  }
  .gists button {
    margin-left: auto;
  }
  .sync-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 4px 0 2px;
  }
  /* Also the buttons inside ImportButton and ArchiveControls. */
  section :global(.outline) {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--field);
    padding: 6px 12px;
    font-size: 13px;
  }
  section :global(.outline:hover:not(:disabled)) {
    background: var(--hover-bg);
  }
  section :global(.outline.danger) {
    color: var(--danger);
  }
  section {
    margin: 0 0 32px 38px;
  }
  h2 {
    font-size: 17px;
    margin: 0 0 8px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--rule);
  }
  h3 {
    font-size: 14px;
    margin: 18px 0 4px;
  }
  .overview {
    border-collapse: collapse;
    font-size: 13px;
    margin: 6px 0 4px;
    font-variant-numeric: tabular-nums;
  }
  .overview caption {
    text-align: left;
    font-weight: 600;
    margin-bottom: 2px;
  }
  .overview th,
  .overview td {
    padding: 2px 14px 2px 0;
    text-align: right;
    font-weight: normal;
  }
  .overview thead th {
    color: var(--text-3);
  }
  .overview tbody th {
    text-align: left;
  }
  .help {
    font-size: 13px;
    color: var(--text-3);
    margin: 4px 0 10px;
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .rows li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
  }
  .rows .prio {
    width: 30px;
    justify-content: center;
  }
  .text {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 5px 8px;
    font-size: 14px;
    width: 220px;
    max-width: 100%;
  }
  .small {
    padding: 4px 6px;
    font-size: 13px;
  }
  .setting-row select {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 4px 8px;
    font: inherit;
    background: var(--bg);
    color: var(--text);
  }
  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 6px 0;
    font-size: 14px;
  }
  .switch-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 0;
    font-size: 14px;
  }
  .switch-row input {
    appearance: none;
    width: 34px;
    height: 20px;
    border-radius: 999px;
    background: var(--switch-off);
    position: relative;
    flex: none;
    margin: 0;
    cursor: pointer;
    transition: background 0.15s;
  }
  .switch-row input::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff; /* the knob stays white in both themes, as in macOS */
    transition: transform 0.15s;
  }
  .switch-row input:checked {
    background: var(--accent);
  }
  .switch-row input:checked::after {
    transform: translateX(14px);
  }
  @media (max-width: 767px) {
    section {
      margin-left: 0;
    }
  }
</style>
