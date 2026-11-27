<!--
  Expanded to-do card (FR-1.2): title, notes, checklist, then the fields
  (tags, When, deadline, reminder, priority and context) in the bar shared
  with Quick Entry (FieldBar), with Move and ⋯ at its end.
  Below the card, a blue link names the to-do's project or
  area, with Go to Project and Change Project (the Move dialog).
  Edits save as you type, debounced 300 ms; there is no Save button.
  Escape, Return in the title or on a field's button, or a click outside
  closes it. With Settings › Task Titles on, the words just typed in the
  title that it will read are highlighted, with what they set underneath
  (FR-1.12).
  A repeating task's template (FR-4.3, FR-4.4) shows its rule and next dates
  in place of its start date and deadline, which its copies carry; a click
  edits the rule. A copy says so, with Show Repeating Task.
-->
<script lang="ts">
  import { TOUCH_QUERY, isPhoneWidth } from '../lib/breakpoints';
  import { onDestroy, untrack } from 'svelte';
  import { onHide } from '../lib/state/onHide';
  import Icon from './Icon.svelte';
  import { cycleTab } from '../lib/focusCycle';
  import NotesField from './NotesField.svelte';
  import Popover from './Popover.svelte';
  import FieldBar from './FieldBar.svelte';
  import Checklist from './Checklist.svelte';
  import { ui } from '../lib/state/ui.svelte';
  import ProgressPie from './ProgressPie.svelte';
  import { route } from '../lib/state/route';
  import { changeDeadline, changeReminder, changeWhen, containerLink, goToContainer, revealTodo } from '../lib/actions';
  import { ruleText, upcoming } from '../lib/model/repeat';
  import { projectProgress } from '../lib/model/lists';
  import { snapshot, todayDate, todoById } from '../lib/state/live';
  import { formatRelative } from '../lib/model/dates';
  import { remindersOn } from '../lib/calendar/calendar';
  import { checklistFor } from '../lib/model/tags';
  import { storedChecklist } from '../lib/state/checklist.svelte';
  import * as repo from '../lib/db/repo';
  import TitleHighlights from './TitleHighlights.svelte';
  import TitleHint from './TitleHint.svelte';
  import { applyTaskTitle, messageFor, previewTaskTitle, readTaskTitle, readTitles } from '../lib/titleEntry';
  import { shiftKept, type TitleSpan } from '../lib/model/titleWords';
  import type { ID, LocalDate, Todo } from '../lib/model/types';

  let { todo: listed, ref }: { todo: Todo; ref: LocalDate } = $props();
  /** The task as saved, so its chips change at once while the lists hold it in place. */
  let todo = $derived($todoById.get(listed.id) ?? listed);

  const SAVE_DELAY_MS = 300;

  // Local copies so typing is never interrupted by live-query refreshes.
  // svelte-ignore state_referenced_locally
  let title = $state(todo.title);
  // svelte-ignore state_referenced_locally
  let notes = $state(todo.notes);
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  /** The title as last read (FR-1.12): only words typed since are read. */
  // svelte-ignore state_referenced_locally
  let titleBase = $state(todo.title);
  /** Parts of the title kept as text with a click (FR-1.12). */
  let kept = $state<TitleSpan[]>([]);
  /** Text typed in this card and not saved yet: only that is saved, never a copy another card or a reading has replaced. */
  let titleTyped = false;
  let notesTyped = false;
  /** The card and the project link under it; clicks inside keep the card open. */
  let card: HTMLDivElement;

  // Tab moves through every control, in Safari too, and stays inside.
  $effect(() => {
    const onTab = (e: KeyboardEvent) => cycleTab(e, card);
    card.addEventListener('keydown', onTab);
    return () => card.removeEventListener('keydown', onTab);
  });
  let titleInput = $state<HTMLTextAreaElement>(null!);

  /** What the words typed since the title was last read will set, for the highlights. */
  let reading = $derived($readTitles ? previewTaskTitle(todo, titleBase, title, kept) : null);

  // Kept words move with the text typed before them.
  // svelte-ignore state_referenced_locally
  let lastTitle = title;
  $effect(() => {
    const now = title;
    if (now === lastTitle) return;
    if (untrack(() => kept.length)) kept = shiftKept(untrack(() => kept), lastTitle, now);
    lastTitle = now;
  });

  /** A highlighted word clicked: keep it as text, or read a kept one again. */
  function toggleKept(span: TitleSpan, keep: boolean) {
    kept = keep ? [...kept, span] : kept.filter((k) => k.from !== span.from);
  }

  // Which popover is open.
  let whenOpen = $state(false);
  let deadlineOpen = $state(false);
  let reminderOpen = $state(false);
  let tagsOpen = $state(false);
  /** Checklist item to focus once it renders. */
  let checklistFocus = $state<ID | null>(null);

  /** A repeating task's template (FR-4.1): no start date or deadline of its own to set. */
  let template = $derived(todo.repeat !== null);
  /** A template's task (a repeating task, or one in a repeating project's template) reminds by time only (FR-3.8). */
  let reminderByTime = $derived(template || (!!todo.projectId && !!$snapshot.projects.find((p) => p.id === todo.projectId)?.repeat));
  /** The template a copy came from, while it still repeats (FR-4.4). */
  let source = $derived.by(() => {
    const t = todo.repeatOf ? $todoById.get(todo.repeatOf) : undefined;
    return t?.repeat && !t.trashedAt ? t : null;
  });

  /**
   * The template's repeat line: Edit Rule…, or on a phone the Repeat menu
   * (FR-4.4).
   */
  function openRepeat(e: MouseEvent) {
    if (isPhoneWidth() && window.matchMedia(TOUCH_QUERY).matches) {
      ui.rowMenu = { id: todo.id, mode: 'open', x: e.clientX, y: e.clientY, submenu: 'repeat' };
    } else ui.repeating = { kind: 'todo', id: todo.id };
  }
  // The link under the card to the to-do's project or area (FR-1.2).
  let link = $derived(containerLink(todo, $route));
  let linkName = $derived(
    !link
      ? ''
      : link.kind === 'project'
        ? $snapshot.projects.find((p) => p.id === link!.id)?.title || 'New Project'
        : $snapshot.areas.find((a) => a.id === link!.id)?.title || 'New Area',
  );
  let noun = $derived(link?.kind === 'area' ? 'Area' : 'Project');
  let linkOpen = $state(false);
  let checklistItems = $derived(checklistFor(todo.id, $snapshot));
  let checklistOps = $derived(storedChecklist(todo.id));

  /** Persist pending text edits now. */
  function flush() {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    const changes = { ...(titleTyped && title !== todo.title ? { title } : {}), ...(notesTyped && notes !== todo.notes ? { notes } : {}) };
    titleTyped = notesTyped = false;
    if (Object.keys(changes).length) void repo.updateTodoText(todo.id, changes);
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, SAVE_DELAY_MS);
  }

  function close() {
    readTitleWords();
    flush();
    ui.close();
  }

  /**
   * Read the dates and details typed in the title since it was last read
   * (FR-1.12): on Return, on leaving the title and when the card closes
   * (not on teardown, whose copy of the title can be stale).
   * The task's title loses the words read, and its fields are set.
   */
  function readTitleWords() {
    const typed = title;
    const base = titleBase;
    const task = todo;
    if (typed === base) return;
    const r = readTaskTitle(task, base, typed, kept);
    titleBase = r ? r.title : typed;
    kept = [];
    if (!r) return;
    // The shorter title is saved with the fields, not by the next flush.
    clearTimeout(saveTimer);
    saveTimer = undefined;
    titleTyped = false;
    title = r.title;
    if (titleInput) {
      titleInput.value = r.title;
      fitTitle();
    }
    void applyTaskTitle(task.id, r).then(() => ui.noteTitleRead(task.id, messageFor(r)));
  }

  // Focus the title of a new (empty) to-do so the user can type at once, and
  // put in any keys typed since New To-Do (FR-1.1). Once, when the card
  // opens: a later save (a start date chosen before the title is saved)
  // mustn't pull focus back to the title.
  $effect(() => {
    if (untrack(() => todo.title)) return;
    titleInput.focus();
    const typed = ui.takeTypeAhead();
    if (!typed) return;
    title = titleInput.value = typed;
    fitTitle();
    titleTyped = true;
    scheduleSave();
  });

  // Show the picker a keyboard command asked for (Section 7).
  $effect(() => {
    const command = ui.cardCommand;
    if (!command || ui.expandedId !== todo.id) return;
    ui.cardCommand = null;
    if (command === 'when') whenOpen = true;
    else if (command === 'deadline') deadlineOpen = true;
    else if (command === 'reminder') reminderOpen = true;
    else if (command === 'tags') tagsOpen = true;
    else void addChecklist();
  });

  // Close on a click outside the card, unless it lands in a dialog or the task menu.
  $effect(() => {
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (card.contains(target)) return;
      // The task menu opened from the card's ⋯, and its sheet's backdrop on phones.
      if ((target as Element).closest?.('dialog, .rowmenu, .rowmenu-backdrop')) return;
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
  // Leaving the app saves the typed title and notes at once (review C7).
  $effect(() => onHide(flush));

  /** Make the title box as tall as its wrapped lines. */
  function fitTitle() {
    if (!titleInput) return;
    titleInput.style.height = 'auto';
    titleInput.style.height = `${titleInput.scrollHeight}px`;
  }

  // Fit once the card is laid out, and whenever its width changes (rotation, a resized window).
  $effect(() => {
    fitTitle();
    const watch = new ResizeObserver(fitTitle);
    watch.observe(titleInput);
    return () => watch.disconnect();
  });

  function onTitleKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      close();
    }
  }

  async function addChecklist() {
    [checklistFocus] = await checklistOps.add([''], null);
  }

  /**
   * The ⋯ opens the full task menu (FR-1.7), the same as right-click, lined up
   * under the button; on phones it is a sheet. Pending text is saved first,
   * so Duplicate and Convert to Project copy what was typed.
   */
  function openMenu(e: MouseEvent) {
    flush();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    ui.rowMenu = { id: todo.id, mode: 'open', x: r.right, y: r.bottom + 4, alignEnd: true };
  }
</script>

<div bind:this={card}>
<div class="card" role="group" aria-label="Edit task">
  <div class="top">
    <button
      type="button"
      class="check"
      role="checkbox"
      aria-checked={ui.pending[todo.id] !== undefined || todo.status !== 'open'}
      aria-label="Complete"
      onclick={(e) => ui.check(todo, e.altKey ? 'canceled' : 'completed')}
    >
      {#if ui.pending[todo.id] || todo.status !== 'open'}
        <Icon name={ui.pending[todo.id] === 'canceled' || todo.status === 'canceled' ? 'x' : 'check'} size={12} color="#fff" />
      {/if}
    </button>
    <label class="visually-hidden" for="title-{todo.id}">Title</label>
    <!-- A text box so a long title wraps (on phones especially); Return still closes the card, and a pasted line break becomes a space. -->
    <textarea
      id="title-{todo.id}"
      class="title"
      rows="1"
      bind:this={titleInput}
      bind:value={title}
      oninput={() => {
        if (/[\r\n]/.test(title)) title = title.replace(/\s*[\r\n]+\s*/g, ' ');
        fitTitle();
        titleTyped = true;
        scheduleSave();
      }}
      onkeydown={onTitleKey}
      onblur={readTitleWords}
      placeholder="New Task"
      autocomplete="off"
    ></textarea>
    {#if reading}
      <TitleHighlights field={titleInput} value={title} words={reading.words} {kept} ontoggle={toggleKept} />
    {/if}
  </div>
  <TitleHint {reading} />

  <div class="notes-wrap">
    <NotesField
      id="notes-{todo.id}"
      label="Notes"
      bind:value={notes}
      oninput={() => {
        notesTyped = true;
        scheduleSave();
      }}
    />
  </div>

  <Checklist items={checklistItems} ops={checklistOps} bind:focusId={checklistFocus} />

  <FieldBar
    fields={{
      startDate: todo.startDate,
      deferred: todo.start === 'deferred',
      deadline: todo.deadline,
      reminder: todo.reminder,
      priority: todo.priority,
      contextId: todo.contextId,
      tagIds: todo.tagIds,
      hasChecklist: checklistItems.length > 0,
    }}
    {ref}
    {template}
    {reminderByTime}
    reminderField={$remindersOn}
    onwhen={(choice) => void changeWhen([todo.id], choice)}
    ondeadline={(deadline, moveWhen) => void changeDeadline([todo.id], deadline, moveWhen)}
    onreminder={(reminder) => void changeReminder([todo.id], reminder)}
    onpriority={(p) => void repo.setPriority(todo.id, p)}
    oncontext={(contextId) => void repo.setContext(todo.id, contextId)}
    ontoggletag={(tagId, on) => repo.toggleTag('todos', todo.id, tagId, on)}
    onchecklist={addChecklist}
    onfinish={close}
    bind:whenOpen
    bind:deadlineOpen
    bind:reminderOpen
    bind:tagsOpen
  >
    {#snippet between()}
      {#if todo.repeat}
        {@const dates = upcoming(todo.repeat, todo.startDate, 4)}
        <button type="button" class="repeat" onclick={openRepeat} aria-label="Edit repeat rule">
          <Icon name="repeat" size={14} color="var(--accent)" />
          <span>
            <span class="repeat-rule">{ruleText(todo.repeat)}{todo.repeat.paused ? ' (paused)' : ''}</span>
            {#if dates.length && !todo.repeat.paused}
              <span class="repeat-dates">{(todo.repeat.mode === 'fixed' ? dates : dates.slice(0, 1)).map((d) => formatRelative(d, ref)).join(', ')}{todo.repeat.mode === 'fixed' ? ', …' : ''}</span>
            {/if}
          </span>
        </button>
      {:else if source}
        <div class="repeat copy">
          <Icon name="repeat" size={14} color="var(--text-3)" />
          <span>
            <span class="repeat-rule">This is a copy of a repeating task</span>
            <span class="repeat-dates">{ruleText(source.repeat!)}</span>
          </span>
          <button type="button" class="btn-plain show" onclick={() => { flush(); revealTodo(source!, $route, $todayDate); }}>Show Repeating Task</button>
        </div>
      {/if}
    {/snippet}
    {#snippet trailing()}
      <button type="button" class="icon-btn" aria-label="Move" title="Move" onclick={() => (ui.movingIds = [todo.id])}>
        <Icon name="move" size={16} />
      </button>

      <button
        type="button"
        class="icon-btn"
        aria-label="More actions"
        title="More"
        aria-haspopup="menu"
        aria-expanded={ui.rowMenu?.id === todo.id}
        onclick={openMenu}
      >
        <Icon name="more" size={16} />
      </button>
    {/snippet}
  </FieldBar>
</div>

{#if link}
  <div class="where">
    <Popover bind:open={linkOpen} label="{noun} actions">
      {#snippet trigger(toggle, open)}
        <button type="button" class="where-btn" aria-label="{noun}: {linkName}" aria-expanded={open} onclick={toggle}>
          {#if link!.kind === 'project'}
            <ProgressPie fraction={projectProgress($snapshot, link!.id)} size={14} />
          {:else}
            <Icon name="area" size={14} />
          {/if}
          {linkName}
          <Icon name="chevron-right" size={13} />
        </button>
      {/snippet}
      <div role="menu" aria-label="{noun} actions">
        <button type="button" class="menu-item" role="menuitem" onclick={() => { linkOpen = false; flush(); goToContainer(todo, $route); }}>Go to {noun}</button>
        <button type="button" class="menu-item" role="menuitem" onclick={() => { linkOpen = false; ui.movingIds = [todo.id]; }}>Change {noun}</button>
      </div>
    </Popover>
  </div>
{/if}
</div>

<style>
  .where {
    display: flex;
    justify-content: flex-end;
    margin: -2px 6px 8px;
  }
  .where-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border: 0;
    background: transparent;
    padding: 3px 6px;
    border-radius: var(--radius);
    font-size: 13px;
    font-weight: 600;
    color: var(--accent-text);
  }
  .where-btn:hover,
  .where-btn[aria-expanded='true'] {
    background: var(--hover-bg);
  }
  .card {
    margin: 6px 0;
    padding: 12px 14px 10px;
    border-radius: 10px;
    background: var(--surface);
    border: 1px solid var(--surface-border);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06), 0 10px 28px rgba(0, 0, 0, 0.08);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .top {
    position: relative;
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
    background: var(--field);
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
    min-width: 0;
    border: 0;
    outline: none;
    font: inherit;
    font-size: 15px;
    font-weight: 600;
    line-height: 1.35;
    padding: 2px 0;
    margin: 0;
    background: transparent;
    resize: none;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  .notes-wrap {
    margin-left: 28px;
  }
  /* The repeat line (FR-4.3, FR-4.4): a template's rule and next dates, or a copy's note. */
  .repeat {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin-left: 28px;
    padding: 4px 0;
    border: 0;
    background: transparent;
    text-align: left;
    font-size: 13px;
    color: var(--text);
  }
  .repeat > span:first-of-type {
    display: flex;
    flex-direction: column;
    flex: 1 1 180px;
    min-width: 0;
  }
  .repeat-rule {
    font-weight: 600;
  }
  .repeat-dates {
    color: var(--text-3);
  }
  .repeat.copy {
    align-items: center;
    flex-wrap: wrap;
  }
  .show {
    color: var(--accent-text);
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
  /* With a mouse, the title matches the rows' 16 px; touch screens keep 15 px. */
  @media (pointer: fine) {
    .title {
      font-size: 16px;
    }
  }
</style>
