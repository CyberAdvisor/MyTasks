<!--
  Move dialog (FR-1.5): pick the Inbox, an area, a project or a heading.
-->
<script lang="ts">
  import DestinationList from './DestinationList.svelte';
  import { ui } from '../lib/state/ui.svelte';
  import * as repo from '../lib/db/repo';
  import type { ID } from '../lib/model/types';

  let { todoId }: { todoId: ID } = $props();

  let dialog: HTMLDialogElement;

  $effect(() => {
    dialog.showModal();
  });

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
  <DestinationList onchoose={moveTo} />
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
  .actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 8px;
  }
</style>
