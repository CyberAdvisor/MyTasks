<!--
  Area page (FR-2.5, FR-2.6), laid out as in Things: the ⋯ menu right after
  the title holds Add/Edit Tags, New Project, Move to Completed (FR-12.2) and
  Delete Area; the area's tags
  show as chips under the title, and clicking them reopens the tag picker.
  Projects come first, then loose to-dos; both reorder by dragging.
-->
<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import ProgressPie from '../components/ProgressPie.svelte';
  import TodoList from '../components/TodoList.svelte';
  import EditableTitle from '../components/EditableTitle.svelte';
  import ViewHeader from '../components/ViewHeader.svelte';
  import ChoiceDialog from '../components/ChoiceDialog.svelte';
  import Popover from '../components/Popover.svelte';
  import MoveToCompletedItem from '../components/MoveToCompletedItem.svelte';
  import TagPicker from '../components/TagPicker.svelte';
  import TagBar from '../components/TagBar.svelte';
  import { bySortKey } from '../lib/model/order';
  import { activeTag, filterByTag, projectTagIds, tagTitles, tagsInUse } from '../lib/model/tags';
  import { activeContext, contextsInUse, filterByContext } from '../lib/model/contexts';
  import { snapshot, todayDate } from '../lib/state/live';
  import { go, hrefFor } from '../lib/state/route';
  import { ui } from '../lib/state/ui.svelte';
  import { areaLooseTodos, areaProjects, projectProgress } from '../lib/model/lists';
  import * as repo from '../lib/db/repo';
  import { dragItem, dropZone, type DropZone } from '../lib/drag/drag';
  import type { ID } from '../lib/model/types';

  let { id }: { id: ID } = $props();

  let s = $derived($snapshot);
  let area = $derived(s.areas.find((a) => a.id === id));
  // Completed projects stay here, struck through, until moved to Completed (FR-12.2).
  let allProjects = $derived(areaProjects(s, id, true));
  let allTodos = $derived(areaLooseTodos(s, id));
  // The ⋯ menu shows either its item list or the tag picker; the chips
  // under the title open the tag picker on their own.
  let menuOpen = $state(false);
  let menuPanel = $state<'menu' | 'tags'>('menu');
  $effect(() => {
    if (!menuOpen) menuPanel = 'menu';
  });
  let tagsOpen = $state(false);
  let areaTags = $derived(area ? tagTitles(area.tagIds, s) : []);

  // Filter bar (FR-6.3, FR-18.5) over the area's loose to-dos and projects.
  // Projects have no context, so a context filter hides the project rows.
  let offered = $derived.by(() => {
    const ids = new Set(tagsInUse(allTodos, s).map((t) => t.id));
    allProjects.forEach((p) => projectTagIds(p, s).forEach((t) => ids.add(t)));
    return bySortKey(s.tags.filter((t) => ids.has(t.id)));
  });
  let offeredContexts = $derived(contextsInUse(allTodos, s));
  let tag = $derived(activeTag(ui.tagFilter, offered));
  let ctx = $derived(activeContext(ui.contextFilter, offeredContexts));
  let projects = $derived(
    ctx ? [] : tag ? allProjects.filter((p) => projectTagIds(p, s).has(tag!)) : allProjects,
  );
  let todos = $derived(filterByContext(filterByTag(allTodos, tag, s), ctx));
  let askDelete = $state(false);

  // Projects here belong with the sidebar's project lists (same group), so the
  // drop code is shared; loose to-dos reorder among themselves.
  const projectZone: DropZone = {
    type: 'project',
    group: 'projects',
    drop: (pid, order) => repo.placeProject(pid, { order, areaId: id }),
  };
  const todoZone: DropZone = { type: 'todo', drop: (tid, order) => repo.placeTodo(tid, { order }) };

  async function addProject() {
    menuOpen = false;
    go({ kind: 'project', id: await repo.createProject({ areaId: id }) });
  }

  function startDelete() {
    menuOpen = false;
    askDelete = true;
  }

  async function onDeleteChoice(v: string | null) {
    askDelete = false;
    if (v === 'keep' || v === 'trash') {
      await repo.deleteArea(id, v);
      go({ kind: 'list', list: 'today' });
      ui.offerUndo('Area deleted');
    }
  }
</script>

{#if !area}
  <p class="missing">This area no longer exists.</p>
{:else}
  {#snippet tagsPanel()}
    <TagPicker
      tagIds={area!.tagIds}
      ontoggle={(tagId, on) => repo.toggleTag('areas', id, tagId, on)}
      ondone={() => (menuOpen = tagsOpen = false)}
    />
  {/snippet}

  <ViewHeader>
    {#snippet icon()}<Icon name="area" size={26} color="var(--text-2)" />{/snippet}
    {#snippet heading()}
      <EditableTitle
        fit
        value={area!.title}
        placeholder="New Area"
        label="Area title"
        autofocus={!area!.title}
        onsave={(v) => repo.renameArea(id, v)}
      />
      <Popover bind:open={menuOpen} label="Area actions" align="left">
        {#snippet trigger(toggle, open)}
          <button type="button" class="more-btn" aria-label="More area actions" aria-expanded={open} onclick={toggle}>
            <Icon name="more" size={22} weight={3.5} />
          </button>
        {/snippet}
        {#if menuPanel === 'tags'}
          {@render tagsPanel()}
        {:else}
          <div role="menu" aria-label="Area actions">
            <button type="button" class="menu-item" role="menuitem" onclick={() => (menuPanel = 'tags')}>
              <Icon name="tag" size={15} /> {area!.tagIds.length ? 'Edit Tags' : 'Add Tags'}
            </button>
            <button type="button" class="menu-item" role="menuitem" onclick={addProject}><Icon name="project" size={15} /> New Project</button>
            <MoveToCompletedItem view={{ kind: 'area', id }} onchoose={() => (menuOpen = false)} />
            <hr class="menu-sep" />
            <button type="button" class="menu-item danger" role="menuitem" onclick={startDelete}><Icon name="trash" size={15} /> Delete Area</button>
          </div>
        {/if}
      </Popover>
    {/snippet}
  </ViewHeader>

  {#if areaTags.length}
    <div class="title-chips">
      <Popover bind:open={tagsOpen} label="Tags" align="left">
        {#snippet trigger(toggle)}
          <button type="button" class="tags" aria-label="Edit tags" onclick={toggle}>
            {#each areaTags as name, i (i)}<span class="tag-pill">{name}</span>{/each}
          </button>
        {/snippet}
        {@render tagsPanel()}
      </Popover>
    </div>
  {/if}

  <TagBar tags={offered} contexts={offeredContexts} />

  {#if projects.length}
    <ul class="projects" use:dropZone={projectZone}>
      {#each projects as p (p.id)}
        <li use:dragItem={{ type: 'project', id: p.id }}>
          <a href={hrefFor({ kind: 'project', id: p.id })} class:closed={p.status !== 'open'}>
            <ProgressPie fraction={projectProgress(s, p.id)} />
            {p.title || 'New Project'}
          </a>
        </li>
      {/each}
    </ul>
  {/if}

  <TodoList {todos} ref={$todayDate} zone={todoZone} />

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
  .projects a.closed {
    color: var(--text-done);
    text-decoration: line-through;
  }
  .missing {
    color: var(--text-3);
  }
</style>
