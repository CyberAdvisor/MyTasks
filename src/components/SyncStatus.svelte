<!--
  The sidebar's sync status (FR-19.8). The bottom line always shows the
  last sync (or Syncing…) on one line, with any content passed in, the
  build's version, on its right. A message goes on its own line above it
  when there is one: Offline, or the problem, which links to Settings ›
  Sync, where it is explained and fixed.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  import { hrefFor } from '../lib/state/route';
  import { syncMessage, syncedLine } from '../lib/sync/messages';
  import { sync } from '../lib/sync/sync.svelte';

  /** Shown at the right of the bottom line. */
  let { children }: { children?: Snippet } = $props();

  let line = $derived(syncedLine(sync.status, sync.config?.lastSyncedAt ?? null));
  let message = $derived(syncMessage(sync.status, sync.problem));
</script>

<div class="sync" role="status">
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
    <Icon name={sync.status === 'syncing' ? 'sync' : 'cloud'} size={13} />
    <span class="text">{line}</span>
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
  .text {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
