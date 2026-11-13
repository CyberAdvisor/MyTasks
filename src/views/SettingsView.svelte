<!--
  Settings (design doc, Section 5.10 FR-14.13 and Section 5.4 FR-6.1).
  - Sync (FR-19.6 to FR-19.8): the gist connection, its problems and their
    fixes, Sync Now, Change Token, Change Passphrase, Disconnect.
  - Backup (FR-12.8): Save Backup downloads a file of all synced data;
    Restore from Backup… checks a file, confirms, then replaces everything.
  - Appearance (FR-V.3): System, Light or Dark.
  - Completed Items: when completed items move to Completed (FR-12.2) and
    the two "move to the bottom" switches (FR-12.7, FR-7.5).
  - Priority Settings: P1–P5 labels and the two automatic-rule switches.
  - Tags: create, rename, reorder and delete (the Manage Tags window).
  - Contexts (FR-18.2): the same, for the contexts a to-do can be in.
  - About My Tasks: links to the website's pages, each in a new tab.
  Changes save as soon as a field is left or a switch is flipped.
-->
<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import ViewHeader from '../components/ViewHeader.svelte';
  import ChoiceDialog from '../components/ChoiceDialog.svelte';
  import NamedList from '../components/NamedList.svelte';
  import Segmented from '../components/Segmented.svelte';
  import { settings, snapshot } from '../lib/state/live';
  import { bySortKey } from '../lib/model/order';
  import {
    DEFAULT_PRIORITY_LABELS,
    PRIORITIES,
    cleanLabels,
    type MoveToCompleted,
    type Theme,
  } from '../lib/model/settings';
  import * as repo from '../lib/db/repo';
  import type { ID, Priority } from '../lib/model/types';
  import SyncDialog, { type SyncForm } from '../components/SyncDialog.svelte';
  import SiteLink from '../components/SiteLink.svelte';
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
    saveMethod,
    type Backup,
  } from '../lib/backup';
  import { detectBrowser, isStandalone } from '../lib/pwa/platform';

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

  let tags = $derived(bySortKey($snapshot.tags));
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

  /** Disconnect clears this device, then the app restarts at Setup. */
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

  /**
   * Save a backup file of this device's tasks. Returns the message to show:
   * the browser started a download, or the share sheet took the file. It
   * says "downloaded", never "backed up": whether the file was kept is up to
   * the browser and the user. Empty when the share sheet was dismissed.
   */
  async function saveBackup(): Promise<string> {
    const now = new Date();
    const name = backupFileName(now);
    const file = new File([await buildBackup(now.toISOString())], name, { type: 'application/json' });
    const canShare = typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
    if (saveMethod(detectBrowser(), isStandalone(), canShare) === 'share') {
      try {
        await navigator.share({ files: [file] });
      } catch (e) {
        if ((e as DOMException).name === 'AbortError') return '';
        throw e;
      }
      return `Backup file shared: ${name}. Choose Save to Files to keep it.`;
    }
    const url = URL.createObjectURL(file);
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return `Backup file downloaded: ${name}`;
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
  {#if sync.status === 'error' && sync.problem}
    <p class="sync-problem" role="alert"><Icon name="alert" size={15} color="var(--danger)" /> {problemText(sync.problem, sync.retryAt)}</p>
    {#if sync.problem === 'passphrase'}
      <p><button type="button" class="btn-primary" onclick={() => (syncForm = 'enter-passphrase')}>Enter New Passphrase</button></p>
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
      Gist {sync.config.gistId.slice(0, 8)}…{#if sync.config.lastSyncedAt}&nbsp;· Last synced {whenSynced(sync.config.lastSyncedAt)}{/if}
    </p>
  {/if}
  <div class="sync-buttons">
    <button type="button" class="outline" disabled={sync.status === 'syncing'} onclick={() => syncAction(() => sync.syncNow())}>
      {sync.status === 'syncing' ? 'Syncing…' : 'Sync Now'}
    </button>
    <button type="button" class="outline" onclick={() => (syncForm = 'token')}>Change Token</button>
    <button type="button" class="outline" onclick={() => (syncForm = 'change-passphrase')}>Change Passphrase</button>
    <button type="button" class="outline danger" onclick={() => (confirmDisconnect = true)}>Disconnect This Device</button>
  </div>
  {#if syncError}<p class="form-error" role="alert">⚠ {syncError}</p>{/if}
  <p class="help">
    Your tasks are encrypted with your passphrase before they reach GitHub. Disconnecting removes your tasks, token
    and key from this device; your tasks stay in your gist.
  </p>
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

<section aria-labelledby="appearance-heading">
  <h2 id="appearance-heading">Appearance</h2>
  <div class="setting-row">
    <span>Theme</span>
    <Segmented
      label="Theme"
      options={THEME_OPTIONS}
      value={$settings.theme}
      onchange={(v) => repo.setSetting('theme', v)}
    />
  </div>
  <p class="help">System follows your device's light or dark setting.</p>
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
    midnight. Manually waits for Move to Completed.
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

<section aria-labelledby="tags-heading">
  <h2 id="tags-heading">Tags</h2>
  <NamedList
    items={tags}
    icon="tag"
    noun="Tag"
    onrename={repo.renameTag}
    onmove={repo.moveTag}
    ondelete={(t) => (deleting = { kind: 'tag', ...t })}
    onadd={repo.createTag}
  />
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
  <p class="help">Each opens on mytasks.fyi in a new tab.</p>
  <ul class="about">
    <li><SiteLink page="home">Website</SiteLink></li>
    <li><SiteLink page="guide">Guide</SiteLink></li>
    <li><SiteLink page="limitations">Risks and limitations</SiteLink></li>
    <li><SiteLink page="privacy">Privacy</SiteLink></li>
    <li><SiteLink page="security">Security</SiteLink></li>
  </ul>
</section>

{#if syncForm}
  <SyncDialog form={syncForm} onclose={() => (syncForm = null)} />
{/if}

{#if confirmDisconnect}
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
    message="It will be removed from every task, project and area. The items themselves stay."
    choices={[{ label: 'Delete Tag', value: 'delete', danger: true }]}
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
  .sync-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 4px 0 2px;
  }
  .outline {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--field);
    padding: 6px 12px;
    font-size: 13px;
  }
  .outline:hover:not(:disabled) {
    background: var(--hover-bg);
  }
  .outline.danger {
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
