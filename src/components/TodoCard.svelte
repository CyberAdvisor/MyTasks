<!--
  Expanded to-do card (FR-1.2): title, notes, checklist, tags, When,
  deadline and priority. Set fields show as chips on the left of the bottom
  bar; buttons for the empty ones sit on the right, as in Things.
  Edits save as you type, debounced 300 ms; there is no Save button.
  Escape or a click outside closes it.
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import Icon from './Icon.svelte';
  import Popover from './Popover.svelte';
  import WhenPicker from './WhenPicker.svelte';
  import DeadlinePicker from './DeadlinePicker.svelte';
  import TagPicker from './TagPicker.svelte';
  import PriorityMenu from './PriorityMenu.svelte';
  import Checklist from './Checklist.svelte';
  import { ui } from '../lib/state/ui.svelte';
  import { go } from '../lib/state/route';
  import { settings, snapshot } from '../lib/state/live';
  import { deadlineLabel, formatRelative } from '../lib/model/dates';
  import { priorityLabel } from '../lib/model/settings';
  import { checklistFor, tagTitles } from '../lib/model/tags';
  import { storedChecklist } from '../lib/state/checklist.svelte';
  import * as repo from '../lib/db/repo';
  import type { ID, LocalDate, Priority, Todo } from '../lib/model/types';

  let { todo, ref }: { todo: Todo; ref: LocalDate } = $props();

  const SAVE_DELAY_MS = 300;

  // Local copies so typing is never interrupted by live-query refreshes.
  // svelte-ignore state_referenced_locally
  let title = $state(todo.title);
  // svelte-ignore state_referenced_locally
  let notes = $state(todo.notes);
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let card: HTMLDivElement;
  let titleInput: HTMLInputElement;

  // Which popover is open.
  let whenOpen = $state(false);
  let deadlineOpen = $state(false);
  let tagsOpen = $state(false);
  let prioOpen = $state(false);
  let moreOpen = $state(false);
  /** Checklist item to focus once it renders. */
  let checklistFocus = $state<ID | null>(null);

  let hasWhen = $derived(todo.start === 'deferred' || todo.startDate !== null);
  let whenLabel = $derived(
    todo.start === 'deferred'
      ? 'Deferred'
      : todo.startDate === null
        ? ''
        : todo.startDate <= ref
          ? 'Today'
          : formatRelative(todo.startDate, ref),
  );
  let tagNames = $derived(tagTitles(todo.tagIds, $snapshot));
  let checklistItems = $derived(checklistFor(todo.id, $snapshot));
  let checklistOps = $derived(storedChecklist(todo.id));

  /** Persist pending text edits now. */
  function flush() {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    if (title !== todo.title || notes !== todo.notes) {
      void repo.updateTodoText(todo.id, { title, notes });
    }
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, SAVE_DELAY_MS);
  }

  function close() {
    flush();
    ui.close();
  }

  // Focus the title of a new (empty) to-do so the user can type at once.
  $effect(() => {
    if (!todo.title) titleInput.focus();
  });

  // Close on a click outside the card, unless it lands in a dialog.
  $effect(() => {
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (card.contains(target)) return;
      if ((target as Element).closest?.('dialog')) return;
      close();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  });

  // Escape closes the card, even after a menu choice has moved focus out of it.
  // Open popovers stop the key first; keys inside dialogs are left to them.
  $effect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || (e.target as Element).closest?.('dialog')) return;
      close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  onDestroy(flush);

  function onTitleKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      close();
    }
  }

  function chooseWhen(choice: repo.WhenChoice) {
    whenOpen = false;
    void repo.setWhen(todo.id, choice);
  }

  function chooseDeadline(deadline: LocalDate | null) {
    deadlineOpen = false;
    void repo.setDeadline(todo.id, deadline);
  }

  function choosePriority(p: Priority | null) {
    prioOpen = false;
    void repo.setPriority(todo.id, p);
  }

  async function addChecklist() {
    [checklistFocus] = await checklistOps.add([''], null);
  }

  async function convert() {
    moreOpen = false;
    flush();
    const id = await repo.convertTodoToProject(todo.id);
    ui.close();
    if (id) go({ kind: 'project', id });
  }

  async function remove() {
    moreOpen = false;
    flush();
    ui.close();
    await repo.setTodoTrashed(todo.id, true);
  }

  async function duplicate() {
    moreOpen = false;
    flush();
    await repo.duplicateTodo(todo.id);
  }
</script>

{#snippet whenPanel()}
  <WhenPicker startDate={todo.startDate} deferred={todo.start === 'deferred'} {ref} onchoose={chooseWhen} />
{/snippet}
{#snippet deadlinePanel()}
  <DeadlinePicker deadline={todo.deadline} {ref} onchoose={chooseDeadline} />
{/snippet}
{#snippet tagsPanel()}
  <TagPicker
    tagIds={todo.tagIds}
    ontoggle={(tagId, on) => repo.toggleTag('todos', todo.id, tagId, on)}
    ondone={() => (tagsOpen = false)}
  />
{/snippet}
{#snippet prioPanel()}
  <PriorityMenu priority={todo.priority} onchoose={choosePriority} />
{/snippet}

<div class="card" bind:this={card} role="group" aria-label="Edit to-do">
  <div class="top">
    <button
      type="button"
      class="check"
      role="checkbox"
      aria-checked={ui.pending[todo.id] !== undefined}
      aria-label="Complete"
      onclick={(e) => ui.toggleDone(todo.id, e.altKey ? 'canceled' : 'completed')}
    >
      {#if ui.pending[todo.id]}<Icon name="check" size={12} color="#fff" />{/if}
    </button>
    <label class="visually-hidden" for="title-{todo.id}">Title</label>
    <input
      id="title-{todo.id}"
      class="title"
      bind:this={titleInput}
      bind:value={title}
      oninput={scheduleSave}
      onkeydown={onTitleKey}
      placeholder="New To-Do"
      autocomplete="off"
    />
  </div>

  <label class="visually-hidden" for="notes-{todo.id}">Notes</label>
  <textarea
    id="notes-{todo.id}"
    class="notes"
    bind:value={notes}
    oninput={scheduleSave}
    placeholder="Notes"
    rows="2"
  ></textarea>

  <Checklist items={checklistItems} ops={checklistOps} bind:focusId={checklistFocus} />

  {#snippet tagChips()}
    {#each tagNames as name, i (i)}<span class="tag-pill">{name}</span>{/each}
  {/snippet}
  {#if tagNames.length}
    <div class="tags">
      <Popover bind:open={tagsOpen} label="Tags" align="left">
        {#snippet trigger(toggle)}
          <button type="button" class="tag-list" aria-label="Edit tags" onclick={toggle}>{@render tagChips()}</button>
        {/snippet}
        {@render tagsPanel()}
      </Popover>
    </div>
  {/if}

  <div class="bar">
    <div class="left">
      {#if hasWhen}
        <Popover bind:open={whenOpen} label="When" align="left">
          {#snippet trigger(toggle)}
            <button type="button" class="chip" onclick={toggle}>
              <Icon name={todo.start === 'deferred' ? 'archive' : todo.startDate && todo.startDate <= ref ? 'star' : 'calendar'} size={12} />{whenLabel}
            </button>
          {/snippet}
          {@render whenPanel()}
        </Popover>
      {/if}
      {#if todo.deadline}
        <Popover bind:open={deadlineOpen} label="Deadline" align="left">
          {#snippet trigger(toggle)}
            <button type="button" class="chip" class:due={todo.deadline! <= ref} onclick={toggle}>
              <Icon name="flag" size={12} />Deadline: {deadlineLabel(todo.deadline!, ref)}
            </button>
          {/snippet}
          {@render deadlinePanel()}
        </Popover>
      {/if}
      {#if todo.priority}
        <Popover bind:open={prioOpen} label="Priority" align="left">
          {#snippet trigger(toggle)}
            <button type="button" class="chip" aria-label="Priority: {priorityLabel(todo.priority!, $settings)}" onclick={toggle}>
              <span class="prio prio-{todo.priority}">{priorityLabel(todo.priority!, $settings)}</span>
            </button>
          {/snippet}
          {@render prioPanel()}
        </Popover>
      {/if}
    </div>

    <div class="right">
      {#if !hasWhen}
        <Popover bind:open={whenOpen} label="When">
          {#snippet trigger(toggle, open)}
            <button type="button" class="icon-btn" aria-label="When" title="When" aria-expanded={open} onclick={toggle}>
              <Icon name="calendar" size={16} />
            </button>
          {/snippet}
          {@render whenPanel()}
        </Popover>
      {/if}
      {#if !tagNames.length}
        <Popover bind:open={tagsOpen} label="Tags">
          {#snippet trigger(toggle, open)}
            <button type="button" class="icon-btn" aria-label="Tags" title="Tags" aria-expanded={open} onclick={toggle}>
              <Icon name="tag" size={16} />
            </button>
          {/snippet}
          {@render tagsPanel()}
        </Popover>
      {/if}
      {#if !checklistItems.length}
        <button type="button" class="icon-btn" aria-label="Add checklist" title="Checklist" onclick={addChecklist}>
          <Icon name="checklist" size={16} />
        </button>
      {/if}
      {#if !todo.deadline}
        <Popover bind:open={deadlineOpen} label="Deadline">
          {#snippet trigger(toggle, open)}
            <button type="button" class="icon-btn" aria-label="Deadline" title="Deadline" aria-expanded={open} onclick={toggle}>
              <Icon name="flag" size={16} />
            </button>
          {/snippet}
          {@render deadlinePanel()}
        </Popover>
      {/if}
      {#if !todo.priority}
        <Popover bind:open={prioOpen} label="Priority">
          {#snippet trigger(toggle, open)}
            <button type="button" class="icon-btn" aria-label="Priority" title="Priority" aria-expanded={open} onclick={toggle}>
              <Icon name="priority" size={16} />
            </button>
          {/snippet}
          {@render prioPanel()}
        </Popover>
      {/if}

      <button type="button" class="icon-btn" aria-label="Move" title="Move" onclick={() => (ui.movingId = todo.id)}>
        <Icon name="move" size={16} />
      </button>

      <Popover bind:open={moreOpen} label="More actions">
        {#snippet trigger(toggle, open)}
          <button type="button" class="icon-btn" aria-label="More actions" title="More" aria-expanded={open} onclick={toggle}>
            <Icon name="more" size={16} />
          </button>
        {/snippet}
        <div role="menu" aria-label="More actions">
          <button type="button" class="menu-item" role="menuitem" onclick={duplicate}>Duplicate</button>
          <button type="button" class="menu-item" role="menuitem" onclick={convert}>Convert to Project</button>
          <button type="button" class="menu-item" role="menuitem" onclick={() => { moreOpen = false; ui.toggleDone(todo.id, 'canceled'); }}>Cancel To-Do</button>
          <button type="button" class="menu-item danger" role="menuitem" onclick={remove}>Delete</button>
        </div>
      </Popover>
    </div>
  </div>
</div>

<style>
  .card {
    margin: 6px 0;
    padding: 12px 14px 10px;
    border-radius: 10px;
    background: #fff;
    border: 1px solid #e5e5e8;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06), 0 10px 28px rgba(0, 0, 0, 0.08);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .top {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .check {
    width: 16px;
    height: 16px;
    padding: 0;
    flex: none;
    border: 1.5px solid var(--border);
    border-radius: 4px;
    background: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .check[aria-checked='true'] {
    background: var(--accent);
    border-color: var(--accent);
  }
  .title {
    flex: 1;
    border: 0;
    outline: none;
    font-size: 15px;
    font-weight: 600;
    padding: 2px 0;
    background: transparent;
  }
  .notes {
    margin-left: 28px;
    border: 0;
    outline: none;
    resize: vertical;
    font-size: 14px;
    color: var(--text-2);
    line-height: 1.45;
    background: transparent;
  }
  .tags {
    margin-left: 28px;
  }
  .tag-list {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    border: 0;
    background: transparent;
    padding: 0;
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-left: 28px;
    padding-top: 6px;
    border-top: 1px solid var(--rule);
  }
  .left,
  .right {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
  }
  .chip.due {
    color: var(--danger);
    font-weight: 600;
  }
  .icon-btn {
    border: 0;
    background: transparent;
    padding: 8px;
    border-radius: var(--radius);
    display: inline-flex;
    color: var(--text-3);
  }
  .icon-btn:hover {
    background: var(--hover-bg);
  }
  .danger {
    color: var(--danger);
  }
</style>
