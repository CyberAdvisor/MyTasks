<!--
  Expanded to-do card (FR-1.2): title, notes, When, deadline, Move and more.
  Edits save as you type, debounced 300 ms; there is no Save button.
  Escape or a click outside closes it.
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import Icon from './Icon.svelte';
  import { ui } from '../lib/state/ui.svelte';
  import { go } from '../lib/state/route';
  import { deadlineLabel, formatRelative } from '../lib/model/dates';
  import * as repo from '../lib/db/repo';
  import type { LocalDate, Todo } from '../lib/model/types';

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
  let whenOpen = $state(false);
  let moreOpen = $state(false);

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

  // Escape anywhere inside the card closes it.
  $effect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    card.addEventListener('keydown', onKey);
    return () => card.removeEventListener('keydown', onKey);
  });

  onDestroy(flush);

  function onTitleKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      close();
    }
  }

  async function setWhen(choice: repo.WhenChoice) {
    whenOpen = false;
    await repo.setWhen(todo.id, choice);
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

  let whenLabel = $derived(
    todo.start === 'deferred' ? 'Deferred' : todo.startDate ? formatRelative(todo.startDate, ref) : '',
  );
</script>

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

  <div class="bar">
    <div class="left">
      {#if whenLabel}
        <button type="button" class="chip" onclick={() => (whenOpen = !whenOpen)}>
          <Icon name={todo.start === 'deferred' ? 'archive' : 'calendar'} size={12} />{whenLabel}
        </button>
      {/if}
      {#if todo.deadline}
        <span class="chip" class:due={todo.deadline <= ref}>
          <Icon name="flag" size={12} />Deadline: {deadlineLabel(todo.deadline, ref)}
          <button type="button" class="clear" aria-label="Clear deadline" onclick={() => repo.setDeadline(todo.id, null)}>
            <Icon name="x" size={10} />
          </button>
        </span>
      {/if}
    </div>

    <div class="right">
      <div class="pop-wrap">
        <button type="button" class="icon-btn" aria-label="When" aria-expanded={whenOpen} onclick={() => (whenOpen = !whenOpen)}>
          <Icon name="calendar" size={16} />
        </button>
        {#if whenOpen}
          <div class="pop" role="menu" aria-label="When">
            <button type="button" role="menuitem" onclick={() => setWhen({ kind: 'today' })}>
              <Icon name="star" size={14} color="var(--c-today)" /> Today
            </button>
            <label class="date-row">
              <Icon name="calendar" size={14} color="var(--c-scheduled)" />
              <input
                type="date"
                aria-label="Pick a date"
                value={todo.startDate ?? ''}
                onchange={(e) => {
                  const v = (e.currentTarget as HTMLInputElement).value;
                  if (v) void setWhen({ kind: 'date', date: v });
                }}
              />
            </label>
            <button type="button" role="menuitem" onclick={() => setWhen({ kind: 'deferred' })}>
              <Icon name="archive" size={14} color="var(--c-deferred)" /> Deferred
            </button>
            <button type="button" role="menuitem" onclick={() => setWhen({ kind: 'clear' })}>
              <Icon name="x" size={14} /> Clear
            </button>
          </div>
        {/if}
      </div>

      <label class="icon-btn deadline-btn" title="Deadline">
        <Icon name="flag" size={16} />
        <span class="visually-hidden">Deadline</span>
        <input
          type="date"
          value={todo.deadline ?? ''}
          onchange={(e) => {
            const v = (e.currentTarget as HTMLInputElement).value;
            void repo.setDeadline(todo.id, v || null);
          }}
        />
      </label>

      <button type="button" class="icon-btn" aria-label="Move" onclick={() => (ui.movingId = todo.id)}>
        <Icon name="move" size={16} />
      </button>

      <div class="pop-wrap">
        <button type="button" class="icon-btn" aria-label="More actions" aria-expanded={moreOpen} onclick={() => (moreOpen = !moreOpen)}>
          <Icon name="more" size={16} />
        </button>
        {#if moreOpen}
          <div class="pop" role="menu" aria-label="More actions">
            <button type="button" role="menuitem" onclick={duplicate}>Duplicate</button>
            <button type="button" role="menuitem" onclick={convert}>Convert to Project</button>
            <button type="button" role="menuitem" onclick={() => { moreOpen = false; ui.toggleDone(todo.id, 'canceled'); }}>Cancel To-Do</button>
            <button type="button" role="menuitem" class="danger" onclick={remove}>Delete</button>
          </div>
        {/if}
      </div>
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
  .clear {
    border: 0;
    background: transparent;
    padding: 0 0 0 4px;
    display: inline-flex;
    color: inherit;
  }
  .icon-btn {
    border: 0;
    background: transparent;
    padding: 8px;
    border-radius: var(--radius);
    display: inline-flex;
    color: var(--text-3);
    position: relative;
  }
  .icon-btn:hover {
    background: var(--hover-bg);
  }
  .deadline-btn input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }
  .pop-wrap {
    position: relative;
  }
  .pop {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    min-width: 190px;
    background: #fff;
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
    padding: 4px;
    display: flex;
    flex-direction: column;
    z-index: 20;
  }
  .pop button,
  .date-row {
    display: flex;
    align-items: center;
    gap: 8px;
    text-align: left;
    border: 0;
    background: transparent;
    padding: 8px 10px;
    border-radius: var(--radius);
    font-size: 14px;
  }
  .pop button:hover {
    background: var(--hover-bg);
  }
  .date-row input {
    border: 1px solid #d6d6da;
    border-radius: 4px;
    padding: 2px 4px;
  }
  .danger {
    color: var(--danger);
  }
</style>
