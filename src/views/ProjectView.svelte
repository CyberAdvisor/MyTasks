<!--
  Project page (FR-2.1 to FR-2.4): title, notes, dates, to-dos and headings.
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
  let moreOpen = $state(false);
  let headingMenu = $state<ID | null>(null);
  let whenOpen = $state(false);
  let deadlineOpen = $state(false);
  let tagsOpen = $state(false);

  let whenText = $derived(
    !project
      ? ''
      : project.start === 'deferred'
        ? 'Deferred'
        : project.startDate === null
          ? 'Unscheduled'
          : project.startDate <= ref
            ? 'Today'
            : formatRelative(project.startDate, ref),
  );
  let projectTags = $derived(project ? tagTitles(project.tagIds, s) : []);

  function complete() {
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
    moreOpen = false;
    void newHeading(id);
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

  function toggleDeferred() {
    moreOpen = false;
    if (project) void repo.updateProject(id, { start: project.start === 'deferred' ? 'unscheduled' : 'deferred' });
  }

  async function trashProject() {
    moreOpen = false;
    await repo.setProjectTrashed(id, true);
    go({ kind: 'list', list: 'today' });
  }
</script>

{#if !project}
  <p class="missing">This project no longer exists.</p>
{:else}
  <ViewHeader>
    {#snippet icon()}<ProgressPie fraction={projectProgress(s, id)} size={26} />{/snippet}
    {#snippet heading()}
      <EditableTitle
        value={project!.title}
        placeholder="New Project"
        label="Project title"
        autofocus={!project!.title}
        onsave={(v) => repo.updateProject(id, { title: v })}
      />
    {/snippet}
    {#snippet actions()}
      {#if project!.status === 'open'}
        <button type="button" class="btn-plain" onclick={complete}>
          <Icon name="check" size={14} /> Complete
        </button>
      {:else}
        <button type="button" class="btn-plain" onclick={() => repo.reopenProject(id)}>Reopen</button>
      {/if}
      <div class="pop-wrap">
        <button type="button" class="btn-plain" aria-label="More project actions" aria-expanded={moreOpen} onclick={() => (moreOpen = !moreOpen)}>
          <Icon name="more" size={16} />
        </button>
        {#if moreOpen}
          <div class="pop" role="menu">
            {#if project!.status === 'open'}
              <button type="button" role="menuitem" onclick={addHeading}>Add Heading</button>
            {/if}
            <button type="button" role="menuitem" onclick={toggleDeferred}>
              {project!.start === 'deferred' ? 'Make Unscheduled' : 'Defer Project'}
            </button>
            <button type="button" role="menuitem" class="danger" onclick={trashProject}>Delete Project</button>
          </div>
        {/if}
      </div>
    {/snippet}
  </ViewHeader>

  <div class="fields">
    <label>
      <span>Area</span>
      <select
        value={project.areaId ?? ''}
        onchange={(e) => repo.updateProject(id, { areaId: (e.currentTarget as HTMLSelectElement).value || null })}
      >
        <option value="">No area</option>
        {#each bySortKey(s.areas) as a (a.id)}<option value={a.id}>{a.title || 'New Area'}</option>{/each}
      </select>
    </label>
    <span class="field">
      <span>When</span>
      <Popover bind:open={whenOpen} label="When" align="left">
        {#snippet trigger(toggle)}
          <button type="button" class="value" onclick={toggle}>{whenText}</button>
        {/snippet}
        <WhenPicker
          startDate={project.startDate}
          deferred={project.start === 'deferred'}
          {ref}
          onchoose={(c) => {
            whenOpen = false;
            void repo.setProjectWhen(id, c);
          }}
        />
      </Popover>
    </span>
    <span class="field">
      <span>Deadline</span>
      <Popover bind:open={deadlineOpen} label="Deadline" align="left">
        {#snippet trigger(toggle)}
          <button type="button" class="value" class:due={project!.deadline !== null && project!.deadline <= ref} onclick={toggle}>
            {project!.deadline ? deadlineLabel(project!.deadline, ref) : 'None'}
          </button>
        {/snippet}
        <DeadlinePicker
          deadline={project.deadline}
          {ref}
          onchoose={(d) => {
            deadlineOpen = false;
            void repo.updateProject(id, { deadline: d });
          }}
        />
      </Popover>
    </span>
    <span class="field">
      <span>Tags</span>
      <Popover bind:open={tagsOpen} label="Tags" align="left">
        {#snippet trigger(toggle)}
          <button type="button" class="value" onclick={toggle}>{projectTags.length ? projectTags.join(', ') : 'None'}</button>
        {/snippet}
        <TagPicker entity="projects" {id} tagIds={project.tagIds} />
      </Popover>
    </span>
  </div>

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
  .fields {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 14px;
    margin: 0 0 8px 38px;
    font-size: 13px;
    color: var(--text-2);
  }
  .fields label,
  .field {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .fields select,
  .value {
    border: 1px solid #d6d6da;
    border-radius: 4px;
    padding: 3px 8px;
    background: #fff;
    font-size: 13px;
    color: var(--text);
  }
  .value.due {
    color: var(--danger);
    font-weight: 600;
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
