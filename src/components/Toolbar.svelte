<!--
  Desktop bottom toolbar (design doc, Section 6):
  - New Task, in views that accept new tasks.
  - New Heading, on open project pages.
  - Start Date and Move, for the selected tasks (one or several, FR-10.1);
    greyed out until a task is selected.
  - Search, which opens Quick Find (FR-9.1).
  New Task opens Quick Entry set to the current view (FR-10.5). Phones use
  the round + button instead.
-->
<script lang="ts">
  import Icon from './Icon.svelte';
  import Popover from './Popover.svelte';
  import WhenPicker from './WhenPicker.svelte';
  import { route } from '../lib/state/route';
  import { snapshot, todayDate, todoById } from '../lib/state/live';
  import { ui } from '../lib/state/ui.svelte';
  import { canAddHere, changeWhen, draftStartFor, newHeading, openQuickEntry } from '../lib/actions';
  import { isOpen } from '../lib/model/lists';
  import * as repo from '../lib/db/repo';
  import * as bulk from '../lib/bulk';
  import { selectedIds } from '../lib/commands';

  let whenOpen = $state(false);

  /** The selected tasks still open and not in the Trash. */
  let chosen = $derived(ui.selectedTodos($todoById).filter(isOpen));
  let selected = $derived(chosen.length > 0);
  let project = $derived($route.kind === 'project' ? $snapshot.projects.find((p) => p.id === $route.id) : undefined);
  let canHeading = $derived(project?.status === 'open' && project.trashedAt === null);

  /** The chosen tasks, in screen order. */
  function ids() {
    const open = new Set(chosen.map((t) => t.id));
    return selectedIds().filter((id) => open.has(id));
  }

  function chooseWhen(choice: repo.WhenChoice) {
    whenOpen = false;
    void changeWhen(ids(), choice);
  }
</script>

<div class="toolbar" role="toolbar" aria-label="Actions">
  {#if canAddHere($route)}
    <button type="button" class="tool" aria-label="New Task" title="New Task" onclick={() => openQuickEntry(draftStartFor($route, $todayDate))}>
      <Icon name="plus" size={20} />
    </button>
  {/if}
  {#if canHeading && project}
    <button type="button" class="tool" aria-label="New Heading" title="New Heading" onclick={() => newHeading(project!.id)}>
      <Icon name="heading-add" size={20} />
    </button>
  {/if}
  <Popover bind:open={whenOpen} label="Start Date" align="left" above>
    {#snippet trigger(toggle, open)}
      <button
        type="button"
        class="tool"
        aria-label="Start Date"
        title={selected ? 'Start Date' : 'Start Date (select a task first)'}
        aria-expanded={open}
        disabled={!selected}
        onclick={toggle}
      >
        <Icon name="calendar" size={20} />
      </button>
    {/snippet}
    {#if chosen.length === 1}
      <WhenPicker startDate={chosen[0].startDate} deferred={chosen[0].start === 'deferred'} deadline={chosen[0].deadline} ref={$todayDate} onchoose={chooseWhen} />
    {:else if chosen.length}
      <WhenPicker startDate={null} deferred={false} deadline={bulk.earliestDeadline(chosen)} ref={$todayDate} onchoose={chooseWhen} />
    {/if}
  </Popover>
  <button
    type="button"
    class="tool"
    aria-label="Move"
    title={selected ? 'Move' : 'Move (select a task first)'}
    disabled={!selected}
    onclick={() => selected && (ui.movingIds = ids())}
  >
    <Icon name="move" size={20} />
  </button>
  <button type="button" class="tool" aria-label="Quick Find" title="Quick Find" onclick={() => ui.openFind()}>
    <Icon name="search" size={20} />
  </button>
</div>

<style>
  .toolbar {
    flex: none;
    display: flex;
    justify-content: center;
    gap: 56px;
    padding: 8px 16px calc(8px + env(safe-area-inset-bottom));
    border-top: 1px solid var(--rule);
    background: var(--surface);
  }
  .tool {
    border: 0;
    background: transparent;
    padding: 8px 12px;
    border-radius: var(--radius);
    color: var(--text-2);
    display: inline-flex;
  }
  .tool:hover:not(:disabled) {
    background: var(--hover-bg);
  }
  .tool:disabled {
    color: var(--disabled);
    cursor: default;
  }
</style>
