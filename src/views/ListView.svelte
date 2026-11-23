<!--
  The seven built-in lists (design doc, Section 3, List membership rules).
  Today can be grouped by Projects, Priorities or Contexts from the ⋯ after
  its title (FR-16, FR-18.7), which also has Move Completed Items (FR-12.2), as
  every list's ⋯ does except Completed and Trash.
  Rows can be reordered (FR-10.3) in the Inbox, in Today (also within a
  Today group), within a day in Scheduled, and within each group of
  Unscheduled and Deferred. Completed and Trash have no manual order.
-->
<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import ProgressPie from '../components/ProgressPie.svelte';
  import TodoList from '../components/TodoList.svelte';
  import MoreRows from '../components/MoreRows.svelte';
  import ViewHeader from '../components/ViewHeader.svelte';
  import ChoiceDialog from '../components/ChoiceDialog.svelte';
  import EmptyState from '../components/EmptyState.svelte';
  import TagBar from '../components/TagBar.svelte';
  import ListMenu from '../components/ListMenu.svelte';
  import CalendarEvents from '../components/CalendarEvents.svelte';
  import ScheduledEvents from '../components/ScheduledEvents.svelte';
  import { calendar } from '../lib/calendar/calendar';
  import { hasEventsIn } from '../lib/calendar/events';
  import { ui } from '../lib/state/ui.svelte';
  import { activeTag, filterByTag, projectTagIds, tagsInUse } from '../lib/model/tags';
  import { settings, listSnapshot, todayDate, todoById } from '../lib/state/live';
  import { inboxHold, releaseInbox } from '../lib/state/held';
  import { hrefFor } from '../lib/state/route';
  import { LIST_META } from '../lib/listMeta';
  import { containerLabel, headingLabel } from '../lib/labels';
  import { formatShort } from '../lib/model/dates';
  import * as L from '../lib/model/lists';
  import { startsOf } from '../lib/state/rowLimit.svelte';
  import * as repo from '../lib/db/repo';
  import { emptyTrash } from '../lib/actions';
  import type { DropZone } from '../lib/drag/drag';
  import type { Todo } from '../lib/model/types';

  let { list }: { list: L.BuiltInList } = $props();

  let meta = $derived(LIST_META[list]);
  let s = $derived($listSnapshot);
  let ref = $derived($todayDate);
  let label = $derived((t: Todo) => containerLabel(t, s));
  let confirmEmpty = $state(false);

  /** Tasks moved out of the Inbox and still listed there until OK. */
  let movedOut = $derived(
    list === 'inbox'
      ? [...$inboxHold.keys()].filter((id) => {
          const t = $todoById.get(id);
          return t !== undefined && !t.trashedAt && !L.inInbox(t);
        }).length
      : 0,
  );

  let allFlat = $derived.by((): Todo[] => {
    if (list === 'inbox') return L.inboxTodos(s);
    if (list === 'today') return L.todayTodos(s, ref);
    if (list === 'trash') return L.trashTodos(s);
    return [];
  });

  /** Whether part of Scheduled has calendar events (FR-21.6), when they're shown. */
  let hasEvents = $derived.by(() => {
    const data = list === 'scheduled' && $settings.showCalendarEvents ? $calendar.data : null;
    return (from: string, to: string) => !!data && hasEventsIn(data, from, to);
  });

  let allGroups = $derived.by((): L.TodoGroup[] => {
    if (list === 'scheduled') return L.scheduledGroups(s, ref, hasEvents);
    if (list === 'unscheduled') return L.unscheduledGroups(s, ref);
    if (list === 'deferred') return L.deferredGroups(s);
    if (list === 'logbook') return L.logbookGroups(s, ref);
    return [];
  });

  let allProjects = $derived(
    list === 'deferred' ? L.deferredProjects(s) : list === 'logbook' ? L.loggedProjects(s) : list === 'trash' ? L.trashProjects(s) : [],
  );

  // Filter bar (FR-6.3): offer the tags used here, then narrow every part of the list.
  let allTodos = $derived([...allFlat, ...allGroups.flatMap((g) => g.todos)]);
  let offered = $derived(tagsInUse(allTodos, s));
  let tag = $derived(activeTag(ui.tagFilter, offered, s.tags));
  // Today's completed tasks, while hidden: one checked off now still shows for its 2 seconds, as it isn't saved as completed until then.
  let hiding = $derived(list === 'today' && ui.hideCompleted);
  const narrow = (todos: Todo[]) => (hiding ? L.withoutClosed(filterByTag(todos, tag, s)) : filterByTag(todos, tag, s));
  /** Hide shows only when Today has completed tasks to hide; Show whenever they're hidden. */
  let showHide = $derived(list === 'today' && (ui.hideCompleted || allFlat.some(L.isClosed)));
  let flat = $derived(narrow(allFlat));
  // A Scheduled group with calendar events, or a repeating project's template, stays even when the tag bar leaves it no tasks.
  let groups = $derived(
    allGroups
      .map((g) => ({ ...g, todos: narrow(g.todos), projects: tag ? g.projects?.filter((p) => projectTagIds(p, s).has(tag!)) : g.projects }))
      .filter((g) => g.todos.length || g.projects?.length || (g.kind && g.kind !== 'year' && hasEvents(g.from!, g.to!))),
  );
  let projects = $derived(
    tag ? allProjects.filter((p) => projectTagIds(p, s).has(tag!)) : allProjects,
  );

  // Unscheduled shows a few tasks per group until Show All (FR-23.1); an open
  // group's "Show N" closes it again. A group stays open until it's closed or the
  // view changes; one holding a task asked to be shown opens too.
  let limit = $derived(list === 'unscheduled' ? $settings.unscheduledLimit : null);
  let opened = $state<string[]>([]);
  $effect(() => {
    void list;
    opened = [];
  });
  $effect(() => {
    const id = ui.scrollId;
    if (!id || limit === null) return;
    const g = groups.find((x) => x.todos.findIndex((t) => t.id === id) >= limit!);
    if (g && !opened.includes(g.key)) opened = [...opened, g.key];
  });
  let shownGroups = $derived(
    groups.map((g) => {
      const open = opened.includes(g.key);
      const { shown, more } = L.limitTodos(g.todos, open ? null : limit);
      // The button: Show All while cut, Show N while open; none when the group fits.
      const toggle = more ? 'Show All' : open && limit !== null && g.todos.length > limit ? `Show ${limit}` : '';
      return { ...g, todos: shown, open, toggle };
    }),
  );

  // Today grouping (FR-16): applied after the filter bar.
  let grouping = $derived(list === 'today' ? $settings.todayGrouping : 'none');
  let todayGroups = $derived(grouping === 'none' ? [] : L.todayGroups(flat, grouping, s, $settings.priorityLabels));

  // The row limit (NFR-7): where each list starts among the view's rows, in screen order.
  let firstLists = $derived(grouping !== 'none' ? todayGroups.map((g) => g.todos.length) : flat.length ? [flat.length] : []);
  let counts = $derived([...firstLists, ...shownGroups.map((g) => g.todos.length)]);
  let starts = $derived(startsOf(counts));
  let rowTotal = $derived(counts.reduce((a, b) => a + b, 0));

  let mode = $derived<'open' | 'logbook' | 'trash'>(list === 'logbook' ? 'logbook' : list === 'trash' ? 'trash' : 'open');
  let isEmpty = $derived(!allFlat.length && !allGroups.length && !allProjects.length);


  /** Reordering rows: Today keeps its own order; other lists use container order. */
  const zoneFor = (field: 'sortKey' | 'todaySortKey'): DropZone => ({
    type: 'todo',
    drop: (id, order) => repo.placeTodo(id, { order, field }),
  });
  const todayZone = zoneFor('todaySortKey');
  const containerZone = zoneFor('sortKey');
  let flatZone = $derived(list === 'today' ? todayZone : list === 'inbox' ? containerZone : null);

  /**
   * Today's groups take each other's tasks (FR-16.7): a task dragged into
   * another group takes on its priority, project or area, or context, then
   * keeps the place it was dropped in Today's order.
   */
  const todayGroupZone = (key: string): DropZone => ({
    type: 'todo',
    group: 'today',
    drop: async (id, order) => {
      const t = s.todos.find((x) => x.id === id);
      const change = t ? L.todayGroupChange(key, t) : null;
      if (change?.kind === 'priority') await repo.setPriority(id, change.priority);
      else if (change?.kind === 'context') await repo.setContext(id, change.contextId);
      else if (change?.kind === 'place') await repo.moveTodo(id, change.to);
      await repo.placeTodo(id, { order, field: 'todaySortKey' });
    },
  });

  /** Groups with a manual order: each day of Scheduled (not months), and Unscheduled and Deferred groups. */
  function groupZone(g: L.TodoGroup): DropZone | null {
    if (list === 'unscheduled' || list === 'deferred') return containerZone;
    if (list === 'scheduled' && /^\d{4}-\d{2}-\d{2}$/.test(g.key)) return containerZone;
    return null;
  }

  function onEmptyChoice(v: string | null) {
    confirmEmpty = false;
    if (v === 'empty') void emptyTrash();
  }
</script>

{#snippet listMenu()}
  <ListMenu {list} />
  {#if showHide}
    <button
      type="button"
      class="hide-done"
      aria-pressed={ui.hideCompleted}
      title={ui.hideCompleted ? 'Show completed tasks' : 'Hide completed tasks'}
      onclick={() => (ui.hideCompleted = !ui.hideCompleted)}
    >
      <span class="done-mark" aria-hidden="true"><Icon name="check" size={9} color="#fff" weight={3.5} /></span>
      {ui.hideCompleted ? 'Show' : 'Hide'}
    </button>
  {/if}
{/snippet}

<ViewHeader title={meta.title} menu={list === 'logbook' || list === 'trash' ? undefined : listMenu}>
  {#snippet icon()}<Icon name={meta.icon} size={28} color={meta.color} />{/snippet}
  {#snippet actions()}
    {#if list === 'trash' && !isEmpty}
      <button type="button" class="btn-plain" onclick={() => (confirmEmpty = true)}>Empty Trash</button>
    {/if}
  {/snippet}
</ViewHeader>

{#if list === 'today'}
  <CalendarEvents day={ref} label="Today's calendar events" />
{/if}

<TagBar tags={offered} />

{#if movedOut}
  <div class="moved-out" role="status">
    <span><strong>{movedOut}</strong> {movedOut === 1 ? 'task' : 'tasks'} moved out of the Inbox</span>
    <button type="button" class="ok" onclick={releaseInbox}>OK</button>
  </div>
{/if}

{#if projects.length}
  <ul class="projects">
    {#each projects as pr (pr.id)}
      <li>
        <a href={hrefFor({ kind: 'project', id: pr.id })}>
          <ProgressPie fraction={L.projectProgress(s, pr.id)} />
          <span>{pr.title || 'New Project'}</span>
          {#if pr.status === 'canceled'}<span class="tag">Canceled</span>{/if}
        </a>
        {#if list === 'trash'}
          <button type="button" class="btn-plain" onclick={() => repo.setProjectTrashed(pr.id, false)}>Put Back</button>
        {:else if list === 'logbook'}
          <button type="button" class="btn-plain" onclick={() => repo.reopenProject(pr.id)}>Reopen</button>
        {/if}
      </li>
    {/each}
  </ul>
{/if}

{#if grouping !== 'none'}
  {#each todayGroups as g, i (g.key)}
    <TodoList
      todos={g.todos}
      start={starts[i]}
      {ref}
      title={g.title}
      subtitle={g.subtitle}
      label={grouping === 'project' ? (t) => headingLabel(t, s) : label}
      showPriority={grouping !== 'priority'}
      showContext={grouping !== 'context'}
      {list}
      zone={todayGroupZone(g.key)}
    />
  {/each}
{:else if flat.length}
  <TodoList todos={flat} {ref} {mode} {list} label={list === 'inbox' ? () => '' : label} zone={flatZone} />
{/if}

{#each shownGroups as g, i (g.key)}
  <TodoList
    todos={g.todos}
    start={starts[firstLists.length + i]}
    {ref}
    {mode}
    title={g.title}
    subtitle={g.subtitle}
    label={list === 'scheduled' || list === 'logbook' ? label : () => ''}
    {list}
    zone={groupZone(g)}
    day={g.day}
    period={!!g.kind && g.kind !== 'day'}
  >
    {#snippet before()}
      {#if g.kind}<ScheduledEvents group={g} />{/if}
      {#if g.projects?.length}
        <!-- Repeating projects' templates on their next copy's date (FR-4.6). -->
        <ul class="projects templates">
          {#each g.projects as pr (pr.id)}
            {@const count = L.openTaskCount(s, pr.id)}
            <li>
              <a href={hrefFor({ kind: 'project', id: pr.id })}>
                <Icon name="repeat" size={14} color="var(--accent)" />
                <span>{pr.title || 'New Project'}</span>
                {#if g.kind !== 'day'}<span class="tag">{formatShort(pr.startDate!)}</span>{/if}
                {#if count}<span class="tag" aria-label="{count} {count === 1 ? 'task' : 'tasks'}">{count}</span>{/if}
              </a>
            </li>
          {/each}
        </ul>
      {/if}
    {/snippet}
    {#snippet after()}
      {#if g.toggle}
        <button
          type="button"
          class="show-all"
          onclick={() => (opened = g.open ? opened.filter((k) => k !== g.key) : [...opened, g.key])}>{g.toggle}</button
        >
      {/if}
    {/snippet}
  </TodoList>
{/each}

<MoreRows total={rowTotal} />

{#if isEmpty}
  <EmptyState {list} />
{/if}

{#if confirmEmpty}
  <ChoiceDialog
    title="Empty Trash?"
    message="Everything in the Trash will be deleted permanently. This cannot be undone."
    choices={[{ label: 'Empty Trash', value: 'empty', danger: true }]}
    onchoose={onEmptyChoice}
  />
{/if}

<style>
  /* "N tasks moved out of the Inbox"; not printed. */
  .moved-out {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin: 0 0 8px;
    padding: 5px 6px 5px 12px;
    border-radius: var(--radius);
    background: var(--tag-bg);
    font-size: 13px;
  }
  .moved-out .ok {
    padding: 1px 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--field);
    font-size: 12px;
  }
  @media print {
    .moved-out {
      display: none;
    }
  }
  .projects {
    list-style: none;
    margin: 0 0 16px;
    padding: 0;
  }
  .projects li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .projects a {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px;
    color: var(--text);
    text-decoration: none;
    font-weight: 600;
    border-radius: var(--radius);
    flex: 1;
  }
  .projects a:hover {
    background: var(--hover-bg);
  }
  /* Templates in Scheduled sit with the day's tasks: a row's height, not a heading's weight. */
  .projects.templates {
    margin: 0;
  }
  .projects.templates a {
    padding: 6px 8px;
    font-weight: 500;
  }
  /* Unscheduled's Show All (FR-23.1): quiet, under the group's last row. */
  .show-all {
    margin: 2px 0 0;
    padding: 4px 8px 4px 38px;
    border: 0;
    background: none;
    color: var(--text-3);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .show-all:hover {
    color: var(--text-2);
  }
  .tag {
    font-size: 11px;
    font-weight: 400;
    color: var(--text-3);
  }
  /* Today's Hide / Show (completed tasks): small, after the ⋯ with the title's own gap.
     Its mark isn't named `box`: ViewHeader treats a `.box` in the title as a project title's edit box and wraps the row on phones. */
  .hide-done {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    align-self: center;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: none;
    padding: 2px 9px 2px 7px;
    color: var(--text-2);
    font-size: 12px;
    line-height: 18px;
  }
  .hide-done .done-mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 12px;
    height: 12px;
    border-radius: 3px;
    background: var(--accent);
  }
  @media print {
    .hide-done {
      display: none;
    }
  }
</style>
