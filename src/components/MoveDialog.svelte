<!--
  Move dialog (FR-1.5): pick the Inbox, an area, a project or a heading.
-->
<script lang="ts">
  import Icon from './Icon.svelte';
  import { ui } from '../lib/state/ui.svelte';
  import { snapshot } from '../lib/state/live';
  import { areaProjects } from '../lib/model/lists';
  import { bySortKey } from '../lib/model/order';
  import * as repo from '../lib/db/repo';
  import type { ID } from '../lib/model/types';

  let { todoId }: { todoId: ID } = $props();

  let dialog: HTMLDialogElement;
  let areas = $derived(bySortKey($snapshot.areas));

  $effect(() => {
    dialog.showModal();
  });

  function headingsOf(projectId: ID) {
    return bySortKey($snapshot.headings.filter((h) => h.projectId === projectId && !h.archived));
  }

  async function moveTo(to: repo.TodoPlacement) {
    await repo.moveTodo(todoId, to);
    ui.movingId = null;
  }
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="move-title"
  oncancel={(e) => {
    e.preventDefault();
    ui.movingId = null;
  }}
>
  <h2 id="move-title">Move to…</h2>
  <ul>
    <li><button type="button" onclick={() => moveTo({})}><Icon name="inbox" color="var(--c-inbox)" /> Inbox</button></li>
    {#each areas as area (area.id)}
      <li>
        <button type="button" class="area" onclick={() => moveTo({ areaId: area.id })}>
          <Icon name="area" /> {area.title || 'New Area'}
        </button>
      </li>
      {#each areaProjects($snapshot, area.id) as p (p.id)}
        <li><button type="button" class="indent" onclick={() => moveTo({ projectId: p.id })}>{p.title || 'New Project'}</button></li>
        {#each headingsOf(p.id) as h (h.id)}
          <li>
            <button type="button" class="indent2" onclick={() => moveTo({ projectId: p.id, headingId: h.id })}>
              <Icon name="heading" size={14} /> {h.title || 'Untitled heading'}
            </button>
          </li>
        {/each}
      {/each}
    {/each}
    {#each areaProjects($snapshot, null) as p (p.id)}
      <li><button type="button" onclick={() => moveTo({ projectId: p.id })}>{p.title || 'New Project'}</button></li>
      {#each headingsOf(p.id) as h (h.id)}
        <li>
          <button type="button" class="indent" onclick={() => moveTo({ projectId: p.id, headingId: h.id })}>
            <Icon name="heading" size={14} /> {h.title || 'Untitled heading'}
          </button>
        </li>
      {/each}
    {/each}
  </ul>
  <div class="actions">
    <button type="button" class="btn-plain" onclick={() => (ui.movingId = null)}>Cancel</button>
  </div>
</dialog>

<style>
  dialog {
    border: 0;
    border-radius: 12px;
    padding: 18px 16px 12px;
    width: min(380px, calc(100% - 32px));
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
    padding: 8px 8px;
    border-radius: var(--radius);
    font-size: 14px;
    min-height: 36px;
  }
  li button:hover {
    background: var(--hover-bg);
  }
  .area {
    font-weight: 600;
  }
  .indent {
    padding-left: 34px;
  }
  .indent2 {
    padding-left: 52px;
    color: var(--text-2);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 8px;
  }
</style>
