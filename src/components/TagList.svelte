<!--
  Settings › Tags (FR-6.1, FR-6.1b, FR-6.4): the tags in tree order, nested
  tags indented under their parent, which has an arrow to show or hide them.
  Each row renames in place, moves up or down among the tags at its level,
  has a shortcut box, a ⋯ menu to nest it under another tag or move it back
  to the top level, and Delete (the caller confirms). On desktop a tag can
  also be dragged by its icon onto another tag to nest it there, or onto
  "Top level" while dragging.

  The shortcut box: click it and press a letter or digit. Esc
  or a click elsewhere cancels, Delete or Backspace clears it, and a key
  another tag already uses is refused with a note naming that tag. While a
  box waits, it listens for keys on the whole page: Safari doesn't focus a
  clicked button, so the box itself may never get them. Hidden on
  touch-only screens, which have no keyboard to use it.
-->
<script lang="ts">
  import Icon from './Icon.svelte';
  import Popover from './Popover.svelte';
  import { snapshot } from '../lib/state/live';
  import { descendantIds, tagTree } from '../lib/model/tags';
  import { formatTagShortcut, isMac } from '../lib/shortcuts';
  import * as repo from '../lib/db/repo';
  import type { ID, Tag } from '../lib/model/types';

  let { ondelete }: { ondelete: (tag: Tag) => void } = $props();

  const mac = isMac();
  let tags = $derived($snapshot.tags);
  let tree = $derived(tagTree(tags));
  /** Parents whose nested tags are hidden (this device, this visit). */
  let collapsed = $state<Set<ID>>(new Set());
  let rows = $derived(tree.filter(({ tag }) => !hiddenByParent(tag)));

  /** The tag whose shortcut box is waiting for a key, and any note under it. */
  let listening = $state<ID | null>(null);
  let note = $state('');
  /** The tag being dragged, and the row it is over ('top' for the top level). */
  let dragging = $state<ID | null>(null);
  let over = $state<ID | 'top' | null>(null);
  /** Which rows' ⋯ menus are open. */
  let menus = $state<Record<ID, boolean>>({});
  let draft = $state('');

  function hiddenByParent(tag: Tag): boolean {
    const seen = new Set<ID>();
    let parent = tags.find((t) => t.id === tag.parentTagId);
    while (parent && !seen.has(parent.id)) {
      if (collapsed.has(parent.id)) return true;
      seen.add(parent.id);
      parent = tags.find((t) => t.id === parent!.parentTagId);
    }
    return false;
  }

  const hasChildren = (id: ID) => tags.some((t) => t.parentTagId === id);
  const siblings = (tag: Tag) => tree.filter((x) => x.tag.parentTagId === tag.parentTagId).map((x) => x.tag.id);

  function toggleCollapsed(id: ID) {
    const next = new Set(collapsed);
    if (!next.delete(id)) next.add(id);
    collapsed = next;
  }

  function rename(tag: Tag, input: HTMLInputElement) {
    const title = input.value.trim();
    if (!title) input.value = tag.title;
    else if (title !== tag.title) void repo.renameTag(tag.id, title);
  }

  const blurOnEnter = (e: KeyboardEvent) => {
    if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
  };

  /** Tags this one could be nested under: any but itself and those nested under it. */
  function parentChoices(tag: Tag) {
    const own = descendantIds(tag.id, tags);
    return tree.filter((x) => !own.has(x.tag.id) && x.tag.id !== tag.parentTagId);
  }

  function nest(tag: Tag, parentId: ID | null) {
    menus[tag.id] = false;
    void repo.nestTag(tag.id, parentId);
    if (parentId) collapsed = new Set([...collapsed].filter((id) => id !== parentId));
  }

  function listen(id: ID) {
    listening = listening === id ? null : id;
    note = '';
  }

  // While a box waits: its keys, from anywhere on the page (before the app's
  // shortcuts see them), and a click outside the shortcut boxes cancels.
  $effect(() => {
    const id = listening;
    if (id === null) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = tags.find((t) => t.id === id);
      if (tag) void onShortcutKey(e, tag);
    };
    const onDown = (e: PointerEvent) => {
      if (!(e.target as Element).closest?.('.key')) stopListening(id);
    };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
    };
  });

  async function onShortcutKey(e: KeyboardEvent, tag: Tag) {
    if (listening !== tag.id || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Tab') return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') {
      listening = null;
      note = '';
      return;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      await repo.setTagShortcut(tag.id, null);
      stopListening(tag.id);
      return;
    }
    const key = /^(?:Key|Digit)([A-Z0-9])$/.exec(e.code)?.[1];
    if (!key) return;
    const taken = await repo.setTagShortcut(tag.id, key);
    if (taken && listening === tag.id) note = `“${key}” is already used by ${taken.title || 'Untitled'}.`;
    else if (!taken) stopListening(tag.id);
  }

  /** Close this tag's box once its key is saved, unless another box has opened meanwhile. */
  function stopListening(id: ID) {
    if (listening !== id) return;
    listening = null;
    note = '';
  }

  function onDragStart(e: DragEvent, id: ID) {
    dragging = id;
    e.dataTransfer?.setData('text/plain', id);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  }

  /** Whether the dragged tag may be dropped onto `target` ('top' for the top level). */
  function canDrop(target: ID | 'top'): boolean {
    if (!dragging) return false;
    if (target === 'top') return tags.find((t) => t.id === dragging)?.parentTagId !== null;
    return !descendantIds(dragging, tags).has(target);
  }

  function onDragOver(e: DragEvent, target: ID | 'top') {
    if (!canDrop(target)) return;
    e.preventDefault();
    over = target;
  }

  function onDrop(e: DragEvent, target: ID | 'top') {
    e.preventDefault();
    if (dragging && canDrop(target)) {
      void repo.nestTag(dragging, target === 'top' ? null : target);
      if (target !== 'top') collapsed = new Set([...collapsed].filter((id) => id !== target));
    }
    dragging = over = null;
  }

  async function add(e: SubmitEvent) {
    e.preventDefault();
    const title = draft.trim();
    if (!title) return;
    draft = '';
    await repo.createTag(title);
  }
</script>

{#if rows.length}
  <ul class="rows">
    {#each rows as { tag, depth } (tag.id)}
      {@const sibs = siblings(tag)}
      {@const name = tag.title || 'Untitled'}
      <li
        class:over={over === tag.id}
        style:padding-left="{depth * 22}px"
        ondragover={(e) => onDragOver(e, tag.id)}
        ondragleave={() => over === tag.id && (over = null)}
        ondrop={(e) => onDrop(e, tag.id)}
      >
        {#if hasChildren(tag.id)}
          <button
            type="button"
            class="btn-plain disclose"
            aria-label="{collapsed.has(tag.id) ? 'Show' : 'Hide'} tags in {name}"
            aria-expanded={!collapsed.has(tag.id)}
            onclick={() => toggleCollapsed(tag.id)}
          >
            <Icon name={collapsed.has(tag.id) ? 'chevron-right' : 'chevron-down'} size={13} />
          </button>
        {:else}
          <span class="disclose"></span>
        {/if}
        <span
          class="handle"
          role="button"
          tabindex="-1"
          aria-label="Drag {name} onto another tag to nest it"
          draggable="true"
          ondragstart={(e) => onDragStart(e, tag.id)}
          ondragend={() => (dragging = over = null)}
        >
          <Icon name="tag" size={14} color="var(--text-3)" />
        </span>
        <input class="text" value={tag.title} aria-label="Tag name" onchange={(e) => rename(tag, e.currentTarget)} onkeydown={blurOnEnter} />
        <button
          type="button"
          class="key"
          class:listening={listening === tag.id}
          aria-label={tag.shortcut ? `Shortcut for ${name}: ${tag.shortcut}` : `Set a shortcut for ${name}`}
          title={tag.shortcut ? `${formatTagShortcut(tag.shortcut, mac)} adds or removes the tag, ${formatTagShortcut(tag.shortcut, mac, true)} filters by it` : 'Shortcut'}
          onclick={() => listen(tag.id)}
        >
          {listening === tag.id ? '…' : (tag.shortcut ?? '')}
        </button>
        <button type="button" class="btn-plain small" aria-label="Move {name} up" disabled={sibs[0] === tag.id} onclick={() => repo.moveTag(tag.id, 'up')}>
          <Icon name="arrow-up" size={14} />
        </button>
        <button type="button" class="btn-plain small" aria-label="Move {name} down" disabled={sibs[sibs.length - 1] === tag.id} onclick={() => repo.moveTag(tag.id, 'down')}>
          <Icon name="arrow-down" size={14} />
        </button>
        <Popover bind:open={() => menus[tag.id] ?? false, (v) => (menus[tag.id] = v)} label="Nest {name}">
          {#snippet trigger(toggle, isOpen)}
            <button type="button" class="btn-plain small" aria-label="Nest {name}" aria-expanded={isOpen} onclick={toggle}>
              <Icon name="more" size={14} />
            </button>
          {/snippet}
          <div role="menu" aria-label="Nest {name}">
            {#if tag.parentTagId !== null}
              <button type="button" class="menu-item" role="menuitem" onclick={() => nest(tag, null)}>Move to Top Level</button>
              <hr class="menu-sep" />
            {/if}
            <div class="menu-label" role="presentation">Nest Under</div>
            {#each parentChoices(tag) as choice (choice.tag.id)}
              <button type="button" class="menu-item" role="menuitem" style:padding-left="{10 + choice.depth * 14}px" onclick={() => nest(tag, choice.tag.id)}>
                {choice.tag.title || 'Untitled'}
              </button>
            {:else}
              <p class="none">No other tags.</p>
            {/each}
          </div>
        </Popover>
        <button type="button" class="btn-plain small danger" aria-label="Delete {name}" onclick={() => ondelete(tag)}>
          <Icon name="trash" size={14} />
        </button>
      </li>
      {#if listening === tag.id}
        <li class="hint" style:padding-left="{depth * 22 + 44}px">
          {#if note}<span class="taken">{note}</span>{:else}Press a key for “{name}”. Esc cancels. Delete clears it.{/if}
        </li>
      {/if}
    {/each}
    {#if dragging && canDrop('top')}
      <li class="top" class:over={over === 'top'} ondragover={(e) => onDragOver(e, 'top')} ondrop={(e) => onDrop(e, 'top')}>Top level</li>
    {/if}
  </ul>
{:else}
  <p class="help">No tags yet.</p>
{/if}
<form class="add" onsubmit={add}>
  <input class="text" bind:value={draft} placeholder="New tag" aria-label="New tag name" />
  <button type="submit" class="btn-plain" disabled={!draft.trim()}><Icon name="plus" size={14} /> Add Tag</button>
</form>

<style>
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .rows li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
    border-radius: var(--radius);
  }
  .rows li.over {
    background: var(--selection, rgba(0, 122, 255, 0.12));
  }
  .disclose {
    width: 20px;
    padding: 2px;
    display: inline-flex;
    justify-content: center;
  }
  .handle {
    display: inline-flex;
    cursor: grab;
  }
  .text {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 5px 8px;
    font-size: 14px;
    width: 220px;
    max-width: 100%;
  }
  .key {
    width: 26px;
    height: 26px;
    border: 1px solid var(--line);
    border-radius: 5px;
    background: none;
    font-size: 12px;
    color: var(--text-2);
  }
  .key.listening {
    border-color: var(--accent);
    color: var(--accent);
  }
  @media (hover: none) and (pointer: coarse) {
    .key,
    .handle {
      display: none;
    }
  }
  .small {
    padding: 4px 6px;
    font-size: 13px;
  }
  .danger {
    color: var(--danger);
  }
  .hint {
    font-size: 12px;
    color: var(--text-3);
  }
  .taken {
    color: var(--danger);
  }
  .top {
    justify-content: center;
    font-size: 12px;
    color: var(--text-3);
    border: 1px dashed var(--line);
  }
  .none {
    margin: 4px 10px;
    font-size: 12px;
    color: var(--text-3);
  }
  .help {
    font-size: 13px;
    color: var(--text-3);
    margin: 4px 0 10px;
  }
  .add {
    display: flex;
    gap: 8px;
    margin-top: 10px;
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
