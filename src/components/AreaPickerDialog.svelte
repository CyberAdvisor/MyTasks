<!--
  Move a project to an area, or out of any area (project ⋯ menu > Move).
-->
<script lang="ts">
  import Icon from './Icon.svelte';
  import { snapshot } from '../lib/state/live';
  import { bySortKey } from '../lib/model/order';
  import type { ID } from '../lib/model/types';

  let {
    current,
    onchoose,
  }: {
    /** The project's current area, marked in the list. */
    current: ID | null;
    /** Called with the chosen area id, null for no area, or undefined when dismissed. */
    onchoose: (areaId: ID | null | undefined) => void;
  } = $props();

  let dialog: HTMLDialogElement;
  let areas = $derived(bySortKey($snapshot.areas));

  $effect(() => {
    dialog.showModal();
  });
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="area-move-title"
  oncancel={(e) => {
    e.preventDefault();
    onchoose(undefined);
  }}
>
  <h2 id="area-move-title">Move project to…</h2>
  <ul>
    <li>
      <button type="button" aria-current={current === null} onclick={() => onchoose(null)}>
        <Icon name="x" size={14} /> No Area
      </button>
    </li>
    {#each areas as area (area.id)}
      <li>
        <button type="button" aria-current={current === area.id} onclick={() => onchoose(area.id)}>
          <Icon name="area" /> {area.title || 'New Area'}
        </button>
      </li>
    {/each}
  </ul>
  <div class="actions">
    <button type="button" class="btn-plain" onclick={() => onchoose(undefined)}>Cancel</button>
  </div>
</dialog>

<style>
  dialog {
    border: 0;
    border-radius: 12px;
    padding: 18px 16px 12px;
    width: min(340px, calc(100% - 32px));
    max-height: 70vh;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
  }
  dialog::backdrop {
    background: rgba(0, 0, 0, 0.25);
  }
  h2 {
    margin: 0 0 10px 6px;
    font-size: 17px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    text-align: left;
    border: 0;
    background: transparent;
    padding: 8px;
    border-radius: var(--radius);
    font-size: 14px;
    min-height: 36px;
  }
  li button:hover {
    background: var(--hover-bg);
  }
  li button[aria-current='true'] {
    font-weight: 600;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 8px;
  }
</style>
