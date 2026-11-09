<!--
  The seven built-in lists (design doc, Section 3, List membership rules).
  Today can be grouped by Project or Priority (FR-16).
  Rows can be reordered (FR-10.3) in the Inbox, in Today (also within a
  Today group), within a day in Scheduled, and within each group of
  Unscheduled and Deferred, as in Things. Logbook and Trash have no manual order.
-->
<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import ProgressPie from '../components/ProgressPie.svelte';
  import TodoList from '../components/TodoList.svelte';
  import ViewHeader from '../components/ViewHeader.svelte';
  import ChoiceDialog from '../components/ChoiceDialog.svelte';
  import TagBar from '../components/TagBar.svelte';
  import Popover from '../components/Popover.svelte';
  import { ui } from '../lib/state/ui.svelte';
  import { activeTag, filterByTag, projectTagIds, tagsInUse } from '../lib/model/tags';
  import { settings, snapshot, todayDate } from '../lib/state/live';
  import { hrefFor } from '../lib/state/route';
  import { LIST_META } from '../lib/listMeta';
  import { containerLabel } from '../lib/labels';
  import * as L from '../lib/model/lists';
  import * as repo from '../lib/db/repo';
  import type { DropZone } from '../lib/drag/drag';
  import type { Todo } from '../lib/model/types';

  let { list }: { list: L.BuiltInList } = $props();

  let meta = $derived(LIST_META[list]);
  let s = $derived($snapshot);
  let ref = $derived($todayDate);
  let label = $derived((t: Todo) => containerLabel(t, s));
  let confirmEmpty = $state(false);

  let allFlat = $derived.by((): Todo[] => {
    if (list === 'inbox') return L.inboxTodos(s);
    if (list === 'today') return L.todayTodos(s, ref);
    if (list === 'trash') return L.trashTodos(s);
    return [];
  });

  let allGroups = $derived.by((): L.TodoGroup[] => {
    if (list === 'scheduled') return L.scheduledGroups(s, ref);
    if (list === 'unscheduled') return L.unscheduledGroups(s, ref);
    if (list === 'deferred') return L.deferredGroups(s, ref);
    if (list === 'logbook') return L.logbookGroups(s, ref);
    return [];
  });

  let allProjects = $derived(
    list === 'deferred' ? L.deferredProjects(s) : list === 'logbook' ? L.loggedProjects(s) : list === 'trash' ? L.trashProjects(s) : [],
  );

  // Tag filter (FR-6.3): offer the tags used here, then narrow every part of the list.
  let offered = $derived(tagsInUse([...allFlat, ...allGroups.flatMap((g) => g.todos)], s));
  let tag = $derived(activeTag(ui.tagFilter, offered));
  let flat = $derived(filterByTag(allFlat, tag, s));
  let groups = $derived(
    allGroups.map((g) => ({ ...g, todos: filterByTag(g.todos, tag, s) })).filter((g) => g.todos.length),
  );
  let projects = $derived(tag ? allProjects.filter((p) => projectTagIds(p, s).has(tag!)) : allProjects);

  // Today grouping (FR-16): applied after the tag filter.
  const GROUPINGS: { value: L.TodayGrouping; label: string }[] = [
    { value: 'none', label: 'None' },
    { value: 'project', label: 'Project' },
    { value: 'priority', label: 'Priority' },
  ];
  let grouping = $derived(list === 'today' ? $settings.todayGrouping : 'none');
  let groupOpen = $state(false);
  let todayGroups = $derived(grouping === 'none' ? [] : L.todayGroups(flat, grouping, s, $settings.priorityLabels));

  function chooseGrouping(value: L.TodayGrouping) {
    groupOpen = false;
    void repo.setSetting('todayGrouping', value);
  }

  let mode = $derived<'open' | 'logbook' | 'trash'>(list === 'logbook' ? 'logbook' : list === 'trash' ? 'trash' : 'open');
  let isEmpty = $derived(!allFlat.length && !allGroups.length && !allProjects.length);

  const EMPTY_TEXT: Record<L.BuiltInList, string> = {
    inbox: 'Nothing in your Inbox. New to-dos land here.',
    today: 'Nothing planned for today.',
    scheduled: 'Nothing scheduled for later.',
    unscheduled: 'No open to-dos.',
    deferred: 'Nothing deferred.',
    logbook: 'Completed to-dos appear here.',
    trash: 'Trash is empty.',
  };

  /** Reordering rows: Today keeps its own order; other lists use container order. */
  const zoneFor = (field: 'sortKey' | 'todaySortKey'): DropZone => ({
    type: 'todo',
    drop: (id, order) => repo.placeTodo(id, { order, field }),
  });
  const todayZone = zoneFor('todaySortKey');
  const containerZone = zoneFor('sortKey');
  let flatZone = $derived(list === 'today' ? todayZone : list === 'inbox' ? containerZone : null);

  /** Groups with a manual order: each day of Scheduled (not months), and Unscheduled and Deferred groups. */
  function groupZone(g: L.TodoGroup): DropZone | null {
    if (list === 'unscheduled' || list === 'deferred') return containerZone;
    if (list === 'scheduled' && /^\d{4}-\d{2}-\d{2}$/.test(g.key)) return containerZone;
    return null;
  }

  function onEmptyChoice(v: string | null) {
    confirmEmpty = false;
    if (v === 'empty') void repo.emptyTrash();
  }
</script>

<ViewHeader title={meta.title}>
  {#snippet icon()}<Icon name={meta.icon} size={28} color={meta.color} />{/snippet}
  {#snippet actions()}
    {#if list === 'trash' && !isEmpty}
      <button type="button" class="btn-plain" onclick={() => (confirmEmpty = true)}>Empty Trash</button>
    {/if}
    {#if list === 'today'}
      <Popover bind:open={groupOpen} label="Group Today">
        {#snippet trigger(toggle, open)}
          <button type="button" class="btn-plain" aria-haspopup="menu" aria-expanded={open} onclick={toggle}>
            Group: {GROUPINGS.find((g) => g.value === grouping)?.label}
          </button>
        {/snippet}
        <div role="menu" aria-label="Group Today by">
          {#each GROUPINGS as g (g.value)}
            <button type="button" class="menu-item" role="menuitemradio" aria-checked={grouping === g.value} onclick={() => chooseGrouping(g.value)}>
              <span class="grow">{g.label}</span>
              {#if grouping === g.value}<Icon name="check" size={13} color="var(--accent)" />{/if}
            </button>
          {/each}
        </div>
      </Popover>
    {/if}
  {/snippet}
</ViewHeader>

<TagBar tags={offered} />

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
          <button type="button" class="btn-plain" onclick={() => repo.setProjectTrashed(pr.id, false)}>Restore</button>
        {:else if list === 'logbook'}
          <button type="button" class="btn-plain" onclick={() => repo.reopenProject(pr.id)}>Reopen</button>
        {/if}
      </li>
    {/each}
  </ul>
{/if}

{#if grouping !== 'none'}
  {#each todayGroups as g (g.key)}
    <TodoList
      todos={g.todos}
      {ref}
      title={g.title}
      subtitle={g.subtitle}
      label={grouping === 'project' ? () => '' : label}
      showPriority={grouping !== 'priority'}
      zone={todayZone}
    />
  {/each}
{:else if flat.length}
  <TodoList todos={flat} {ref} {mode} label={list === 'inbox' ? () => '' : label} zone={flatZone} />
{/if}

{#each groups as g (g.key)}
  <TodoList
    todos={g.todos}
    {ref}
    {mode}
    title={g.title}
    subtitle={g.subtitle}
    label={list === 'scheduled' || list === 'logbook' ? label : () => ''}
    starred={list === 'unscheduled' ? (t) => L.isStarred(t, ref) : () => false}
    zone={groupZone(g)}
  />
{/each}

{#if isEmpty}
  <p class="empty">{EMPTY_TEXT[list]}</p>
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
  .tag {
    font-size: 11px;
    font-weight: 400;
    color: var(--text-3);
  }
  .grow {
    flex: 1;
  }
  .empty {
    color: var(--text-3);
    font-size: 14px;
    margin: 24px 8px;
  }
</style>
