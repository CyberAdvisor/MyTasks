<!--
  Project page (FR-2.1 to FR-2.4), laid out as in Things: the ⋯ menu right
  after the title holds the project actions (complete, When, tags, deadline,
  move, duplicate, delete). Values that are set show as chips under the title;
  clicking a chip reopens its picker.
-->
<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import ProgressPie from '../components/ProgressPie.svelte';
  import TodoList from '../components/TodoList.svelte';
  import EditableTitle from '../components/EditableTitle.svelte';
  import ViewHeader from '../components/ViewHeader.svelte';
  import ChoiceDialog from '../components/ChoiceDialog.svelte';
  import Popover from '../components/Popover.svelte';
  import WhenPicker from '../components/WhenPicker.svelte';
  import DeadlinePicker from '../components/DeadlinePicker.svelte';
  import TagPicker from '../components/TagPicker.svelte';
  import AreaPickerDialog from '../components/AreaPickerDialog.svelte';
  import { deadlineLabel, formatRelative } from '../lib/model/dates';
  import TagBar from '../components/TagBar.svelte';
  import { newHeading } from '../lib/actions';
  import { activeTag, filterByTag, tagTitles, tagsInUse } from '../lib/model/tags';
  import { snapshot, todayDate } from '../lib/state/live';
  import { go } from '../lib/state/route';
  import { ui } from '../lib/state/ui.svelte';
  import { bySortKey } from '../lib/model/order';
  import { isClosed, projectProgress, projectSections } from '../lib/model/lists';
  import * as repo from '../lib/db/repo';
  import type { ID } from '../lib/model/types';

  let { id }: { id: ID } = $props();

  let s = $derived($snapshot);
  let ref = $derived($todayDate);
  let project = $derived(s.projects.find((p) => p.id === id));
  let allSections = $derived(projectSections(s, id));
  // Tag filter (FR-6.3) over the project's open to-dos.
  let offered = $derived(
    tagsInUse([...allSections.loose, ...allSections.headings.flatMap((h) => h.todos)], s),
  );
  let tag = $derived(activeTag(ui.tagFilter, offered));
  let sections = $derived({
    loose: filterByTag(allSections.loose, tag, s),
    headings: allSections.headings.map((h) => ({ ...h, todos: filterByTag(h.todos, tag, s) })),
  });
  let closedTodos = $derived(bySortKey(s.todos.filter((t) => t.projectId === id && isClosed(t))));
  let openCount = $derived(allSections.loose.length + allSections.headings.reduce((n, h) => n + h.todos.length, 0));
  let showLogged = $state(false);
  let askClose = $state(false);
  let headingMenu = $state<ID | null>(null);
  let moving = $state(false);

  // The ⋯ menu shows either its item list or one of the pickers.
  let menuOpen = $state(false);
  let menuPanel = $state<'menu' | 'when' | 'tags' | 'deadline'>('menu');
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
    if (openCount > 0) askClose = true;
    else void repo.closeProject(id, 'completed', 'completed');
  }

  function onCloseChoice(v: string | null) {
    askClose = false;
    if (v === 'complete') void repo.closeProject(id, 'completed', 'completed');
    if (v === 'cancel') void repo.closeProject(id, 'completed', 'canceled');
  }

  async function addTodo(headingId: ID | null = null) {
    const todoId = await repo.createTodo({ projectId: id, headingId });
    ui.open(todoId);
  }

  function addHeading() {
    menuOpen = false;
    void newHeading(id);
  }

  function reopen() {
    menuOpen = false;
    void repo.reopenProject(id);
  }

  function chooseWhen(choice: repo.WhenChoice) {
    menuOpen = whenOpen = false;
    void repo.setProjectWhen(id, choice);
  }

  function chooseDeadline(deadline: string | null) {
    menuOpen = deadlineOpen = false;
    void repo.updateProject(id, { deadline });
  }

  function startMove() {
    menuOpen = false;
    moving = true;
  }

  function onMoveChoice(areaId: ID | null | undefined) {
    moving = false;
    if (areaId !== undefined) void repo.updateProject(id, { areaId });
  }

  async function duplicate() {
    menuOpen = false;
    const copyId = await repo.duplicateProject(id);
    if (copyId) go({ kind: 'project', id: copyId });
  }

  async function headingAction(hid: ID, action: 'archive' | 'convert' | 'delete') {
    headingMenu = null;
    if (action === 'archive') await repo.archiveHeading(hid);
    if (action === 'delete') await repo.deleteHeading(hid);
    if (action === 'convert') {
      const pid = await repo.convertHeadingToProject(hid);
      if (pid) go({ kind: 'project', id: pid });
    }
  }

  async function trashProject() {
    menuOpen = false;
    await repo.setProjectTrashed(id, true);
    go({ kind: 'list', list: 'today' });
  }
</script>

{#if !project}
  <p class="missing">This project no longer exists.</p>
{:else}
  {#snippet whenPanel()}
    <WhenPicker startDate={project!.startDate} deferred={project!.start === 'deferred'} {ref} onchoose={chooseWhen} />
  {/snippet}
  {#snippet deadlinePanel()}
    <DeadlinePicker deadline={project!.deadline} {ref} onchoose={chooseDeadline} />
  {/snippet}
  {#snippet tagsPanel()}
    <TagPicker tagIds={project!.tagIds} ontoggle={(tagId, on) => repo.toggleTag('projects', id, tagId, on)} />
  {/snippet}

  <ViewHeader>
    {#snippet icon()}<ProgressPie fraction={projectProgress(s, id)} size={26} />{/snippet}
    {#snippet heading()}
      <EditableTitle
        fit
        value={project!.title}
        placeholder="New Project"
        label="Project title"
        autofocus={!project!.title}
        onsave={(v) => repo.updateProject(id, { title: v })}
      />
      <Popover bind:open={menuOpen} label="Project actions" align="left">
        {#snippet trigger(toggle, open)}
          <button type="button" class="more" aria-label="More project actions" aria-expanded={open} onclick={toggle}>
            <Icon name="more" size={18} />
          </button>
        {/snippet}
        {#if menuPanel === 'when'}
          {@render whenPanel()}
        {:else if menuPanel === 'deadline'}
          {@render deadlinePanel()}
        {:else if menuPanel === 'tags'}
          {@render tagsPanel()}
        {:else}
          <div role="menu" aria-label="Project actions">
            {#if project!.status === 'open'}
              <button type="button" class="menu-item" role="menuitem" onclick={complete}><Icon name="check" size={15} /> Complete Project</button>
            {:else}
              <button type="button" class="menu-item" role="menuitem" onclick={reopen}><Icon name="check" size={15} /> Reopen Project</button>
            {/if}
            <button type="button" class="menu-item" role="menuitem" onclick={() => (menuPanel = 'when')}><Icon name="calendar" size={15} /> When</button>
            <button type="button" class="menu-item" role="menuitem" onclick={() => (menuPanel = 'tags')}>
              <Icon name="tag" size={15} /> {project!.tagIds.length ? 'Edit Tags' : 'Add Tags'}
            </button>
            <button type="button" class="menu-item" role="menuitem" onclick={() => (menuPanel = 'deadline')}>
              <Icon name="flag" size={15} /> {project!.deadline ? 'Change Deadline' : 'Add Deadline'}
            </button>
            <hr class="menu-sep" />
            <button type="button" class="menu-item" role="menuitem" onclick={startMove}><Icon name="move" size={15} /> Move</button>
            <button type="button" class="menu-item" role="menuitem" onclick={duplicate}><Icon name="copy" size={15} /> Duplicate Project</button>
            <button type="button" class="menu-item danger" role="menuitem" onclick={trashProject}><Icon name="trash" size={15} /> Delete Project</button>
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
    <div class="chips">
      {#if project.status !== 'open'}
        <span class="chip status"><Icon name="check" size={12} /> {project.status === 'completed' ? 'Completed' : 'Canceled'}</span>
      {/if}
      {#if hasWhen}
        <Popover bind:open={whenOpen} label="When" align="left">
          {#snippet trigger(toggle)}
            <button type="button" class="chip" aria-label="When: {whenText}" onclick={toggle}>
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

  <textarea
    class="notes"
    aria-label="Project notes"
    placeholder="Notes"
    rows="2"
    value={project.notes}
    onchange={(e) => repo.updateProject(id, { notes: (e.currentTarget as HTMLTextAreaElement).value })}
  ></textarea>

  <TagBar tags={offered} />

  <TodoList todos={sections.loose} {ref} />

  {#each sections.headings as { heading, todos } (heading.id)}
    <section class="heading">
      <div class="heading-row">
        <EditableTitle
          value={heading.title}
          placeholder="New Heading"
          label="Heading title"
          size={15}
          autofocus={heading.id === ui.newHeadingId}
          onsave={(v) => repo.renameHeading(heading.id, v)}
        />
        <button type="button" class="btn-plain small" aria-label="Add to-do under heading" onclick={() => addTodo(heading.id)}>
          <Icon name="plus" size={14} />
        </button>
        <div class="pop-wrap">
          <button type="button" class="btn-plain small" aria-label="Heading actions" onclick={() => (headingMenu = headingMenu === heading.id ? null : heading.id)}>
            <Icon name="more" size={14} />
          </button>
          {#if headingMenu === heading.id}
            <div class="pop" role="menu">
              <button type="button" role="menuitem" onclick={() => headingAction(heading.id, 'archive')}>Archive</button>
              <button type="button" role="menuitem" onclick={() => headingAction(heading.id, 'convert')}>Convert to Project</button>
              <button type="button" role="menuitem" class="danger" onclick={() => headingAction(heading.id, 'delete')}>Delete</button>
            </div>
          {/if}
        </div>
      </div>
      <TodoList {todos} {ref} />
    </section>
  {/each}

  {#if closedTodos.length}
    <button type="button" class="btn-plain logged" onclick={() => (showLogged = !showLogged)}>
      {showLogged ? 'Hide' : 'Show'} {closedTodos.length} logged {closedTodos.length === 1 ? 'item' : 'items'}
    </button>
    {#if showLogged}<TodoList todos={closedTodos} {ref} mode="logbook" />{/if}
  {/if}

  {#if moving}
    <AreaPickerDialog current={project.areaId} onchoose={onMoveChoice} />
  {/if}

  {#if askClose}
    <ChoiceDialog
      title="Complete this project?"
      message={`It still has ${openCount} open ${openCount === 1 ? 'to-do' : 'to-dos'}. Mark them as completed or canceled?`}
      choices={[
        { label: 'Cancel them', value: 'cancel' },
        { label: 'Complete them', value: 'complete' },
      ]}
      onchoose={onCloseChoice}
    />
  {/if}
{/if}

<style>
  .more {
    border: 0;
    background: transparent;
    color: var(--text-3);
    padding: 4px 6px;
    border-radius: var(--radius);
    display: inline-flex;
    flex: none;
  }
  .more:hover,
  .more[aria-expanded='true'] {
    background: var(--hover-bg);
    color: var(--text);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin: -8px 0 10px 38px;
  }
  .chip.due {
    color: var(--danger);
    font-weight: 600;
  }
  .chip.status {
    color: var(--c-logbook);
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    border: 0;
    background: transparent;
    padding: 0;
  }
  .phone-only {
    display: none;
  }
  @media (max-width: 767px) {
    .phone-only {
      display: flex;
    }
  }
  .notes {
    width: 100%;
    border: 0;
    outline: none;
    resize: vertical;
    font-size: 14px;
    color: var(--text-2);
    margin: 0 0 12px 38px;
    width: calc(100% - 38px);
    background: transparent;
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
  .small {
    padding: 4px;
  }
  .logged {
    margin-top: 16px;
    font-size: 13px;
  }
  .pop-wrap {
    position: relative;
  }
  .pop {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    min-width: 180px;
    background: #fff;
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
    padding: 4px;
    display: flex;
    flex-direction: column;
    z-index: 20;
  }
  .pop button {
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
  .danger {
    color: var(--danger);
  }
  .missing {
    color: var(--text-3);
  }
</style>
