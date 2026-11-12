<!--
  The sidebar's install notice, above the sync status (FR-0.2, FR-0.3).
  In a Safari tab: a warning that the tab's data can be cleared, which can
  never be dismissed. Where the browser can install the app, or in Firefox:
  Install My Tasks, which can't be dismissed either. Nothing once installed.
-->
<svelte:options runes />

<script lang="ts">
  import Icon from './Icon.svelte';
  import { install } from '../lib/pwa/install.svelte';
  import { installNotice } from '../lib/pwa/platform';

  let notice = $derived(installNotice(install.browser, install.standalone, install.canPrompt));
</script>

{#if notice === 'install'}
  <button type="button" class="line install" onclick={() => install.start()}>
    <Icon name="download" size={13} />
    <span>Install My Tasks</span>
  </button>
{:else if notice === 'warning'}
  <div class="line warning">
    <Icon name="alert" size={13} color="var(--c-deferred)" />
    <span>
      In a Safari tab, data is cleared after 7 days unused.
      <button type="button" class="link" onclick={() => install.start()}>Install My Tasks</button>
    </span>
  </div>
{/if}

<style>
  /* Lines up with the sync status below (SyncStatus.svelte). */
  .line {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 6px 18px 0;
    font-size: 12px;
    line-height: 1.4;
    text-align: left;
  }
  .line > :global(svg) {
    flex: none;
    margin-top: 2px;
  }
  button {
    border: 0;
    background: none;
    font: inherit;
  }
  .install {
    width: 100%;
    color: var(--accent-text);
  }
  .warning {
    color: var(--text-3);
  }
  .link {
    padding: 0;
    color: var(--accent-text);
    white-space: nowrap;
  }
</style>
