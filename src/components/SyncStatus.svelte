<!--
  The sidebar's one-line sync status (FR-19.8): Synced (with the time),
  Syncing…, Offline, or the problem. A problem links to Settings › Sync,
  where it is explained and fixed.
-->
<script lang="ts">
  import Icon from './Icon.svelte';
  import { hrefFor } from '../lib/state/route';
  import { statusLine } from '../lib/sync/messages';
  import { sync } from '../lib/sync/sync.svelte';

  let text = $derived(statusLine(sync.status, sync.problem, sync.config?.lastSyncedAt ?? null));
  let icon = $derived<'cloud-off' | 'sync' | 'cloud'>(
    sync.status === 'offline' ? 'cloud-off' : sync.status === 'syncing' ? 'sync' : 'cloud',
  );
</script>

<div class="status" role="status">
  {#if sync.status === 'error'}
    <a href={hrefFor({ kind: 'settings' })} class="problem">
      <Icon name="alert" size={13} color="var(--danger)" />
      <span>{text}</span>
      <span class="fix">{sync.problem === 'passphrase' ? 'Enter it' : 'Fix'}</span>
    </a>
  {:else}
    <Icon name={icon} size={13} />
    <span>{text}</span>
  {/if}
</div>

<style>
  .status {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 18px;
    padding: 6px 18px;
    font-size: 12px;
    color: var(--text-3);
  }
  .problem {
    display: flex;
    align-items: center;
    gap: 6px;
    color: inherit;
    text-decoration: none;
  }
  .fix {
    color: var(--accent-text);
    white-space: nowrap;
  }
</style>
