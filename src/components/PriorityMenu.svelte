<!-- Priority menu contents (FR-14.2): P1 to P5 with the user's labels, and None. -->
<script lang="ts">
  import Icon from './Icon.svelte';
  import { settings } from '../lib/state/live';
  import { PRIORITIES, priorityLabel } from '../lib/model/settings';
  import type { Priority } from '../lib/model/types';

  let {
    priority,
    onchoose,
  }: {
    priority: Priority | null;
    onchoose: (priority: Priority | null) => void;
  } = $props();
</script>

<div class="menu" role="menu" aria-label="Priority">
  {#each PRIORITIES as p (p)}
    <button type="button" class="menu-item" role="menuitemradio" aria-checked={priority === p} onclick={() => onchoose(p)}>
      <span class="prio prio-{p}">P{p}</span>
      <span class="label">{priorityLabel(p, $settings)}</span>
      {#if priority === p}<Icon name="check" size={13} color="var(--accent)" />{/if}
    </button>
  {/each}
  <hr class="menu-sep" />
  <button type="button" class="menu-item" role="menuitemradio" aria-checked={priority === null} onclick={() => onchoose(null)}>
    None
  </button>
</div>

<style>
  .menu {
    display: flex;
    flex-direction: column;
  }
  .label {
    flex: 1;
  }
</style>
