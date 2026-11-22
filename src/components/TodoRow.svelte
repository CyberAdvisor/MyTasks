<!--
  One to-do row (design doc, Section 6, Components: Row): the title, then the note and checklist icons and the tags (on
  phones a tag icon instead); the project or area
  underneath; the context, deadline and priority on the right.
  Shows the expanded card in place when this to-do is open. Open rows can be
  selected with the arrow keys and dragged within their list (FR-10.3).
  Right-click or Control-click opens the to-do menu (FR-1.7, RowMenu).
  In Select mode on touch (FR-10.2) a tap anywhere on the row, checkbox
  included, selects or deselects it, shown by the checkbox itself (blue, with
  a tick), and the row can't be dragged.
  On phones (under 768 px; Milestone 11, PR 2) the row is compact:
  every row 48 px, one line or two; after the title only
  icons (priority in its colour, repeat, notes, checklist, tags, context);
  the deadline alone on the right, short ("2d left"). iPad and Mac keep the
  context name and priority chip: aligned, not identical.
  A repeating task's template (FR-4.3) shows its next date, or Paused, then a
  blue repeat icon; checking it off completes its next copy early, and it
  stays open (FR-4.4). A copy shows a grey repeat icon after its title.
-->
<script lang="ts">
  import Icon from './Icon.svelte';
  import TodoCard from './TodoCard.svelte';
  import { ui } from '../lib/state/ui.svelte';
  import { settings, snapshot, todoById } from '../lib/state/live';
  import { deadlineLabel } from '../lib/model/dates';
  import { whenMark, type BuiltInList } from '../lib/model/lists';
  import { priorityLabel } from '../lib/model/settings';
  import { checklistProgress, tagTitles } from '../lib/model/tags';
  import { contextTitle } from '../lib/model/contexts';
  import { placeLabel, projectOrder, rowSubtitle, sequentialRule } from '../lib/model/sequential';
  import * as repo from '../lib/db/repo';
  import { dragItem } from '../lib/drag/drag';
  import { swipeRow, type SwipeAction } from '../lib/swipe';
  import { rowIds } from '../lib/commands';
  import { rangeTo, single, toggle } from '../lib/model/selection';
  import type { LocalDate, Todo } from '../lib/model/types';

  let {
    todo: listed,
    ref,
    containerLabel = '',
    list = null,
    mode = 'open',
    showPriority = true,
    showContext = true,
  }: {
    todo: Todo;
    /** Today's date, for deadline and date labels. */
    ref: LocalDate;
    /** Project or area name to show under the title. */
    containerLabel?: string;
    /** The built-in list showing the row, for its When mark; null elsewhere. */
    list?: BuiltInList | null;
    /** `open` lists, `logbook` (checked rows) or `trash` (Put Back button). */
    mode?: 'open' | 'logbook' | 'trash';
    /** Show the priority chip (hidden when Today is grouped by priority, FR-14.4). */
    showPriority?: boolean;
    /** Show the context (hidden when Today is grouped by context, FR-18.7). */
    showContext?: boolean;
  } = $props();

  /** The task as saved: a held task (src/lib/model/hold.ts) is listed where it was but shows its new values. */
  let todo = $derived($todoById.get(listed.id) ?? listed);

  let item = $state<HTMLLIElement>();

  // Bring the row into view when Quick Find opens it.
  $effect(() => {
    if (ui.scrollId !== todo.id || !item) return;
    item.scrollIntoView({ block: 'center' });
    ui.scrollId = null;
  });

  let pending = $derived(ui.pending[todo.id]);
  // Done: in Completed, checked off, or completed and waiting to move (FR-12.2).
  let done = $derived(mode === 'logbook' || pending !== undefined || todo.status !== 'open');
  let canceled = $derived(todo.status === 'canceled' || pending === 'canceled');
  let due = $derived(todo.deadline !== null && todo.deadline <= ref);
  // Star, grey date label or dashed checkbox (whenMark).
  let mark = $derived(whenMark(todo, ref, list));
  let tags = $derived(tagTitles(todo.tagIds, $snapshot));
  let checklist = $derived(checklistProgress(todo.id, $snapshot));
  let context = $derived(showContext ? contextTitle(todo.contextId, $snapshot) : '');
  /** In a sequential project, the task's place: "task 2 of 5" (FR-17.5). */
  let place = $derived.by(() => {
    if (!todo.projectId || mode !== 'open') return '';
    const project = $snapshot.projects.find((p) => p.id === todo.projectId);
    if (!project || !sequentialRule(project, $settings.sequentialTags)) return '';
    return placeLabel(todo, projectOrder(project.id, $snapshot.todos, $snapshot.headings));
  });
  let subtitle = $derived(rowSubtitle(containerLabel, place, list));
  /** In Select mode (FR-10.2): a tap selects or deselects the row. */
  let selecting = $derived(ui.selecting && mode === 'open');
  /** In Select mode, whether this row is selected: its checkbox shows it. */
  let picked = $derived(selecting && ui.isSelected(todo.id));
  /** The priority's name, for the phone icon's label ("To Do", "P3"). */
  let prioName = $derived(todo.priority && showPriority ? priorityLabel(todo.priority, $settings) : '');

  /** A repeating task's template (FR-4.1): its copies get done, not it. */
  let template = $derived(todo.repeat !== null);

  /** Checkbox: complete (Alt-click cancels), or reopen a completed to-do. */
  function onCheck(e: MouseEvent) {
    if (mode === 'trash') return;
    if (selecting) return void (ui.selection = toggle(ui.selection, todo.id));
    ui.check(todo, e.altKey ? 'canceled' : 'completed');
  }

  /**
   * Touch opens straight away; a pointer selects, double-click opens. With a
   * pointer, Cmd/Ctrl-click adds or removes the row and Shift-click selects
   * the rows from the last one chosen (FR-10.1). In the Trash a tap on touch
   * opens the task menu (Put Back, Delete Immediately…), since touch has no
   * right-click (FR-1.7). In Select mode a tap selects or deselects (FR-10.2).
   */
  function onRowClick(e: MouseEvent) {
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    if (mode === 'trash' && coarse) {
      ui.rowMenu = { id: todo.id, mode, x: e.clientX, y: e.clientY };
      return;
    }
    if (mode !== 'open') return;
    if (selecting) ui.selection = toggle(ui.selection, todo.id);
    else if (!coarse && (e.metaKey || e.ctrlKey)) ui.selection = toggle(ui.selection, todo.id);
    else if (!coarse && e.shiftKey) ui.selection = rangeTo(ui.selection, rowIds(), todo.id);
    else if (coarse || e.detail >= 2) ui.open(todo.id);
    else ui.selectedId = todo.id;
  }

  /**
   * Open the to-do menu at the pointer (FR-1.7). A touch long press drags
   * instead (FR-10.3). Opened from the keyboard, it sits under the row.
   */
  function onContextMenu(e: MouseEvent) {
    if ((e as PointerEvent).pointerType === 'touch') return;
    e.preventDefault();
    // A row outside the selection is selected alone; one inside keeps the selection, for a menu acting on all of it.
    if (mode === 'open' && !ui.isSelected(todo.id)) ui.selectedId = todo.id;
    const fromKeyboard = e.clientX === 0 && e.clientY === 0;
    const r = item!.getBoundingClientRect();
    ui.rowMenu = {
      id: todo.id,
      mode,
      x: fromKeyboard ? r.left + 40 : e.clientX,
      y: fromKeyboard ? r.bottom - 4 : e.clientY,
      keyboard: fromKeyboard,
    };
  }

  /**
   * Swipe actions on touch (FR-10.4): left to right
   * opens the Start Date picker for this task (a sheet on phones), right to
   * left starts Select mode with it selected (FR-10.2).
   */
  function onSwipe(action: SwipeAction) {
    if (action === 'select') {
      ui.startSelecting();
      ui.selection = single(todo.id);
      return;
    }
    ui.selectedId = todo.id;
    const r = item!.getBoundingClientRect();
    ui.rowMenu = { id: todo.id, mode: 'open', x: r.left + 40, y: r.bottom - 4, panel: 'when' };
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
    class:selected={ui.isSelected(todo.id)}
    class:done
    data-row-id={mode === 'open' ? todo.id : undefined}
    use:dragItem={mode === 'open' && !selecting ? { type: 'todo', id: todo.id } : null}
    use:swipeRow={mode === 'open' && !selecting ? onSwipe : null}
    oncontextmenu={onContextMenu}
  >
    <button
      type="button"
      data-no-drag
      class="check"
      class:checked={selecting ? picked : done}
      class:canceled={!selecting && canceled}
      class:deferred={mark?.kind === 'deferred'}
      role="checkbox"
      aria-checked={selecting ? picked : done}
      aria-label={selecting
        ? `Select: ${todo.title || 'New Task'}`
        : `${done ? 'Mark not done' : 'Complete'}: ${todo.title || 'New Task'}`}
      disabled={mode === 'trash'}
      onclick={onCheck}
    >
      {#if selecting ? picked : done}<Icon name={!selecting && canceled ? 'x' : 'check'} size={12} color="#fff" />{/if}
    </button>

    <div
      class="body"
      role="button"
      tabindex="0"
      aria-label={`${selecting ? 'Select' : 'Open'} ${todo.title || 'New Task'}`}
      aria-pressed={selecting ? ui.isSelected(todo.id) : undefined}
      onclick={onRowClick}
      onmousedown={(e) => e.shiftKey && mode === 'open' && e.preventDefault()}
      onkeydown={onKey}
    >
      <span class="line">
        {#if mark?.kind === 'today'}<Icon name="star" size={13} color="var(--c-today)" filled label="Today" />{/if}
        {#if mark?.kind === 'scheduled'}<span class="when">{mark.label}</span>{/if}
        {#if mark?.kind === 'paused'}<span class="when">Paused</span>{/if}
        {#if template}<Icon name="repeat" size={13} color="var(--accent)" label="Repeating task" />{/if}
        <span class="title" class:placeholder={!todo.title}>{todo.title || 'New Task'}</span>
        {#if prioName}<span class="phone prio-icon" style:color="var(--p{todo.priority})"><Icon name="priority-circle" size={14} label={`Priority: ${prioName}`} /></span>{/if}
        {#if todo.repeatOf}<Icon name="repeat" size={11} color="var(--text-3)" label="Copy of a repeating task" />{/if}
        {#if todo.notes}<Icon name="note" size={11} color="var(--text-3)" label="Has notes" />{/if}
        {#if checklist.total}
          <span class="progress" title="Checklist">
            <Icon name="checklist" size={11} /><span class="count">{checklist.done}/{checklist.total}</span>
          </span>
        {/if}
        {#each tags as name, i (i)}<span class="tag-pill">{name}</span>{/each}
        {#if tags.length}<span class="tag-icon"><Icon name="tag" size={11} color="var(--text-3)" label="Has tags" /></span>{/if}
        {#if context}<span class="phone"><Icon name="context" size={13} color="var(--text-3)" label={`Context: ${context}`} /></span>{/if}
      </span>
      {#if subtitle}<span class="meta">{subtitle}</span>{/if}
    </div>

    <div class="aside">
      {#if context}
        <span class="context"><Icon name="context" size={12} />{context}</span>
      {/if}
      {#if todo.deadline}
        <span class="deadline" class:due>
          <Icon name="flag" size={12} /><span class="wide">{deadlineLabel(todo.deadline, ref)}</span><span class="phone">{deadlineLabel(todo.deadline, ref, true)}</span>
        </span>
      {/if}
      {#if todo.priority && showPriority}
        <span class="prio prio-{todo.priority}">{priorityLabel(todo.priority, $settings)}</span>
      {/if}
      {#if mode === 'trash'}
        <button type="button" class="btn-plain" onclick={() => repo.setTodoTrashed(todo.id, false)}>Put Back</button>
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
    background: var(--selected-row);
  }
  /* Swipe actions (FR-10.4): touch rows pan only up and down for the
     browser, so a sideways move reaches lib/swipe.ts; while a row slides,
     its action's colour and label show in the gap. */
  @media (pointer: coarse) {
    .row {
      touch-action: pan-y;
    }
  }
  .row:global(.swiping) {
    position: relative;
    overflow: hidden;
  }
  .row:global(.swiping)::before {
    content: attr(data-swipe-label);
    position: absolute;
    top: 0;
    bottom: 0;
    width: var(--swipe-gap, 0);
    overflow: hidden;
    white-space: nowrap;
    display: flex;
    align-items: center;
    padding: 0 16px;
    font-size: 13px;
    font-weight: 600;
    color: #fff;
    opacity: 0.55;
    transition: opacity 0.1s;
  }
  .row:global(.swipe-ready)::before {
    opacity: 1;
  }
  .row:global([data-swipe='when'])::before {
    left: 0;
    background: var(--c-scheduled);
  }
  .row:global([data-swipe='select'])::before {
    right: 0;
    background: var(--accent);
    justify-content: flex-end;
  }
  /* Selected rows next to each other form one band (FR-10.1). */
  .row.selected:has(+ :global(.row.selected)) {
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
  }
  :global(.row.selected) + .row.selected {
    border-top-left-radius: 0;
    border-top-right-radius: 0;
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
    background: var(--field);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s;
  }
  .check.checked {
    background: var(--accent);
    border-color: var(--accent);
  }
  /* Deferred tasks have a dashed checkbox. */
  .check.deferred {
    border-style: dashed;
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
  /* Sizes with a mouse, close to Things on the Mac; touch screens set their own below. */
  .title {
    font-size: 16px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .line > :global(svg),
  .line > .progress,
  .line > .tag-pill,
  .line > .tag-icon {
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
    font-size: 13px;
    color: var(--text-3);
    display: flex;
    gap: 6px;
  }
  /* The grey date label before a scheduled task's title. */
  .when {
    flex: none;
    font-size: 13px;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 4px;
    background: var(--when-bg);
    color: var(--text-2);
    white-space: nowrap;
  }
  .aside {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
  }
  .tag-pill {
    font-size: 12px;
    padding: 2px 7px;
  }
  .progress {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    font-size: 12px;
    color: var(--text-3);
  }
  .deadline {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 13px;
    color: var(--text-3);
  }
  .context {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 13px;
    color: var(--text-2);
  }
  .deadline.due {
    color: var(--danger);
    font-weight: 600;
  }
  /* Touch: 44 px rows, the minimum for a comfortable tap (Section 6, Row; 48 px before 1.1.18). */
  @media (pointer: coarse) {
    .row {
      min-height: 44px;
    }
    .check {
      width: 20px;
      height: 20px;
    }
    .title {
      font-size: 17px;
    }
  }
  /* Shown only on phones (below), or only on wider screens. */
  .phone,
  .tag-icon {
    display: none;
  }
  .wide {
    display: inline;
  }
  /*
   * Phones (Milestone 11, PR 2): compact rows. Every
   * row is 48 px with or without a second line; after the title only icons,
   * a tag icon in place of the tag names (since 1.2.11), the priority in its
   * colour and the context as a pin, each named for VoiceOver; the deadline
   * alone on the right, short; a checklist without its count.
   */
  @media (max-width: 767px) {
    .row {
      height: 48px;
      min-height: 48px;
      gap: 10px;
      padding: 0 6px;
    }
    .check {
      width: 18px;
      height: 18px;
      border-radius: 5px;
    }
    .title {
      line-height: 21px;
    }
    .meta {
      font-size: 15px;
      line-height: 18px;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      display: block;
    }
    .body {
      gap: 0;
    }
    .phone,
    .tag-icon {
      display: inline-flex;
      flex: none;
    }
    .wide,
    .tag-pill,
    .progress .count,
    .aside .context,
    .aside .prio {
      display: none;
    }
    .deadline {
      font-size: 15px;
      line-height: 21px;
    }
    /* With a second line, the deadline sits on the title's line. */
    .row:has(.meta) .aside {
      align-self: flex-start;
      margin-top: 4.5px;
    }
  }
</style>
