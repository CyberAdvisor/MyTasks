<!--
  Project page (FR-2.1 to FR-2.4): the ⋯ menu right
  after the title holds the project actions (complete, When, tags, deadline,
  move, duplicate, Sort by Date (FR-2.8), Move Completed Items (FR-12.2),
  delete). Values that are set show as chips under the title; clicking a
  chip reopens its picker. A heading's ⋯ menu has its own Sort by Date.
  Drag to-dos to reorder them, to move them under another heading, or above
  the first heading to take them out of any heading; drag headings to reorder
  them, their to-dos moving with them (FR-10.3, FR-10.6, FR-10.7).
-->
<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import NotesField from '../components/NotesField.svelte';
  import ProgressPie from '../components/ProgressPie.svelte';
  import TodoList from '../components/TodoList.svelte';
  import MoreRows from '../components/MoreRows.svelte';
  import EditableTitle from '../components/EditableTitle.svelte';
  import { onDestroy } from 'svelte';
  import { onHide } from '../lib/state/onHide';
  import ViewHeader from '../components/ViewHeader.svelte';
  import ChoiceDialog from '../components/ChoiceDialog.svelte';
  import Popover from '../components/Popover.svelte';
  import MenuItems from '../components/MenuItems.svelte';
  import { projectRepeatItems, sidebarMenuItems, type ProjectRepeatAction, type SidebarMenuAction } from '../lib/model/sidebarMenu';
  import { printPage } from '../lib/print';
  import SelectItem from '../components/SelectItem.svelte';
  import WhenPicker from '../components/WhenPicker.svelte';
  import DeadlinePicker from '../components/DeadlinePicker.svelte';
  import TagPicker from '../components/TagPicker.svelte';
  import AreaPickerDialog from '../components/AreaPickerDialog.svelte';
  import { deadlineLabel, formatRelative } from '../lib/model/dates';
  import { ruleText, upcoming } from '../lib/model/repeat';
  import TagBar from '../components/TagBar.svelte';
  import { deleteProject, duplicateProject, moveWaiting, newHeading, projectRepeatAction } from '../lib/actions';
  import { archiveHeadingDialog, completeProjectDialog } from '../lib/dialogs';
  import { activeTag, filterByTag, tagTitles, tagsInUse } from '../lib/model/tags';
  import { listSnapshot, todayDate } from '../lib/state/live';
  import { go } from '../lib/state/route';
  import { ui } from '../lib/state/ui.svelte';
  import { rowLimit, startsOf } from '../lib/state/rowLimit.svelte';
  import { bySortKey } from '../lib/model/order';
  import { isLogged, isOpen, openTaskCount, projectProgress, projectSections, repeatingTaskCount, waitingInView } from '../lib/model/lists';
  import * as repo from '../lib/db/repo';
  import { dragItem, dropZone, type DropZone } from '../lib/drag/drag';
  import type { ID, Todo } from '../lib/model/types';

  let { id }: { id: ID } = $props();

  let s = $derived($listSnapshot);
  let ref = $derived($todayDate);
  let project = $derived(s.projects.find((p) => p.id === id));
  /** A repeating project's copy: its template, while it still repeats (FR-4.6). */
  let source = $derived(project?.repeatOf ? s.projects.find((p) => p.id === project!.repeatOf && p.repeat && !p.deletedAt && !p.trashedAt) : undefined);
  let templateMenu = $state(false);

  /** Show Previous Copy and Create Next Copy, from the template's banner (FR-4.6). */
  function templateAction(action: 'show-previous' | 'create-next') {
    templateMenu = false;
    void projectRepeatAction(id, action);
  }

  // Project notes save as you type, 300 ms after the last key, like
  // everything else; and at once when the field is left, the page changes or
  // the app is hidden (review F9, C7: before, only leaving the field saved,
  // which switching apps on iPhone doesn't do).
  const NOTES_DELAY_MS = 300;
  // svelte-ignore state_referenced_locally
  let notes = $state(project?.notes ?? '');
  let notesFocused = false;
  let notesTimer: ReturnType<typeof setTimeout> | undefined;
  // Follow outside changes (another device, Undo) while not typing here.
  $effect(() => {
    const stored = project?.notes ?? '';
    if (!notesFocused && notesTimer === undefined) notes = stored;
  });
  function saveNotes() {
    clearTimeout(notesTimer);
    notesTimer = undefined;
    if (project && notes !== project.notes) void repo.updateProject(id, { notes });
  }
  onDestroy(saveNotes);
  $effect(() => onHide(saveNotes));
  let allSections = $derived(projectSections(s, id, ref));
  // Filter bar (FR-6.3, tags only since 1.3.5) over the project's listed to-dos.
  let listedTodos = $derived([...allSections.loose, ...allSections.headings.flatMap((h) => h.todos)]);
  let offered = $derived(tagsInUse(listedTodos, s));
  let tag = $derived(activeTag(ui.tagFilter, offered, s.tags));
  const narrow = (todos: Todo[]) => filterByTag(todos, tag, s);
  let sections = $derived({
    loose: narrow(allSections.loose),
    headings: allSections.headings.map((h) => ({ ...h, todos: narrow(h.todos) })),
  });
  // Moved to Completed, behind "Show N completed items"; completed to-dos
  // still waiting to move stay in their sections (FR-12.2).
  let closedTodos = $derived(bySortKey(s.todos.filter((t) => t.projectId === id && isLogged(t))));
  let openCount = $derived(openTaskCount(s, id));
  let repeatingCount = $derived(repeatingTaskCount(s, id));
  let showLogged = $state(false);

  // The row limit (NFR-7): loose tasks, each heading's (none while collapsed), then the completed ones when shown.
  let counts = $derived([
    sections.loose.length,
    ...sections.headings.map((h) => (h.heading.collapsed ? 0 : h.todos.length)),
    showLogged ? closedTodos.length : 0,
  ]);
  let starts = $derived(startsOf(counts));
  let rowTotal = $derived(counts.reduce((a, b) => a + b, 0));
  let askClose = $state(false);
  /** A heading with repeating tasks waiting for Archive to be confirmed (review C4). */
  let askArchive = $state<{ id: ID; repeating: number } | null>(null);
  let headingMenu = $state<ID | null>(null);
  let moving = $state(false);

  // The ⋯ menu shows either its item list or one of the pickers.
  let menuOpen = $state(false);
  let menuPanel = $state<'menu' | 'when' | 'tags' | 'deadline' | 'repeat'>('menu');
  $effect(() => {
    if (!menuOpen) menuPanel = 'menu';
  });

  // Chips under the title each open their own picker.
  let whenOpen = $state(false);
  let deadlineOpen = $state(false);
  let tagsOpen = $state(false);

  let hasWhen = $derived(!!project && (project.start === 'deferred' || project.startDate !== null));
  let whenText = $derived(
    !project
      ? ''
      : project.start === 'deferred'
        ? 'Deferred'
        : project.startDate === null
          ? ''
          : project.startDate <= ref
            ? 'Today'
            : formatRelative(project.startDate, ref),
  );
  let projectTags = $derived(project ? tagTitles(project.tagIds, s) : []);

  function complete() {
    menuOpen = false;
    if (openCount > 0 || repeatingCount > 0) askClose = true;
    else void repo.closeProject(id, 'completed', 'completed');
  }

  function onCloseChoice(v: string | null) {
    askClose = false;
    if (v === 'complete') void repo.closeProject(id, 'completed', 'completed');
    if (v === 'cancel') void repo.closeProject(id, 'completed', 'canceled');
  }

  /** To-dos move freely between this project's headings. */
  const todoZone = (headingId: ID | null): DropZone => ({
    type: 'todo',
    group: `project:${id}`,
    drop: (todoId, order) => repo.placeTodo(todoId, { order, headingId }),
  });
  const looseZone = todoZone(null);
  const headingZone: DropZone = { type: 'heading', drop: (hid, order) => repo.placeHeading(hid, order) };

  async function addTodo(headingId: ID | null = null) {
    // A collapsed heading opens, so the new task shows (FR-2.7).
    if (headingId && s.headings.find((h) => h.id === headingId)?.collapsed) await repo.setHeadingCollapsed(headingId, false);
    const todoId = await repo.createTodo({ projectId: id, headingId });
    ui.open(todoId);
  }

  function addHeading() {
    menuOpen = false;
    void newHeading(id);
  }

  function chooseWhen(choice: repo.WhenChoice) {
    menuOpen = whenOpen = false;
    void repo.setProjectWhen(id, choice);
  }

  function chooseDeadline(deadline: string | null, moveWhen: boolean) {
    menuOpen = deadlineOpen = false;
    void repo.setProjectDeadline(id, deadline, moveWhen);
  }

  function onMoveChoice(areaId: ID | null | undefined) {
    moving = false;
    if (areaId !== undefined) void repo.updateProject(id, { areaId });
  }

  async function headingAction(hid: ID, action: 'sort' | 'archive' | 'convert' | 'delete') {
    headingMenu = null;
    if (action === 'sort') {
      const h = s.headings.find((x) => x.id === hid);
      if (h) await repo.setHeadingSortByDate(hid, !h.sortByDate);
    } else if (action === 'archive') {
      const repeating = repeatingTaskCount(s, id, hid);
      if (repeating) askArchive = { id: hid, repeating };
      else await repo.archiveHeading(hid);
    } else if (action === 'delete') {
      await repo.deleteHeading(hid);
      ui.offerUndo('Heading deleted');
    } else {
      const pid = await repo.convertHeadingToProject(hid);
      if (pid) go({ kind: 'project', id: pid });
    }
  }

  // The ⋯ menu: the same items as the project's right-click menu (review C8, F4).
  let waiting = $derived(waitingInView(s, { kind: 'project', id }, ref));
  let menuItems = $derived(
    project
      ? sidebarMenuItems(
          { kind: 'project', id },
          {
            status: project.status,
            hasTags: project.tagIds.length > 0,
            hasDeadline: !!project.deadline,
            waiting: waiting.todos.length + waiting.projects.length > 0,
            sortByDate: project.sortByDate,
            template: !!project.repeat,
          },
        )
      : [],
  );

  function onMenu(action: SidebarMenuAction) {
    if (action === 'when' || action === 'tags' || action === 'deadline' || action === 'repeat-menu') {
      menuPanel = action === 'repeat-menu' ? 'repeat' : action;
      return;
    }
    menuOpen = false;
    switch (action) {
      case 'complete':
        return complete();
      case 'reopen':
        return void repo.reopenProject(id);
      case 'move':
        return void (moving = true);
      case 'duplicate':
        return void duplicateProject(id);
      case 'repeat':
        return void (ui.repeating = { kind: 'project', id });
      case 'sort-by-date':
        return void repo.setProjectSortByDate(id, !project!.sortByDate);
      case 'move-to-completed':
        return void moveWaiting(waiting);
      case 'print':
        return printPage();
      case 'edit-rule':
      case 'create-next':
      case 'show-previous':
      case 'pause':
      case 'resume':
      case 'stop':
        return void projectRepeatAction(id, action as ProjectRepeatAction);
      case 'delete':
        return void deleteProject(id);
    }
  }
</script>

{#if !project}
  <p class="missing">This project no longer exists.</p>
{:else}
  {#snippet whenPanel()}
    <WhenPicker startDate={project!.startDate} deferred={project!.start === 'deferred'} deadline={project!.deadline} {ref} onchoose={chooseWhen} />
  {/snippet}
  {#snippet deadlinePanel()}
    <DeadlinePicker deadline={project!.deadline} when={project!.startDate} noun="project" {ref} onchoose={chooseDeadline} />
  {/snippet}
  {#snippet tagsPanel()}
    <TagPicker
      tagIds={project!.tagIds}
      ontoggle={(tagId, on) => repo.toggleTag('projects', id, tagId, on)}
      ondone={() => (menuOpen = tagsOpen = false)}
    />
  {/snippet}

  {#if project.repeat}
    <!-- A repeating project's template (FR-4.6). -->
    <div class="template-banner" role="note">
      <span>You’re editing the <strong>template</strong> of a repeating project.</span>
      <Popover bind:open={templateMenu} label="Template actions">
        {#snippet trigger(toggle, open)}
          <button type="button" class="btn-plain small" aria-label="Template actions" aria-expanded={open} onclick={toggle}>
            <Icon name="more" size={14} />
          </button>
        {/snippet}
        <div role="menu" aria-label="Template actions">
          <button type="button" class="menu-item" role="menuitem" onclick={() => templateAction('show-previous')}><Icon name="search" size={15} /> Show Previous Copy</button>
          <button type="button" class="menu-item" role="menuitem" onclick={() => templateAction('create-next')}><Icon name="plus" size={15} /> Create Next Copy</button>
        </div>
      </Popover>
    </div>
  {/if}

  <ViewHeader>
    {#snippet icon()}<ProgressPie fraction={projectProgress(s, id)} size={26} />{/snippet}
    {#snippet heading()}
      <EditableTitle
        fit
        wrap
        value={project!.title}
        placeholder="New Project"
        label="Project title"
        autofocus={!project!.title}
        onsave={(v) => repo.updateProject(id, { title: v })}
      />
      <Popover bind:open={menuOpen} label="Project actions" align="left">
        {#snippet trigger(toggle, open)}
          <button type="button" class="more-btn" aria-label="More project actions" aria-expanded={open} onclick={toggle}>
            <Icon name="more" size={22} weight={3.5} />
          </button>
        {/snippet}
        {#if menuPanel === 'when'}
          {@render whenPanel()}
        {:else if menuPanel === 'deadline'}
          {@render deadlinePanel()}
        {:else if menuPanel === 'tags'}
          {@render tagsPanel()}
        {:else if menuPanel === 'repeat' && project!.repeat}
          <div role="menu" aria-label="Repeat">
            <MenuItems items={projectRepeatItems(project!.repeat.paused)} icons onchoose={onMenu} />
          </div>
        {:else}
          <div role="menu" aria-label="Project actions">
            <SelectItem onchoose={() => (menuOpen = false)} />
            <MenuItems items={menuItems} icons onchoose={onMenu} />
            {#if project!.status === 'open'}
              <!-- Desktop adds headings from the bottom toolbar. -->
              <button type="button" class="menu-item phone-only" role="menuitem" onclick={addHeading}><Icon name="heading-add" size={15} /> Add Heading</button>
            {/if}
          </div>
        {/if}
      </Popover>
    {/snippet}
  </ViewHeader>

  {#if project.status !== 'open' || hasWhen || project.deadline || projectTags.length}
    <div class="title-chips">
      {#if project.status !== 'open'}
        <span class="chip status"><Icon name="check" size={12} /> {project.status === 'completed' ? 'Completed' : 'Canceled'}</span>
      {/if}
      {#if hasWhen && project.repeat}
        <!-- A template's date is its next copy's: set by the rule, not the Start Date picker. -->
        <span class="chip"><Icon name="calendar" size={12} />{whenText}</span>
      {:else if hasWhen}
        <Popover bind:open={whenOpen} label="Start Date" align="left">
          {#snippet trigger(toggle)}
            <button type="button" class="chip" aria-label="Start Date: {whenText}" onclick={toggle}>
              <Icon name={project!.start === 'deferred' ? 'archive' : whenText === 'Today' ? 'star' : 'calendar'} size={12} />{whenText}
            </button>
          {/snippet}
          {@render whenPanel()}
        </Popover>
      {/if}
      {#if project.deadline}
        <Popover bind:open={deadlineOpen} label="Deadline" align="left">
          {#snippet trigger(toggle)}
            <button type="button" class="chip" class:due={project!.deadline! <= ref} onclick={toggle}>
              <Icon name="flag" size={12} />Deadline: {deadlineLabel(project!.deadline!, ref)}
            </button>
          {/snippet}
          {@render deadlinePanel()}
        </Popover>
      {/if}
      {#if projectTags.length}
        <Popover bind:open={tagsOpen} label="Tags" align="left">
          {#snippet trigger(toggle)}
            <button type="button" class="tags" aria-label="Edit tags" onclick={toggle}>
              {#each projectTags as name, i (i)}<span class="tag-pill">{name}</span>{/each}
            </button>
          {/snippet}
          {@render tagsPanel()}
        </Popover>
      {/if}
    </div>
  {/if}

  {#if project.repeat}
    {@const rule = project.repeat}
    {@const dates = upcoming(rule, project.startDate, 4)}
    <button type="button" class="repeat" onclick={() => (ui.repeating = { kind: 'project', id })} aria-label="Edit repeat rule">
      <Icon name="repeat" size={14} color="var(--accent)" />
      <span>
        <span class="repeat-rule">{ruleText(rule)}{rule.paused ? ' (paused)' : ''}</span>
        {#if dates.length && !rule.paused}
          <span class="repeat-dates">{(rule.mode === 'fixed' ? dates : dates.slice(0, 1)).map((d) => formatRelative(d, ref)).join(', ')}{rule.mode === 'fixed' ? ', …' : ''}</span>
        {/if}
      </span>
    </button>
  {:else if source}
    <div class="repeat copy">
      <Icon name="repeat" size={14} color="var(--text-3)" />
      <span>
        <span class="repeat-rule">This is a copy of a repeating project</span>
        <span class="repeat-dates">{ruleText(source.repeat!)}</span>
      </span>
      <button type="button" class="btn-plain show" onclick={() => go({ kind: 'project', id: source!.id })}>Show Repeating Project</button>
    </div>
  {/if}

  <div class="notes-wrap">
    <NotesField
      label="Project notes"
      bind:value={notes}
      oninput={() => {
        clearTimeout(notesTimer);
        notesTimer = setTimeout(saveNotes, NOTES_DELAY_MS);
      }}
      onfocus={() => (notesFocused = true)}
      onblur={() => {
        notesFocused = false;
        saveNotes();
      }}
    />
  </div>

  <TagBar tags={offered} />

  <TodoList todos={sections.loose} {ref} zone={looseZone} />

  <div use:dropZone={headingZone}>
    {#each sections.headings as { heading, todos }, i (heading.id)}
      <!-- A heading whose rows aren't drawn yet waits with them. -->
      {#if starts[i + 1] < rowLimit.limit}
        <section class="heading" use:dragItem={{ type: 'heading', id: heading.id }} use:dropZone={todoZone(heading.id)}>
          <div class="heading-row">
            <button
              type="button"
              class="btn-plain disclose"
              data-no-drag
              aria-label={heading.collapsed ? 'Expand heading' : 'Collapse heading'}
              aria-expanded={!heading.collapsed}
              onclick={() => repo.setHeadingCollapsed(heading.id, !heading.collapsed)}
            >
              <Icon name={heading.collapsed ? 'chevron-right' : 'chevron-down'} size={12} />
            </button>
            <EditableTitle
              value={heading.title}
              placeholder="New Heading"
              label="Heading title"
              size={15}
              autofocus={heading.id === ui.newHeadingId}
              onsave={(v) => repo.renameHeading(heading.id, v)}
            />
            {#if heading.collapsed}
              {@const hidden = todos.filter(isOpen).length}
              {#if hidden}<span class="hidden-count" title="Open tasks under this heading">{hidden}</span>{/if}
            {/if}
            <button type="button" class="btn-plain small" aria-label="Add task under heading" onclick={() => addTodo(heading.id)}>
              <Icon name="plus" size={14} />
            </button>
            <Popover bind:open={() => headingMenu === heading.id, (v) => (headingMenu = v ? heading.id : null)} label="Heading actions">
              {#snippet trigger(toggle, open)}
                <button type="button" class="btn-plain small" aria-label="Heading actions" aria-expanded={open} onclick={toggle}>
                  <Icon name="more" size={14} />
                </button>
              {/snippet}
              <div role="menu" aria-label="Heading actions">
                <button type="button" class="menu-item" role="menuitemcheckbox" aria-checked={heading.sortByDate} onclick={() => headingAction(heading.id, 'sort')}>
                  {#if heading.sortByDate}<Icon name="check" size={15} />{:else}<span class="menu-icon-space"></span>{/if} Sort by Date
                </button>
                <hr class="menu-sep" />
                <button type="button" class="menu-item" role="menuitem" onclick={() => headingAction(heading.id, 'archive')}><Icon name="archive" size={15} /> Archive</button>
                <button type="button" class="menu-item" role="menuitem" onclick={() => headingAction(heading.id, 'convert')}><Icon name="project" size={15} /> Convert to Project</button>
                <hr class="menu-sep" />
                <button type="button" class="menu-item danger" role="menuitem" onclick={() => headingAction(heading.id, 'delete')}><Icon name="trash" size={15} /> Delete</button>
              </div>
            </Popover>
          </div>
          <!-- Collapsed: the section is still a drop zone, so a task dropped here goes under it. -->
          {#if !heading.collapsed}<TodoList {todos} {ref} start={starts[i + 1]} />{/if}
        </section>
      {/if}
    {/each}
  </div>

  {#if closedTodos.length && starts[starts.length - 1] < rowLimit.limit}
    <button type="button" class="btn-plain logged" onclick={() => (showLogged = !showLogged)}>
      {showLogged ? 'Hide' : 'Show'} {closedTodos.length} completed {closedTodos.length === 1 ? 'item' : 'items'}
    </button>
    {#if showLogged}<TodoList todos={closedTodos} {ref} mode="logbook" start={starts[starts.length - 1]} />{/if}
  {/if}

  <MoreRows total={rowTotal} />

  {#if moving}
    <AreaPickerDialog current={project.areaId} onchoose={onMoveChoice} />
  {/if}

  {#if askClose}
    <ChoiceDialog {...completeProjectDialog(openCount, repeatingCount)} onchoose={onCloseChoice} />
  {/if}

  {#if askArchive}
    {@const ask = askArchive}
    <ChoiceDialog
      {...archiveHeadingDialog(ask.repeating)}
      onchoose={(v) => {
        askArchive = null;
        if (v === 'archive') void repo.archiveHeading(ask.id);
      }}
    />
  {/if}
{/if}

<style>
  /* A repeating project's template (FR-4.6): the grey banner above the title. */
  .template-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin: 0 0 12px;
    padding: 5px 6px 5px 12px;
    border-radius: var(--radius);
    background: var(--tag-bg);
    font-size: 13px;
  }
  /* The repeat line (FR-4.6), as on a repeating task's card: the rule and next dates, or a copy's note. */
  .repeat {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 0 0 4px;
    padding: 4px 0;
    border: 0;
    background: transparent;
    text-align: left;
    font-size: 13px;
    color: var(--text);
    width: 100%;
  }
  .repeat > span:first-of-type {
    display: flex;
    flex-direction: column;
    flex: 1;
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
  }
  .show {
    color: var(--accent-text);
  }
  @media print {
    .template-banner {
      display: none;
    }
  }
  .chip.due {
    color: var(--danger);
    font-weight: 600;
  }
  .chip.status {
    color: var(--c-logbook);
  }
  .phone-only {
    display: none;
  }
  @media (max-width: 767px) {
    .phone-only {
      display: flex;
    }
  }
  .notes-wrap {
    margin: 0 0 12px 38px;
    width: calc(100% - 38px);
  }
  .heading {
    margin-top: 22px;
  }
  .heading-row {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 8px 4px;
    border-bottom: 1px solid var(--rule);
    color: var(--accent-text);
  }
  .heading-row :global(input) {
    color: var(--accent-text);
  }
  .disclose {
    padding: 4px 2px;
    margin-left: -6px;
    color: var(--text-2);
  }
  .hidden-count {
    font-size: 12px;
    color: var(--text-2);
    padding: 0 4px;
  }
  .small {
    padding: 4px;
  }
  .logged {
    margin-top: 16px;
    font-size: 13px;
  }
  .missing {
    color: var(--text-3);
  }
</style>
