<!--
  Desktop bottom toolbar, as in Things for Mac (design doc, Section 6):
  - New To-Do, in views that accept new to-dos.
  - New Heading, on open project pages.
  - When and Move, for the selected to-do; greyed out until a to-do is selected.
  - Search, which opens Quick Find (FR-9.1).
  New To-Do opens Quick Entry set to the current view (FR-10.5). Phones use
  the round + button instead.
-->
<script lang="ts">
  import Icon from './Icon.svelte';
  import Popover from './Popover.svelte';
  import WhenPicker from './WhenPicker.svelte';
  import { route } from '../lib/state/route';
  import { snapshot, todayDate } from '../lib/state/live';
  import { ui } from '../lib/state/ui.svelte';
  import { canAddHere, draftStartFor, newHeading, openQuickEntry } from '../lib/actions';
  import { isOpen } from '../lib/model/lists';
  import * as repo from '../lib/db/repo';

  let whenOpen = $state(false);

  /** The selected to-do, if it is still open and not in the Trash. */
  let selected = $derived($snapshot.todos.find((t) => t.id === ui.selectedId && isOpen(t)) ?? null);
  let project = $derived($route.kind === 'project' ? $snapshot.projects.find((p) => p.id === $route.id) : undefined);
  let canHeading = $derived(project?.status === 'open' && project.trashedAt === null);

  function chooseWhen(choice: repo.WhenChoice) {
    whenOpen = false;
    if (selected) void repo.setWhen(selected.id, choice);
  }
</script>

<div class="toolbar" role="toolbar" aria-label="Actions">
  {#if canAddHere($route)}
    <button type="button" class="tool" aria-label="New To-Do" title="New To-Do" onclick={() => openQuickEntry(draftStartFor($route, $todayDate))}>
      <Icon name="plus" size={20} />
    </button>
  {/if}
  {#if canHeading && project}
    <button type="button" class="tool" aria-label="New Heading" title="New Heading" onclick={() => newHeading(project!.id)}>
      <Icon name="heading-add" size={20} />
    </button>
  {/if}
  <Popover bind:open={whenOpen} label="When" align="left" above>
    {#snippet trigger(toggle, open)}
      <button
        type="button"
        class="tool"
        aria-label="When"
        title={selected ? 'When' : 'When (select a to-do first)'}
        aria-expanded={open}
        disabled={!selected}
        onclick={toggle}
      >
        <Icon name="calendar" size={20} />
      </button>
    {/snippet}
    {#if selected}
      <WhenPicker startDate={selected.startDate} deferred={selected.start === 'deferred'} ref={$todayDate} onchoose={chooseWhen} />
    {/if}
  </Popover>
  <button
    type="button"
    class="tool"
    aria-label="Move"
    title={selected ? 'Move' : 'Move (select a to-do first)'}
    disabled={!selected}
    onclick={() => selected && (ui.movingId = selected.id)}
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
    background: #fff;
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
    color: #c4c4c8;
    cursor: default;
  }
</style>
