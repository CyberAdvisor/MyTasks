<!--
  Move dialog (FR-1.5): pick the Inbox, an area, a project or a heading, for
  one task or the selected several (FR-10.1, one undo step).
-->
<script lang="ts">
  import DestinationList from './DestinationList.svelte';
  import { ui } from '../lib/state/ui.svelte';
  import * as repo from '../lib/db/repo';
  import * as bulk from '../lib/bulk';
  import type { ID } from '../lib/model/types';

  let { todoIds }: { todoIds: ID[] } = $props();

  let dialog: HTMLDialogElement;

  $effect(() => {
    // On touch screens the dialog's title takes focus as it opens, not the
    // filter field, so the keyboard doesn't cover the list (review F10).
    if (matchMedia('(pointer: coarse)').matches) dialog.querySelector('h2')?.setAttribute('autofocus', '');
    dialog.showModal();
  });

  async function moveTo(to: repo.TodoPlacement) {
    await bulk.move(todoIds, to);
    ui.movingIds = null;
    ui.offerUndo('Moved');
  }
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="move-title"
  oncancel={(e) => {
    e.preventDefault();
    ui.movingIds = null;
  }}
>
  <h2 id="move-title" tabindex="-1">{todoIds.length > 1 ? `Move ${todoIds.length} tasks to…` : 'Move to…'}</h2>
  <DestinationList onchoose={moveTo} />
  <div class="actions">
    <button type="button" class="btn-plain" onclick={() => (ui.movingIds = null)}>Cancel</button>
  </div>
</dialog>

<style>
  dialog {
    border: 0;
    border-radius: 12px;
    padding: 18px 16px 12px;
    width: min(380px, calc(100% - 32px));
    max-height: 70vh;
    box-shadow: var(--shadow-dialog);
  }
  dialog::backdrop {
    background: var(--overlay);
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
