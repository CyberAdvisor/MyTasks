<!--
  One to-do row (design doc, Section 6, Components: Row), laid out as in
  Things: the title, then the note and checklist icons and the tags; the
  project or area underneath; the context, deadline and priority on the right.
  Shows the expanded card in place when this to-do is open. Open rows can be
  selected with the arrow keys and dragged within their list (FR-10.3).
-->
<script lang="ts">
  import Icon from './Icon.svelte';
  import TodoCard from './TodoCard.svelte';
  import { ui } from '../lib/state/ui.svelte';
  import { settings, snapshot } from '../lib/state/live';
  import { deadlineLabel, formatRelative } from '../lib/model/dates';
  import { priorityLabel } from '../lib/model/settings';
  import { checklistProgress, tagTitles } from '../lib/model/tags';
  import { contextTitle } from '../lib/model/contexts';
  import * as repo from '../lib/db/repo';
  import { dragItem } from '../lib/drag/drag';
  import type { LocalDate, Todo } from '../lib/model/types';

  let {
    todo,
    ref,
    containerLabel = '',
    starred = false,
    mode = 'open',
    showPriority = true,
    showContext = true,
  }: {
    todo: Todo;
    /** Today's date, for deadline and date labels. */
    ref: LocalDate;
    /** Project or area name to show under the title. */
    containerLabel?: string;
    /** Show the Today star (used in Unscheduled). */
    starred?: boolean;
    /** `open` lists, `logbook` (checked rows) or `trash` (restore button). */
    mode?: 'open' | 'logbook' | 'trash';
    /** Show the priority chip (hidden when Today is grouped by priority, FR-14.4). */
    showPriority?: boolean;
    /** Show the context (hidden when Today is grouped by context, FR-18.7). */
    showContext?: boolean;
  } = $props();

  let item = $state<HTMLLIElement>();

  // Bring the row into view when Quick Find opens it.
  $effect(() => {
    if (ui.scrollId !== todo.id || !item) return;
    item.scrollIntoView({ block: 'center' });
    ui.scrollId = null;
  });

  let pending = $derived(ui.pending[todo.id]);
  let done = $derived(mode === 'logbook' || pending !== undefined);
  let canceled = $derived(todo.status === 'canceled' || pending === 'canceled');
  let due = $derived(todo.deadline !== null && todo.deadline <= ref);
  let futureDate = $derived(todo.startDate !== null && todo.startDate > ref ? todo.startDate : null);
  let tags = $derived(tagTitles(todo.tagIds, $snapshot));
  let checklist = $derived(checklistProgress(todo.id, $snapshot));
  let context = $derived(showContext ? contextTitle(todo.contextId, $snapshot) : '');

  /** Checkbox: complete (Alt-click cancels), or reopen from the Logbook. */
  function onCheck(e: MouseEvent) {
    if (mode === 'logbook') {
      void repo.setTodoStatus(todo.id, 'open');
      return;
    }
    if (mode === 'trash') return;
    ui.toggleDone(todo.id, e.altKey ? 'canceled' : 'completed');
  }

  /** Touch opens straight away; a pointer selects, double-click opens. */
  function onRowClick(e: MouseEvent) {
    if (mode !== 'open') return;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    if (coarse || e.detail >= 2) ui.open(todo.id);
    else ui.selectedId = todo.id;
  }

  function onKey(e: KeyboardEvent) {
    if (mode === 'open' && e.key === 'Enter') {
      e.preventDefault();
      ui.open(todo.id);
    }
  }
</script>

{#if ui.expandedId === todo.id && mode === 'open'}
  <li class="card-slot" bind:this={item}><TodoCard {todo} {ref} /></li>
{:else}
  <li
    class="row"
    bind:this={item}
    class:selected={ui.selectedId === todo.id}
    class:done
    data-row-id={mode === 'open' ? todo.id : undefined}
    use:dragItem={mode === 'open' ? { type: 'todo', id: todo.id } : null}
  >
    <button
      type="button"
      data-no-drag
      class="check"
      class:checked={done}
      class:canceled
      role="checkbox"
      aria-checked={done}
      aria-label={`${done ? 'Mark not done' : 'Complete'}: ${todo.title || 'New To-Do'}`}
      disabled={mode === 'trash'}
      onclick={onCheck}
    >
      {#if done}<Icon name={canceled ? 'x' : 'check'} size={12} color="#fff" />{/if}
    </button>

    <div
      class="body"
      role="button"
      tabindex="0"
      aria-label={`Open ${todo.title || 'New To-Do'}`}
      onclick={onRowClick}
      onkeydown={onKey}
    >
      <span class="line">
        {#if starred}<Icon name="star" size={13} color="var(--c-today)" />{/if}
        <span class="title" class:placeholder={!todo.title}>{todo.title || 'New To-Do'}</span>
        {#if todo.notes}<Icon name="note" size={11} color="var(--text-3)" label="Has notes" />{/if}
        {#if checklist.total}
          <span class="progress" title="Checklist">
            <Icon name="checklist" size={11} />{checklist.done}/{checklist.total}
          </span>
        {/if}
        {#each tags as name, i (i)}<span class="tag-pill">{name}</span>{/each}
      </span>
      {#if containerLabel || futureDate}
        <span class="meta">
          {#if futureDate}<span class="when">{formatRelative(futureDate, ref)}</span>{/if}
          {containerLabel}
        </span>
      {/if}
    </div>

    <div class="aside">
      {#if context}
        <span class="context"><Icon name="context" size={12} />{context}</span>
      {/if}
      {#if todo.deadline}
        <span class="deadline" class:due>
          <Icon name="flag" size={12} />{deadlineLabel(todo.deadline, ref)}
        </span>
      {/if}
      {#if todo.priority && showPriority}
        <span class="prio prio-{todo.priority}">{priorityLabel(todo.priority, $settings)}</span>
      {/if}
      {#if mode === 'trash'}
        <button type="button" class="btn-plain" onclick={() => repo.setTodoTrashed(todo.id, false)}>Restore</button>
      {/if}
    </div>
  </li>
{/if}

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: var(--row-h);
    padding: 4px 8px;
    border-radius: var(--radius);
    list-style: none;
  }
  .row.selected {
    background: #e6effc;
  }
  .card-slot {
    list-style: none;
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
    transition: background 0.15s;
  }
  .check.checked {
    background: var(--accent);
    border-color: var(--accent);
  }
  .check.canceled {
    background: var(--text-done);
    border-color: var(--text-done);
  }
  .body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
    cursor: default;
    outline-offset: 0;
  }
  /* Title, then its indicators; only the title shrinks when space is short. */
  .line {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .title {
    font-size: 15px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .line > :global(svg),
  .line > .progress,
  .line > .tag-pill {
    flex: none;
  }
  .placeholder {
    color: var(--text-3);
  }
  .done .title {
    color: var(--text-done);
    text-decoration: line-through;
  }
  .meta {
    font-size: 12px;
    color: var(--text-3);
    display: flex;
    gap: 6px;
  }
  .when {
    color: var(--text-2);
    font-weight: 600;
  }
  .aside {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
  }
  .tag-pill {
    font-size: 11px;
    padding: 2px 7px;
  }
  .progress {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    font-size: 11px;
    color: var(--text-3);
  }
  .deadline {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: var(--text-3);
  }
  .context {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: var(--text-2);
  }
  .deadline.due {
    color: var(--danger);
    font-weight: 600;
  }
  @media (max-width: 480px) {
    .tag-pill {
      display: none;
    }
  }
  @media (pointer: coarse) {
    .row {
      min-height: 48px;
    }
    .check {
      width: 20px;
      height: 20px;
    }
    .title {
      font-size: 17px;
    }
  }
</style>
