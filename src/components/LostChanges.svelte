<!--
  The lost-change notice (FR-19.12): after a sync, the tasks and projects
  whose changes on this device were replaced by later ones from another
  device, each with what it lost. A title opens it; OK closes the notice.
-->
<script lang="ts">
  import { db } from '../lib/db/database';
  import { revealTodo } from '../lib/actions';
  import { todayDate } from '../lib/state/live';
  import { go, route } from '../lib/state/route';
  import { sync } from '../lib/sync/sync.svelte';
  import { LOST_SHOWN, lostTitle, lostWhat, type LostChange } from '../lib/sync/lost';

  let dialog: HTMLDialogElement;
  let shown = $derived(sync.lost.slice(0, LOST_SHOWN));
  let more = $derived(sync.lost.length - shown.length);

  $effect(() => {
    dialog.showModal();
  });

  /** Close the notice and show the task or project where it lives. */
  async function open(change: LostChange): Promise<void> {
    sync.dismissLost();
    if (change.kind === 'project') return go({ kind: 'project', id: change.id });
    const todo = await db.todos.get(change.id);
    if (todo && !todo.deletedAt) revealTodo(todo, $route, $todayDate);
  }
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="lost-title"
  oncancel={(e) => {
    e.preventDefault();
    sync.dismissLost();
  }}
>
  <h2 id="lost-title">{lostTitle(sync.lost.length)}</h2>
  <ul>
    {#each shown as change (change.kind + change.id)}
      <li>
        {#if change.deleted}
          <span class="title">{change.title || 'Untitled'}</span>
        {:else}
          <button type="button" class="title link" onclick={() => void open(change)}>{change.title || 'Untitled'}</button>
        {/if}
        <span class="what">— {lostWhat(change)}</span>
      </li>
    {/each}
  </ul>
  {#if more > 0}<p class="more">and {more} more</p>{/if}
  <div class="actions">
    <button type="button" class="choice" onclick={() => sync.dismissLost()}>OK</button>
  </div>
</dialog>

<style>
  dialog {
    border: 0;
    border-radius: 12px;
    padding: 20px 22px 16px;
    max-width: 420px;
    width: calc(100% - 32px);
    box-shadow: var(--shadow-dialog);
  }
  dialog::backdrop {
    background: var(--overlay);
  }
  h2 {
    margin: 0 0 12px;
    font-size: 17px;
  }
  ul {
    margin: 0 0 16px;
    padding-left: 20px;
    font-size: 14px;
    line-height: 1.45;
  }
  li + li {
    margin-top: 4px;
  }
  .link {
    border: 0;
    background: none;
    padding: 0;
    color: var(--accent);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .what,
  .more {
    color: var(--text-2);
  }
  .more {
    margin: -8px 0 16px;
    font-size: 14px;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
  }
  .choice {
    border: 0;
    border-radius: var(--radius);
    background: var(--accent);
    color: var(--on-accent);
    padding: 8px 14px;
    font-weight: 600;
  }
</style>
