<!--
  The Start Date picker for tasks dropped on Scheduled in the sidebar
  (FR-10.3b), opened beside the list. A floating panel, so the sidebar's scrolling can't clip
  it. Escape or a click outside closes it and leaves the tasks as they were;
  a choice sets their start date as one undo step.
-->
<script lang="ts">
  import WhenPicker from './WhenPicker.svelte';
  import * as bulk from '../lib/bulk';
  import { changeWhen } from '../lib/actions';
  import type { WhenChoice } from '../lib/db/repo';
  import { MARGIN, clamp, closeOnOutside } from '../lib/menuNav';
  import type { ID } from '../lib/model/types';
  import { snapshot, todayDate } from '../lib/state/live';
  import { ui } from '../lib/state/ui.svelte';

  let { ids, x, y, onclose }: { ids: ID[]; x: number; y: number; onclose: () => void } = $props();

  let panel: HTMLDivElement;
  let tasks = $derived($snapshot.todos.filter((t) => ids.includes(t.id)));
  let pos = $state({ left: 0, top: 0 });

  $effect(() => closeOnOutside(() => [panel], onclose));

  // Escape closes only this panel.
  $effect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onclose();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  });

  // Beside the list and on screen; with a mouse, focus goes to the date field.
  $effect(() => {
    const r = panel.getBoundingClientRect();
    pos = {
      left: clamp(x, MARGIN, innerWidth - r.width - MARGIN),
      top: clamp(y, MARGIN, innerHeight - r.height - MARGIN),
    };
    if (!matchMedia('(pointer: coarse)').matches) panel.querySelector<HTMLElement>('input, .menu-item')?.focus();
  });

  async function choose(choice: WhenChoice) {
    // Read before closing: the props go with the panel.
    const chosen = ids;
    onclose();
    await changeWhen(chosen, choice);
    ui.offerUndo('Moved');
  }
</script>

<div class="drop-when" bind:this={panel} role="dialog" aria-label="Start Date" style:left="{pos.left}px" style:top="{pos.top}px">
  <WhenPicker
    startDate={bulk.shared(tasks, (t) => t.startDate) ?? null}
    deferred={tasks.length > 0 && tasks.every((t) => t.start === 'deferred')}
    deadline={bulk.earliestDeadline(tasks)}
    ref={$todayDate}
    onchoose={choose}
  />
</div>

<style>
  .drop-when {
    position: fixed;
    z-index: var(--z-drop-when);
    min-width: 200px;
    padding: 4px;
    background: var(--surface);
    border-radius: 8px;
    box-shadow: var(--shadow-popover);
  }
</style>
