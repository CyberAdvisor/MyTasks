<!--
  Checklist editor (FR-7.1, FR-7.2), used by the to-do card (stored
  checklist) and Quick Entry (draft checklist); `ops` decides which.
  Keys in an item: Enter adds the next item; Backspace in an empty item
  deletes it (erasing an item's text is the way to delete it: there is no
  delete button, so a stray tap can't); Cmd/Ctrl+Up/Down or Alt+Up/Down
  moves it. The handle at the end of each item drags it, with a mouse or on
  touch (at once, no long press); the rest of the item edits as usual. Pasting several lines adds one item per
  line. Empty items are removed when the card closes.
  An item with a link shows its text with the link clickable (a new tab) until a
  click, tap or Tab turns it into its text box (linkPress.ts); other items are
  always the text box.
  With "Move checked items to the bottom of the checklist" on, checked items
  show below the unchecked ones (FR-7.5); display only, so unchecking an
  item puts it back in its place.
-->
<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { onHide } from '../lib/state/onHide';
  import Icon from './Icon.svelte';
  import { splitLines } from '../lib/model/tags';
  import { sinkDone } from '../lib/model/lists';
  import { settings } from '../lib/state/live';
  import { droppedOrder, type ChecklistOps, type ChecklistRow } from '../lib/state/checklist.svelte';
  import { dragItem, dropZone, type DropZone } from '../lib/drag/drag';
  import type { ID } from '../lib/model/types';
  import { hasLink, parseLinks } from '../lib/model/markdown';
  import { linkPress } from '../lib/linkPress';

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

  /** The items in display order. */
  let shown = $derived($settings.sinkChecked ? sinkDone(items, (c) => c.completed) : items);

  let list = $state<HTMLUListElement>();

  /** Dragging an item by its handle (FR-7.1); `order` is the items as shown. */
  const zone: DropZone = {
    type: 'checklist',
    quiet: true,
    slide: true,
    drop: (id, order) => {
      save(id);
      const done = new Map(items.map((c) => [c.id, c.completed]));
      const together = $settings.sinkChecked ? (x: ID) => done.get(x) === done.get(id) : undefined;
      return ops.place(id, droppedOrder([...done.keys()], order, id, together));
    },
  };
  /**
   * Titles typed but not yet shown back by `items`, by item id. They stay
   * until the stored title matches, so a save never flashes the old text.
   */
  let drafts = $state<Record<ID, string>>({});
  let timers = new Map<ID, ReturnType<typeof setTimeout>>();

  const titleOf = (item: ChecklistRow) => drafts[item.id] ?? item.title;

  /** The item being edited; an item with a link shows as text otherwise. */
  let editing = $state<ID | null>(null);
  const showsText = (item: ChecklistRow) => editing !== item.id && hasLink(titleOf(item));

  /** Focus an item's text box, turning shown text into it first; `atEnd` puts the caret after the text. */
  async function focusItem(id: ID, atEnd = false) {
    editing = id;
    await tick();
    const box = list?.querySelector<HTMLInputElement>(`input[data-item="${CSS.escape(id)}"]`);
    if (!box) return;
    box.focus();
    if (atEnd) box.setSelectionRange(box.value.length, box.value.length);
  }

  // Move focus to a newly added item once it renders.
  $effect(() => {
    const id = focusId;
    if (!id || !items.some((c) => c.id === id)) return;
    void tick().then(() => {
      void focusItem(id);
      focusId = null;
    });
  });

  /**
   * The item last moved by keyboard. Showing the new order can move its row
   * in the page, which drops focus (moving down did); it is focused again.
   */
  let moved: ID | null = null;
  $effect(() => {
    void shown.map((c) => c.id);
    const id = moved;
    if (!id) return;
    void tick().then(() => {
      const lost = !document.activeElement || document.activeElement === document.body;
      if (lost && moved === id) void focusItem(id);
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
    moved = null;
    // Return adds the next item; Cmd/Ctrl+Return is left to the card and
    // Quick Entry, which save and close (FR-1.2, FR-8.1).
    if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      save(item.id);
      [focusId] = await ops.add([''], item.id);
    } else if (e.key === 'Backspace' && titleOf(item) === '') {
      e.preventDefault();
      const prev = shown[index - 1];
      await ops.remove(item.id);
      if (prev) focusId = prev.id;
    } else if ((e.altKey || e.metaKey || e.ctrlKey) && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      // Not the task row's own Cmd/Ctrl+Up/Down.
      e.stopPropagation();
      save(item.id);
      moved = item.id;
      await ops.move(item.id, e.key === 'ArrowUp' ? 'up' : 'down');
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
  // Leaving the app saves typed items at once (review C7).
  $effect(() =>
    onHide(() => {
      for (const id of [...timers.keys()]) save(id);
    }),
  );
</script>

{#if items.length}
  <ul class="checklist" bind:this={list} aria-label="Checklist" use:dropZone={zone}>
    {#each shown as item, i (item.id)}
      <li class:done={item.completed} use:dragItem={{ type: 'checklist', id: item.id, handle: true }}>
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
        {#if showsText(item)}
          <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
          <span
            class="text"
            data-item-view={item.id}
            role="textbox"
            tabindex="0"
            aria-label="Checklist item"
            {...linkPress(() => void focusItem(item.id, true))}
          >
            {#each parseLinks(titleOf(item)) as piece, k (k)}{#if piece.kind === 'link'}<a
                  href={piece.href}
                  target="_blank"
                  rel="noopener noreferrer">{piece.children.map((c) => (c.kind === 'text' ? c.text : '')).join('')}</a
                >{:else if piece.kind === 'text'}{piece.text}{/if}{/each}
          </span>
        {:else}
          <input
            data-item={item.id}
            value={titleOf(item)}
            oninput={(e) => onInput(item.id, e.currentTarget.value)}
            onfocus={() => (editing = item.id)}
            onblur={() => {
              save(item.id);
              if (editing === item.id) editing = null;
            }}
            onkeydown={(e) => onKey(e, item, i)}
            onpaste={(e) => onPaste(e, item)}
            placeholder="Checklist item"
            aria-label="Checklist item"
            autocomplete="off"
          />
        {/if}
        <span class="handle" data-drag-handle aria-hidden="true">
          <Icon name="grip" size={14} />
        </span>
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
    background: var(--field);
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
    /* Safari gives a field a default width; without this it pushes the handle past the row's end. */
    min-width: 0;
    border: 0;
    outline: none;
    background: transparent;
    font-size: 14px;
    padding: 4px 0;
  }
  .done input,
  .done .text {
    color: var(--text-done);
    text-decoration: line-through;
  }
  /* An item with a link, shown as text: the same size and place as its text box. */
  .text {
    flex: 1;
    min-width: 0;
    font-size: 14px;
    line-height: 1.35;
    padding: 4px 0;
    cursor: text;
    overflow-wrap: anywhere;
  }
  .text:focus {
    outline: none;
  }
  .text a {
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  /* The drag handle: on hover with a mouse, always on touch. */
  .handle {
    flex: none;
    display: inline-flex;
    padding: 4px 6px;
    color: var(--text-3);
    cursor: grab;
    touch-action: none;
    opacity: 0;
  }
  li:hover .handle,
  li:focus-within .handle {
    opacity: 1;
  }
  @media (pointer: coarse) {
    .handle {
      opacity: 1;
      padding: 8px 10px 8px 12px;
    }
  }
  /* With a mouse or trackpad, a size larger; touch screens keep 14 px. */
  @media (pointer: fine) {
    input,
    .text {
      font-size: 15px;
    }
  }
</style>
