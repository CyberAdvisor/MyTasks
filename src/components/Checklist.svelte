<!--
  Checklist editor (FR-7.1, FR-7.2), used by the to-do card (stored
  checklist) and Quick Entry (draft checklist); `ops` decides which.
  Keys in an item: Enter adds the next item; Backspace in an empty item
  deletes it; Alt+Up/Down moves it. Pasting several lines adds one item per
  line. Empty items are removed when the card closes.
-->
<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import Icon from './Icon.svelte';
  import { splitLines } from '../lib/model/tags';
  import type { ChecklistOps, ChecklistRow } from '../lib/state/checklist.svelte';
  import type { ID } from '../lib/model/types';

  let {
    items,
    ops,
    focusId = $bindable(null),
  }: {
    /** The checklist in order. */
    items: ChecklistRow[];
    /** Where changes are written. */
    ops: ChecklistOps;
    /** Item to focus once it renders. */
    focusId?: ID | null;
  } = $props();

  const SAVE_DELAY_MS = 300;

  let list = $state<HTMLUListElement>();
  /**
   * Titles typed but not yet shown back by `items`, by item id. They stay
   * until the stored title matches, so a save never flashes the old text.
   */
  let drafts = $state<Record<ID, string>>({});
  let timers = new Map<ID, ReturnType<typeof setTimeout>>();

  const titleOf = (item: ChecklistRow) => drafts[item.id] ?? item.title;

  // Move focus to a newly added item once it renders.
  $effect(() => {
    const id = focusId;
    if (!id || !items.some((c) => c.id === id)) return;
    void tick().then(() => {
      list?.querySelector<HTMLInputElement>(`[data-item="${id}"]`)?.focus();
      focusId = null;
    });
  });

  // Drop typed text once the stored title has caught up with it.
  $effect(() => {
    for (const item of items) {
      if (drafts[item.id] === item.title && !timers.has(item.id)) delete drafts[item.id];
    }
  });

  function save(id: ID) {
    clearTimeout(timers.get(id));
    timers.delete(id);
    const title = drafts[id];
    const item = items.find((c) => c.id === id);
    if (title === undefined || !item) return;
    if (title === item.title) delete drafts[id];
    else void ops.update(id, { title });
  }

  function onInput(id: ID, value: string) {
    drafts[id] = value;
    clearTimeout(timers.get(id));
    timers.set(id, setTimeout(() => save(id), SAVE_DELAY_MS));
  }

  async function onKey(e: KeyboardEvent, item: ChecklistRow, index: number) {
    if (e.key === 'Enter') {
      e.preventDefault();
      save(item.id);
      [focusId] = await ops.add([''], item.id);
    } else if (e.key === 'Backspace' && titleOf(item) === '') {
      e.preventDefault();
      const prev = items[index - 1];
      await ops.remove(item.id);
      if (prev) focusId = prev.id;
    } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      save(item.id);
      await ops.move(item.id, e.key === 'ArrowUp' ? 'up' : 'down');
      focusId = item.id;
    }
  }

  /** Multi-line paste: the first line fills this item if it is empty, the rest follow it. */
  async function onPaste(e: ClipboardEvent, item: ChecklistRow) {
    const lines = splitLines(e.clipboardData?.getData('text') ?? '');
    if (lines.length < 2) return;
    e.preventDefault();
    let rest = lines;
    if (titleOf(item) === '') {
      drafts[item.id] = lines[0];
      save(item.id);
      rest = lines.slice(1);
    }
    const ids = await ops.add(rest, item.id);
    focusId = ids[ids.length - 1];
  }

  // Save anything still typed, and drop empty items, when the editor closes.
  onDestroy(() => {
    for (const id of timers.keys()) save(id);
    for (const item of items) if (!titleOf(item).trim()) void ops.remove(item.id);
  });
</script>

{#if items.length}
  <ul class="checklist" bind:this={list} aria-label="Checklist">
    {#each items as item, i (item.id)}
      <li class:done={item.completed}>
        <button
          type="button"
          class="box"
          role="checkbox"
          aria-checked={item.completed}
          aria-label={`Check ${titleOf(item) || 'item'}`}
          onclick={() => ops.update(item.id, { completed: !item.completed })}
        >
          {#if item.completed}<Icon name="check" size={10} color="#fff" />{/if}
        </button>
        <input
          data-item={item.id}
          value={titleOf(item)}
          oninput={(e) => onInput(item.id, e.currentTarget.value)}
          onblur={() => save(item.id)}
          onkeydown={(e) => onKey(e, item, i)}
          onpaste={(e) => onPaste(e, item)}
          placeholder="Checklist item"
          aria-label="Checklist item"
          autocomplete="off"
        />
        <button type="button" class="remove" aria-label="Delete item" onclick={() => ops.remove(item.id)}>
          <Icon name="x" size={11} />
        </button>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .checklist {
    list-style: none;
    margin: 2px 0 2px 28px;
    padding: 0;
  }
  li {
    display: flex;
    align-items: center;
    gap: 8px;
    border-bottom: 1px solid var(--rule);
    min-height: 30px;
  }
  .box {
    width: 13px;
    height: 13px;
    padding: 0;
    flex: none;
    border: 1.5px solid var(--border);
    border-radius: 50%;
    background: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .done .box {
    background: var(--accent);
    border-color: var(--accent);
  }
  input {
    flex: 1;
    border: 0;
    outline: none;
    background: transparent;
    font-size: 14px;
    padding: 4px 0;
  }
  .done input {
    color: var(--text-done);
    text-decoration: line-through;
  }
  .remove {
    border: 0;
    background: transparent;
    padding: 4px;
    color: var(--text-3);
    display: inline-flex;
    opacity: 0;
  }
  li:hover .remove,
  .remove:focus-visible {
    opacity: 1;
  }
  @media (pointer: coarse) {
    .remove {
      opacity: 1;
    }
  }
</style>
