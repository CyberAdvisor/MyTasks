<!--
  Area page (FR-2.5, FR-2.6): projects first, then loose to-dos.
-->
<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import ProgressPie from '../components/ProgressPie.svelte';
  import TodoList from '../components/TodoList.svelte';
  import EditableTitle from '../components/EditableTitle.svelte';
  import ViewHeader from '../components/ViewHeader.svelte';
  import ChoiceDialog from '../components/ChoiceDialog.svelte';
  import { snapshot, todayDate } from '../lib/state/live';
  import { go, hrefFor } from '../lib/state/route';
  import { ui } from '../lib/state/ui.svelte';
  import { areaLooseTodos, areaProjects, projectProgress } from '../lib/model/lists';
  import * as repo from '../lib/db/repo';
  import type { ID } from '../lib/model/types';

  let { id }: { id: ID } = $props();

  let s = $derived($snapshot);
  let area = $derived(s.areas.find((a) => a.id === id));
  let projects = $derived(areaProjects(s, id));
  let todos = $derived(areaLooseTodos(s, id));
  let askDelete = $state(false);

  async function addTodo() {
    ui.open(await repo.createTodo({ areaId: id }));
  }

  async function addProject() {
    go({ kind: 'project', id: await repo.createProject({ areaId: id }) });
  }

  async function onDeleteChoice(v: string | null) {
    askDelete = false;
    if (v === 'keep' || v === 'trash') {
      await repo.deleteArea(id, v);
      go({ kind: 'list', list: 'today' });
    }
  }
</script>

{#if !area}
  <p class="missing">This area no longer exists.</p>
{:else}
  <ViewHeader>
    {#snippet icon()}<Icon name="area" size={26} color="var(--text-2)" />{/snippet}
    {#snippet heading()}
      <EditableTitle
        value={area!.title}
        placeholder="New Area"
        label="Area title"
        autofocus={!area!.title}
        onsave={(v) => repo.renameArea(id, v)}
      />
    {/snippet}
    {#snippet actions()}
      <button type="button" class="btn-plain danger" onclick={() => (askDelete = true)}>Delete Area</button>
    {/snippet}
  </ViewHeader>

  {#if projects.length}
    <ul class="projects">
      {#each projects as p (p.id)}
        <li>
          <a href={hrefFor({ kind: 'project', id: p.id })}>
            <ProgressPie fraction={projectProgress(s, p.id)} />
            {p.title || 'New Project'}
          </a>
        </li>
      {/each}
    </ul>
  {/if}

  <TodoList {todos} ref={$todayDate} />

  <div class="adders">
    <button type="button" class="btn-plain" onclick={addTodo}><Icon name="plus" size={14} /> New To-Do</button>
    <button type="button" class="btn-plain" onclick={addProject}><Icon name="plus" size={14} /> New Project</button>
  </div>

  {#if askDelete}
    <ChoiceDialog
      title="Delete this area?"
      message="Choose what happens to its projects and to-dos."
      choices={[
        { label: 'Keep them', value: 'keep' },
        { label: 'Move them to Trash', value: 'trash', danger: true },
      ]}
      onchoose={onDeleteChoice}
    />
  {/if}
{/if}

<style>
  .projects {
    list-style: none;
    margin: 0 0 14px;
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
  .adders {
    display: flex;
    gap: 8px;
    margin-top: 16px;
  }
  .danger {
    color: var(--danger);
  }
  .missing {
    color: var(--text-3);
  }
</style>
