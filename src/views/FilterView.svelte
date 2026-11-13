<!--
  Built-in searches offered by Quick Find (FR-9.3): Deadlines (open to-dos
  with a deadline, soonest first), All Projects (open projects by area) and
  Logged Projects (completed and canceled projects, newest first).
-->
<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import ProgressPie from '../components/ProgressPie.svelte';
  import TodoList from '../components/TodoList.svelte';
  import ViewHeader from '../components/ViewHeader.svelte';
  import { snapshot, todayDate } from '../lib/state/live';
  import { hrefFor } from '../lib/state/route';
  import { containerLabel } from '../lib/labels';
  import { bySortKey } from '../lib/model/order';
  import { areaProjects, loggedProjects, projectProgress } from '../lib/model/lists';
  import { deadlineTodos, FILTER_TITLES, type BuiltInFilter } from '../lib/model/search';
  import type { Project, Todo } from '../lib/model/types';

  let { filter }: { filter: BuiltInFilter } = $props();

  let s = $derived($snapshot);
  let todos = $derived(filter === 'deadlines' ? deadlineTodos(s) : []);

  /** Project groups: by area for All Projects, one group for Logged Projects. */
  let projectGroups = $derived.by((): { title: string; projects: Project[] }[] => {
    if (filter === 'logged-projects') return [{ title: '', projects: loggedProjects(s) }];
    if (filter !== 'projects') return [];
    return [
      ...bySortKey(s.areas).map((a) => ({ title: a.title || 'New Area', projects: areaProjects(s, a.id) })),
      { title: 'No area', projects: areaProjects(s, null) },
    ].filter((g) => g.projects.length);
  });

  let label = (t: Todo) => containerLabel(t, s);
  let empty = $derived(!todos.length && !projectGroups.length);
</script>

<ViewHeader title={FILTER_TITLES[filter]}>
  {#snippet icon()}<Icon name={filter === 'deadlines' ? 'flag' : 'search'} size={26} color="var(--text-2)" />{/snippet}
</ViewHeader>

{#if todos.length}
  <TodoList {todos} ref={$todayDate} {label} />
{/if}

{#each projectGroups as g, i (i)}
  <section>
    {#if g.title}<h2>{g.title}</h2>{/if}
    <ul class="projects">
      {#each g.projects as p (p.id)}
        <li>
          <a href={hrefFor({ kind: 'project', id: p.id })}>
            <ProgressPie fraction={projectProgress(s, p.id)} />
            <span>{p.title || 'New Project'}</span>
            {#if p.status === 'canceled'}<span class="note">Canceled</span>{/if}
          </a>
        </li>
      {/each}
    </ul>
  </section>
{/each}

{#if empty}
  <p class="empty">{filter === 'deadlines' ? 'No open tasks have a deadline.' : 'No projects.'}</p>
{/if}

<style>
  h2 {
    margin: 0 0 4px;
    padding: 0 8px 6px;
    border-bottom: 1px solid var(--rule);
    font-size: 15px;
    font-weight: 700;
    color: var(--accent-text);
  }
  .projects {
    list-style: none;
    margin: 0 0 18px;
    padding: 0;
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
  }
  .projects a:hover {
    background: var(--hover-bg);
  }
  .note {
    font-size: 11px;
    font-weight: 400;
    color: var(--text-3);
  }
  .empty {
    color: var(--text-3);
    font-size: 14px;
    margin: 24px 8px;
  }
</style>
