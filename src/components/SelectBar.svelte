<!--
  Select mode's floating bar (FR-10.2): Start Date,
  Move, Delete and ⋯ for the selected tasks, greyed out until one is
  selected. Start Date and ⋯ open the task menu for the selection (RowMenu,
  a sheet on phones), whose ⋯ items are selectModeMenuItems. Every change is
  one undo step (lib/bulk.ts), and Select mode stays on afterwards.
-->
<script lang="ts">
  import Icon from './Icon.svelte';
  import { trashTodos } from '../lib/actions';
  import { selectedIds } from '../lib/commands';
  import { todoById } from '../lib/state/live';
  import { ui } from '../lib/state/ui.svelte';

  /** Whether any selected task is still there (not deleted). */
  let selected = $derived(ui.selectedTodos($todoById).some((t) => t.trashedAt === null));

  /** Open the task menu for the selection, or straight at its Start Date picker, above `button`. */
  function openMenu(button: HTMLElement, panel?: 'when') {
    const [first] = selectedIds();
    if (!first) return;
    const r = button.getBoundingClientRect();
    ui.rowMenu = { id: first, mode: 'open', x: r.right, y: r.top, alignEnd: true, panel };
  }

  function move() {
    const ids = selectedIds();
    if (ids.length) ui.movingIds = ids;
  }

  function trash() {
    const ids = selectedIds();
    if (ids.length) void trashTodos(ids);
  }
</script>

<div class="selectbar" role="toolbar" aria-label="Selected tasks">
  <button type="button" class="tool" disabled={!selected} onclick={(e) => openMenu(e.currentTarget, 'when')}>
    <Icon name="calendar" size={20} /><span>Start Date</span>
  </button>
  <button type="button" class="tool" disabled={!selected} onclick={move}>
    <Icon name="move" size={20} /><span>Move</span>
  </button>
  <button type="button" class="tool" disabled={!selected} onclick={trash}>
    <Icon name="trash" size={20} /><span>Delete</span>
  </button>
  <button type="button" class="tool" aria-label="More" disabled={!selected} onclick={(e) => openMenu(e.currentTarget)}>
    <Icon name="more" size={20} weight={3.5} /><span aria-hidden="true">&nbsp;</span>
  </button>
</div>

<style>
  .selectbar {
    position: fixed;
    left: 50%;
    bottom: calc(20px + env(safe-area-inset-bottom));
    transform: translateX(-50%);
    width: min(360px, calc(100% - 32px));
    display: flex;
    justify-content: space-around;
    padding: 6px 8px;
    border-radius: 16px;
    background: var(--surface);
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.18);
  }
  .tool {
    flex: 1;
    border: 0;
    background: transparent;
    padding: 6px 4px;
    border-radius: var(--radius);
    color: var(--accent);
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    font-size: 11px;
  }
  .tool:disabled {
    color: var(--disabled);
  }
</style>
