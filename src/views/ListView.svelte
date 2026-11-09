<!--
  The seven built-in lists (design doc, Section 3, List membership rules).
-->
<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import ProgressPie from '../components/ProgressPie.svelte';
  import TodoList from '../components/TodoList.svelte';
  import ViewHeader from '../components/ViewHeader.svelte';
  import ChoiceDialog from '../components/ChoiceDialog.svelte';
  import { snapshot, todayDate } from '../lib/state/live';
  import { hrefFor } from '../lib/state/route';
  import { LIST_META } from '../lib/listMeta';
  import { containerLabel } from '../lib/labels';
  import * as L from '../lib/model/lists';
  import * as repo from '../lib/db/repo';
  import type { Todo } from '../lib/model/types';

  let { list }: { list: L.BuiltInList } = $props();

  let meta = $derived(LIST_META[list]);
  let s = $derived($snapshot);
  let ref = $derived($todayDate);
  let label = $derived((t: Todo) => containerLabel(t, s));
  let confirmEmpty = $state(false);

  let flat = $derived.by((): Todo[] => {
    if (list === 'inbox') return L.inboxTodos(s);
    if (list === 'today') return L.todayTodos(s, ref);
    if (list === 'trash') return L.trashTodos(s);
    return [];
  });

  let groups = $derived.by((): L.TodoGroup[] => {
    if (list === 'scheduled') return L.scheduledGroups(s, ref);
    if (list === 'unscheduled') return L.unscheduledGroups(s, ref);
    if (list === 'deferred') return L.deferredGroups(s, ref);
    if (list === 'logbook') return L.logbookGroups(s, ref);
    return [];
  });

  let projects = $derived(
    list === 'deferred' ? L.deferredProjects(s) : list === 'logbook' ? L.loggedProjects(s) : list === 'trash' ? L.trashProjects(s) : [],
  );

  let mode = $derived<'open' | 'logbook' | 'trash'>(list === 'logbook' ? 'logbook' : list === 'trash' ? 'trash' : 'open');
  let isEmpty = $derived(!flat.length && !groups.length && !projects.length);

  const EMPTY_TEXT: Record<L.BuiltInList, string> = {
    inbox: 'Nothing in your Inbox. New to-dos land here.',
    today: 'Nothing planned for today.',
    scheduled: 'Nothing scheduled for later.',
    unscheduled: 'No open to-dos.',
    deferred: 'Nothing deferred.',
    logbook: 'Completed to-dos appear here.',
    trash: 'Trash is empty.',
  };

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
  {/snippet}
</ViewHeader>

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

{#if flat.length}
  <TodoList todos={flat} {ref} {mode} label={list === 'inbox' ? () => '' : label} />
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
  .empty {
    color: var(--text-3);
    font-size: 14px;
    margin: 24px 8px;
  }
</style>
