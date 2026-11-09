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
  import Popover from '../components/Popover.svelte';
  import TagPicker from '../components/TagPicker.svelte';
  import TagBar from '../components/TagBar.svelte';
  import { bySortKey } from '../lib/model/order';
  import { activeTag, filterByTag, projectTagIds, tagTitles, tagsInUse } from '../lib/model/tags';
  import { snapshot, todayDate } from '../lib/state/live';
  import { go, hrefFor } from '../lib/state/route';
  import { ui } from '../lib/state/ui.svelte';
  import { areaLooseTodos, areaProjects, projectProgress } from '../lib/model/lists';
  import * as repo from '../lib/db/repo';
  import type { ID } from '../lib/model/types';

  let { id }: { id: ID } = $props();

  let s = $derived($snapshot);
  let area = $derived(s.areas.find((a) => a.id === id));
  let allProjects = $derived(areaProjects(s, id));
  let allTodos = $derived(areaLooseTodos(s, id));
  let tagsOpen = $state(false);
  let areaTags = $derived(area ? tagTitles(area.tagIds, s) : []);

  // Tag filter (FR-6.3) over the area's loose to-dos and projects.
  let offered = $derived.by(() => {
    const ids = new Set(tagsInUse(allTodos, s).map((t) => t.id));
    allProjects.forEach((p) => projectTagIds(p, s).forEach((t) => ids.add(t)));
    return bySortKey(s.tags.filter((t) => ids.has(t.id)));
  });
  let tag = $derived(activeTag(ui.tagFilter, offered));
  let projects = $derived(tag ? allProjects.filter((p) => projectTagIds(p, s).has(tag!)) : allProjects);
  let todos = $derived(filterByTag(allTodos, tag, s));
  let askDelete = $state(false);


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

  <div class="fields">
    <span>Tags</span>
    <Popover bind:open={tagsOpen} label="Tags" align="left">
      {#snippet trigger(toggle)}
        <button type="button" class="value" onclick={toggle}>{areaTags.length ? areaTags.join(', ') : 'None'}</button>
      {/snippet}
      <TagPicker
        tagIds={area.tagIds}
        ontoggle={(tagId, on) => repo.toggleTag('areas', id, tagId, on)}
        ondone={() => (tagsOpen = false)}
      />
    </Popover>
  </div>

  <TagBar tags={offered} />

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
  .fields {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 0 14px 38px;
    font-size: 13px;
    color: var(--text-2);
  }
  .value {
    border: 1px solid #d6d6da;
    border-radius: 4px;
    padding: 3px 8px;
    background: #fff;
    font-size: 13px;
    color: var(--text);
  }
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
