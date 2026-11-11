<!--
  Context picker contents (FR-18.3): the contexts defined in Settings, None,
  and Manage Contexts…, which opens Settings.
-->
<script lang="ts">
  import Icon from './Icon.svelte';
  import { snapshot } from '../lib/state/live';
  import { go } from '../lib/state/route';
  import { contextsInOrder } from '../lib/model/contexts';
  import type { ID } from '../lib/model/types';

  let {
    contextId,
    onchoose,
  }: {
    contextId: ID | null;
    onchoose: (contextId: ID | null) => void;
  } = $props();

  let contexts = $derived(contextsInOrder($snapshot));
</script>

<div class="menu" role="menu" aria-label="Context">
  {#each contexts as c (c.id)}
    <button type="button" class="menu-item" role="menuitemradio" aria-checked={contextId === c.id} onclick={() => onchoose(c.id)}>
      <span class="label">{c.title || 'Untitled'}</span>
      {#if contextId === c.id}<Icon name="check" size={13} />{/if}
    </button>
  {:else}
    <p class="empty">No contexts yet.</p>
  {/each}
  <hr class="menu-sep" />
  {#if contexts.length}
    <button type="button" class="menu-item" role="menuitemradio" aria-checked={contextId === null} onclick={() => onchoose(null)}>
      <span class="label">None</span>
      {#if contextId === null}<Icon name="check" size={13} />{/if}
    </button>
  {/if}
  <button type="button" class="menu-item manage" role="menuitem" onclick={() => go({ kind: 'settings' })}>Manage Contexts…</button>
</div>

<style>
  .menu {
    display: flex;
    flex-direction: column;
    min-width: 190px;
  }
  .label {
    flex: 1;
  }
  .empty {
    margin: 6px 10px;
    font-size: 13px;
    color: var(--text-3);
  }
  .manage {
    color: var(--text-2);
  }
</style>
