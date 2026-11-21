<!--
  The sidebar's sync status (FR-19.8). The bottom line always shows the
  last sync (or Syncing…) on one line, with any content passed in, the
  build's version, on its right. A message goes on its own line above it
  when there is one: Offline, or the problem, which links to Settings ›
  Sync, where it is explained and fixed. From 4,500 tasks a line above
  says how near the 5,000-task limit the list is (NFR-7), with a link to
  the Guide's section on making room.
  Clicking the bottom line (its icon and text) syncs now, as Settings › Sync
  Now does (Michael, 2026-11-18); not while a sync is running.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  import { hrefFor } from '../lib/state/route';
  import { syncMessage, syncedLine } from '../lib/sync/messages';
  import { sync } from '../lib/sync/sync.svelte';
  import { taskCount } from '../lib/state/live';
  import { limitWarning, nearLimit } from '../lib/model/limits';
  import { siteUrl } from '../lib/website';

  /** Shown at the right of the bottom line. */
  let { children }: { children?: Snippet } = $props();

  let line = $derived(syncedLine(sync.status, sync.config?.lastSyncedAt ?? null));
  let message = $derived(syncMessage(sync.status, sync.problem, sync.config?.lastSyncedAt ?? null));

  /** Sync now; how it went shows in this line, as for any sync. */
  function syncNow() {
    void sync.syncNow().catch((e) => console.error('Sync failed', e));
  }
</script>

<div class="sync" role="status">
  {#if nearLimit($taskCount)}
    <a href="{siteUrl('guide')}#task-limit" target="_blank" rel="noopener" class="message limit">
      <Icon name="alert" size={13} color="var(--danger)" />
      <span>{limitWarning($taskCount)} <span class="fix">Make room</span></span>
    </a>
  {/if}
  {#if message && sync.status === 'error'}
    <a href={hrefFor({ kind: 'settings' })} class="message">
      <Icon name="alert" size={13} color="var(--danger)" />
      <span>{message} <span class="fix">{sync.problem === 'passphrase' ? 'Enter it' : 'Fix'}</span></span>
    </a>
  {:else if message}
    <div class="message">
      <Icon name="cloud-off" size={13} />
      <span>{message}</span>
    </div>
  {/if}
  <div class="line">
    <button
      type="button"
      class="now"
      title="Sync now"
      aria-label="{line}. Sync now"
      disabled={!sync.config || sync.status === 'syncing'}
      onclick={syncNow}
    >
      <Icon name={sync.status === 'syncing' ? 'sync' : 'cloud'} size={13} />
      <span class="text">{line}</span>
    </button>
    {@render children?.()}
  </div>
</div>

<style>
  .sync {
    font-size: 12px;
    color: var(--text-3);
  }
  .message {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 6px 18px 0;
    line-height: 1.4;
    color: inherit;
    text-decoration: none;
  }
  /* Line the icon up with the first line of text. */
  .message > :global(svg) {
    flex: none;
    margin-top: 2px;
  }
  .fix {
    color: var(--accent-text);
    white-space: nowrap;
  }
  .line {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 18px;
    padding: 6px 18px;
  }
  /* The status itself is the Sync Now button: no button look, just the text. */
  .now {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0;
    border: 0;
    background: transparent;
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }
  .now:disabled {
    cursor: default;
    opacity: 1;
  }
  .now:not(:disabled):hover .text {
    color: var(--text-2);
  }
  .text {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
