<!--
  Sidebar (design doc, Section 3 "Sidebar layout"): app header, built-in
  lists with counts, collapsible Saved Searches, then areas and projects.
  Drag saved searches, areas and projects to reorder them; drag a project
  onto another area to move it there, or below the last area to take it out
  of any area (FR-10.8, FR-10.9, FR-15.5). Drop a to-do onto a project or an
  area to move it there (FR-10.11), or onto Inbox, Today, Scheduled,
  Unscheduled, Deferred or Trash (FR-10.3b, see `takesDrop`). While an area is focused (FR-22.1), a band
  at the top shows it, and only that area is listed (the focused snapshot).
-->
<script lang="ts">
  import FocusBand from './FocusBand.svelte';
  import Icon from './Icon.svelte';
  import Logo from './Logo.svelte';
  import SyncStatus from './SyncStatus.svelte';
  import InstallNotice from './InstallNotice.svelte';
  import VersionLink from './VersionLink.svelte';
  import SiteLink from './SiteLink.svelte';
  import ProgressPie from './ProgressPie.svelte';
  import DropWhen from './DropWhen.svelte';
  import { snapshot, todayDate } from '../lib/state/live';
  import { route, go, hrefFor, type Route } from '../lib/state/route';
  import { areaProjects, projectIndex, projectProgress, sidebarCounts, takesDrop, type BuiltInList } from '../lib/model/lists';
  import { bySortKey } from '../lib/model/order';
  import { LIST_META } from '../lib/listMeta';
  import { openMatchCount, savedSearchesInOrder } from '../lib/model/search';
  import { ui } from '../lib/state/ui.svelte';
  import { readFlag, writeFlag } from '../lib/state/flags';
  import * as repo from '../lib/db/repo';
  import * as bulk from '../lib/bulk';
  import { changeWhen, trashTodos } from '../lib/actions';
  import { dragItem, dropTarget, dropZone, type DropTarget, type DropZone } from '../lib/drag/drag';
  import type { ID } from '../lib/model/types';
  import type { SidebarTarget } from '../lib/model/sidebarMenu';
  import { closeOnOutside, focusItem, step } from '../lib/menuNav';
  import { tick } from 'svelte';

  const SAVED_KEY = 'mytasks.savedSearchesCollapsed';

  let counts = $derived(sidebarCounts($snapshot, $todayDate));
  let areas = $derived(bySortKey($snapshot.areas));
  // Completed projects stay listed, struck through, until moved to Completed (FR-12.2).
  let looseProjects = $derived(areaProjects($snapshot, null, true));
  let saved = $derived(savedSearchesInOrder($snapshot));
  let savedCollapsed = $state(readFlag(SAVED_KEY));
  let menuOpen = $state(false);
  /** The New List button and its menu, which closes like every other menu (review F3). */
  let newListButton = $state<HTMLButtonElement>();
  let newListMenu = $state<HTMLDivElement>();
  $effect(() => {
    if (!menuOpen) return;
    // Opened from the keyboard, its first item takes focus, so the arrow keys work at once.
    void tick().then(() => {
      if (document.activeElement === newListButton) focusItem(newListMenu, 0);
    });
    // Escape closes it wherever focus is (Safari doesn't focus a clicked button).
    const onEscape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      menuOpen = false;
    };
    document.addEventListener('keydown', onEscape, true);
    const stop = closeOnOutside(() => [newListMenu, newListButton], () => (menuOpen = false));
    return () => {
      document.removeEventListener('keydown', onEscape, true);
      stop();
    };
  });
  function onNewListKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      step(newListMenu!, e.key === 'ArrowDown' ? 1 : -1);
    }
  }

  function toggleSaved() {
    savedCollapsed = !savedCollapsed;
    writeFlag(SAVED_KEY, savedCollapsed);
  }

  /** Is this route the one currently shown? */
  /**
   * Event handlers that open an item's right-click menu (SidebarMenu): a
   * right-click or Control-click, or Shift+F10 or the Menu key while the item
   * has focus. A long press on touch is left to dragging (FR-10.8).
   */
  function menuOn(target: SidebarTarget) {
    return {
      oncontextmenu: (e: MouseEvent) => {
        if ((e as PointerEvent).pointerType === 'touch') return;
        e.preventDefault();
        ui.sidebarMenu = { target, x: e.clientX, y: e.clientY };
      },
      onkeydown: (e: KeyboardEvent) => {
        if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return;
        e.preventDefault();
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        ui.sidebarMenu = { target, x: r.left + 24, y: r.bottom - 2, keyboard: true };
      },
    };
  }

  function isActive(r: Route): boolean {
    return hrefFor(r) === hrefFor($route);
  }

  async function newProject() {
    menuOpen = false;
    const id = await repo.createProject({ title: '' });
    go({ kind: 'project', id });
  }

  async function newArea() {
    menuOpen = false;
    const id = await repo.createArea('');
    go({ kind: 'area', id });
  }

  const savedZone: DropZone = { type: 'saved', drop: (id, order) => repo.placeSavedSearch(id, order) };
  const areaZone: DropZone = { type: 'area', drop: (id, order) => repo.placeArea(id, order) };
  /** Each area, and the list of projects with no area, takes projects from any other. */
  const projectZone = (areaId: ID | null): DropZone => ({
    type: 'project',
    group: 'projects',
    drop: (id, order) => repo.placeProject(id, { order, areaId }),
  });

  /**
   * A to-do dropped on a project or area moves there, at the end of its to-dos
   * with no heading, as the Move dialog does. Not offered where it already is.
   */
  const moveHere = (to: { projectId: ID } | { areaId: ID }): DropTarget => ({
    type: 'todo',
    accepts: (id) => {
      const t = $snapshot.todos.find((x) => x.id === id);
      if (!t) return false;
      return 'projectId' in to ? t.projectId !== to.projectId : t.projectId !== null || t.areaId !== to.areaId;
    },
    drop: (ids) => bulk.move(ids, to),
  });

  /** Tasks dropped on Scheduled wait here for their date (DropWhen). */
  let scheduling = $state<{ ids: ID[]; x: number; y: number } | null>(null);

  /**
   * A built-in list takes dropped to-dos (FR-10.3b), except where they
   * already are (`takesDrop`); Logbook takes none.
   */
  const listTarget = (list: BuiltInList): DropTarget | null =>
    list === 'logbook'
      ? null
      : {
          type: 'todo',
          accepts: (id) => {
            const t = $snapshot.todos.find((x) => x.id === id);
            return !!t && takesDrop(list, t, projectIndex($snapshot.projects), $todayDate);
          },
          drop: (ids) => dropOnList(list, ids),
        };

  /** Apply a drop on a list. Returns false when Undo is offered later, or by the Trash's own message. */
  async function dropOnList(list: BuiltInList, ids: ID[]): Promise<boolean | void> {
    if (list === 'inbox') return bulk.toInbox(ids);
    if (list === 'today') return changeWhen(ids, { kind: 'today' });
    if (list === 'unscheduled') return bulk.setWhen(ids, { kind: 'unscheduled' });
    if (list === 'deferred') return bulk.setWhen(ids, { kind: 'deferred' });
    if (list === 'trash') {
      await trashTodos(ids);
      return false;
    }
    // Scheduled: the Start Date picker opens beside the list.
    const r = document.querySelector('.sidebar [data-list="scheduled"]')?.getBoundingClientRect();
    scheduling = { ids, x: r ? r.right + 4 : 0, y: r ? r.top : 0 };
    return false;
  }

  const groups: BuiltInList[][] = [['inbox'], ['today', 'scheduled', 'unscheduled', 'deferred'], ['logbook', 'trash']];
</script>

<nav class="sidebar" aria-label="Lists">
  <div class="brand">
    <Logo />
    <div class="brand-text">
      <span class="brand-name">My Tasks</span>
      <span class="brand-sub">Plan. Do. Succeed.</span>
    </div>
    <!-- Phones have no toolbar, so Quick Find opens from here. -->
    <button type="button" class="find" aria-label="Quick Find" title="Quick Find" onclick={() => ui.openFind()}>
      <Icon name="search" size={20} />
    </button>
  </div>

  <FocusBand place="sidebar" />

  <div class="scroll">
    {#each groups as group, gi (gi)}
      <ul class="lists" class:gap={gi > 0}>
        {#each group as list (list)}
          {@const meta = LIST_META[list]}
          {@const r = { kind: 'list', list } as Route}
          <li>
            <a
              href={hrefFor(r)}
              class="item"
              class:active={isActive(r)}
              aria-current={isActive(r) ? 'page' : undefined}
              data-list={list}
              use:dropTarget={listTarget(list)}
            >
              <Icon name={meta.icon} color={meta.color} size={16} />
              <span class="label">{meta.title}</span>
              {#if list === 'inbox' && counts.inbox}<span class="count">{counts.inbox}</span>{/if}
              {#if list === 'today'}
                {#if counts.due}<span class="count due" title="Due or overdue">{counts.due}</span>{/if}
                {#if counts.today}<span class="count">{counts.today}</span>{/if}
              {/if}
            </a>
          </li>
        {/each}
      </ul>
    {/each}

    <hr />
    <button type="button" class="section-label" aria-expanded={!savedCollapsed} onclick={toggleSaved}>
      <Icon name={savedCollapsed ? 'chevron-right' : 'chevron-down'} size={12} />
      Saved Searches
    </button>
    {#if !savedCollapsed}
      {#if saved.length}
        <ul class="lists" use:dropZone={savedZone}>
          {#each saved as x (x.id)}
            {@const r = { kind: 'saved', id: x.id } as Route}
            {@const count = openMatchCount($snapshot, x)}
            <li use:dragItem={{ type: 'saved', id: x.id }}>
              <a href={hrefFor(r)} class="item" class:active={isActive(r)} aria-current={isActive(r) ? 'page' : undefined} {...menuOn({ kind: 'saved', id: x.id })}>
                <Icon name="search" color="var(--text-2)" size={16} />
                <span class="label">{x.title || 'Saved Search'}</span>
                {#if count}<span class="count">{count}</span>{/if}
              </a>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="empty">No saved searches</p>
      {/if}
    {/if}
    <hr />

    <div use:dropZone={areaZone}>
      {#each areas as area (area.id)}
        {@const r = { kind: 'area', id: area.id } as Route}
        <div use:dragItem={{ type: 'area', id: area.id }} use:dropZone={projectZone(area.id)}>
          <div class="area-row">
            <!-- In the gutter before the area, shown on hover, and always while collapsed (FR-2.7). -->
            <button
              type="button"
              class="disclose"
              class:shut={area.collapsed}
              data-no-drag
              aria-label={area.collapsed ? `Expand ${area.title || 'New Area'}` : `Collapse ${area.title || 'New Area'}`}
              aria-expanded={!area.collapsed}
              onclick={() => repo.setAreaCollapsed(area.id, !area.collapsed)}
            >
              <Icon name={area.collapsed ? 'chevron-right' : 'chevron-down'} size={12} />
            </button>
            <a href={hrefFor(r)} class="item" class:active={isActive(r)} use:dropTarget={moveHere({ areaId: area.id })} {...menuOn({ kind: 'area', id: area.id })}>
              <Icon name="area" color="var(--text-2)" size={16} />
              <span class="label">{area.title || 'New Area'}</span>
            </a>
          </div>
          <!-- Empty while collapsed; the area's row still takes dropped projects. -->
          <ul class="lists">
            {#each area.collapsed ? [] : areaProjects($snapshot, area.id, true) as project (project.id)}
              {@const pr = { kind: 'project', id: project.id } as Route}
              <li use:dragItem={{ type: 'project', id: project.id }}>
                <a href={hrefFor(pr)} class="item project pie" class:active={isActive(pr)} class:closed={project.status !== 'open'} use:dropTarget={project.status === 'open' ? moveHere({ projectId: project.id }) : null} {...menuOn({ kind: 'project', id: project.id })}>
                  {#if project.repeat}<Icon name="repeat" size={14} color="var(--accent)" />{:else}<ProgressPie fraction={projectProgress($snapshot, project.id)} size={14} />{/if}
                  <span class="label">{project.title || 'New Project'}</span>
                </a>
              </li>
            {/each}
          </ul>
        </div>
      {/each}
    </div>

    <!-- Always present, so a project can be dragged out of every area. -->
    <ul class="lists" class:gap={looseProjects.length > 0} use:dropZone={projectZone(null)}>
      {#each looseProjects as project (project.id)}
        {@const pr = { kind: 'project', id: project.id } as Route}
        <li use:dragItem={{ type: 'project', id: project.id }}>
          <a href={hrefFor(pr)} class="item pie" class:active={isActive(pr)} class:closed={project.status !== 'open'} use:dropTarget={project.status === 'open' ? moveHere({ projectId: project.id }) : null} {...menuOn({ kind: 'project', id: project.id })}>
            {#if project.repeat}<Icon name="repeat" size={14} color="var(--accent)" />{:else}<ProgressPie fraction={projectProgress($snapshot, project.id)} size={14} />{/if}
            <span class="label">{project.title || 'New Project'}</span>
          </a>
        </li>
      {/each}
    </ul>
  </div>

  <InstallNotice />
  <SyncStatus><VersionLink /></SyncStatus>
  <div class="footer">
    <div class="menu-wrap">
      <button type="button" class="btn-plain" aria-haspopup="menu" aria-expanded={menuOpen} bind:this={newListButton} onclick={() => (menuOpen = !menuOpen)} onkeydown={(e) => menuOpen && onNewListKey(e)}>
        <Icon name="plus" size={14} /> New List
      </button>
      {#if menuOpen}
        <div class="menu" role="menu" aria-label="New List" tabindex="-1" bind:this={newListMenu} onkeydown={onNewListKey}>
          <button type="button" role="menuitem" onclick={newProject}>New Project</button>
          <button type="button" role="menuitem" onclick={newArea}>New Area</button>
        </div>
      {/if}
    </div>
    <SiteLink page="home" class="btn-plain help" title="My Tasks website: guide, limitations, privacy" aria-label="My Tasks website">
      <Icon name="help" size={16} />
    </SiteLink>
    <a
      href={hrefFor({ kind: 'settings' })}
      class="btn-plain"
      class:active={isActive({ kind: 'settings' })}
      aria-label="Settings"
      title="Settings"
      aria-current={isActive({ kind: 'settings' }) ? 'page' : undefined}
    >
      <Icon name="settings" size={16} />
    </a>
  </div>
</nav>

{#if scheduling}
  <DropWhen {...scheduling} onclose={() => (scheduling = null)} />
{/if}

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--sidebar-bg);
    border-right: 1px solid var(--sidebar-border);
    /* 28 px rows; the names are larger (.item). */
    font-size: 13px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 16px 18px 10px;
  }
  .brand-text {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 1px;
  }
  .find {
    display: none;
    border: 0;
    background: transparent;
    padding: 10px;
    border-radius: var(--radius);
    color: var(--text-2);
  }
  @media (max-width: 767px) {
    .find {
      display: inline-flex;
    }
  }
  .brand-name {
    font-size: 17px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .brand-sub {
    font-size: 12px;
    color: var(--text-3);
  }
  .scroll {
    flex: 1;
    overflow-y: auto;
    padding: 0 10px 10px;
  }
  .lists {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .lists.gap {
    margin-top: 8px;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    border-radius: var(--radius);
    color: var(--text);
    text-decoration: none;
    min-height: 28px;
    /* Names (since 1.1.17); phones are below. */
    font-size: 16px;
    font-weight: 500;
  }
  .item > :global(svg:first-child) {
    width: 18px;
    height: 18px;
  }
  .item.pie > :global(svg:first-child) {
    width: 16px;
    height: 16px;
    margin-inline: 1px;
  }
  .item:hover {
    background: var(--hover-bg);
  }
  .item.active {
    background: var(--selected-bg);
  }
  .area-row {
    position: relative;
    margin-top: 8px;
  }
  /* Sits in the sidebar's left padding, so area and list icons stay aligned. */
  .disclose {
    position: absolute;
    left: -10px;
    top: 0;
    width: 14px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text-2);
  }
  @media (hover: hover) {
    .disclose {
      opacity: 0;
    }
    .area-row:hover .disclose,
    .disclose:focus-visible,
    .disclose.shut {
      opacity: 1;
    }
  }
  .item.project {
    padding-left: 18px;
  }
  .closed .label {
    color: var(--text-done);
    text-decoration: line-through;
  }
  .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .count {
    font-size: 13px;
    color: var(--text-2);
    font-weight: 400;
  }
  .count.due {
    color: var(--on-strong);
    background: var(--danger);
    border-radius: 999px;
    padding: 0 6px;
    font-weight: 600;
  }
  hr {
    border: 0;
    height: 1px;
    background: var(--divider);
    margin: 8px 6px;
  }
  .section-label {
    display: flex;
    align-items: center;
    gap: 6px;
    border: 0;
    background: transparent;
    color: var(--text-2);
    font-size: 11px;
    font-weight: 600;
    padding: 2px 8px;
  }
  .empty {
    margin: 2px 0 0;
    padding: 2px 8px 2px 26px;
    font-size: 12px;
    color: var(--text-3);
  }
  /*
   * Phones: the Home screen of lists, sized for touch
   * (since 1.1.15): 14.5 px semibold names on 34 px rows, 19 px icons
   * and 17 px progress pies. The Mac and iPad have 16 px medium names on 28 px rows.
   */
  @media (max-width: 767px) {
    .scroll .item {
      min-height: 34px;
      gap: 10px;
      font-size: 14.5px;
      font-weight: 600;
    }
    .scroll .item > :global(svg:first-child) {
      width: 19px;
      height: 19px;
    }
    .scroll .item.pie > :global(svg:first-child) {
      width: 17px;
      height: 17px;
      margin-inline: 1px;
    }
    .disclose {
      height: 34px;
    }
    .lists.gap,
    .area-row {
      margin-top: 10px;
    }
  }
  .footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px calc(8px + env(safe-area-inset-bottom));
    border-top: 1px solid var(--sidebar-border);
  }
  .menu-wrap {
    position: relative;
    margin-right: auto;
  }
  .menu {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 0;
    min-width: 160px;
    background: var(--surface);
    border-radius: 8px;
    box-shadow: var(--shadow-popover);
    padding: 4px;
    display: flex;
    flex-direction: column;
    z-index: var(--z-sidebar-menu);
  }
  .menu button {
    text-align: left;
    border: 0;
    background: transparent;
    padding: 8px 10px;
    border-radius: var(--radius);
  }
  .menu button:hover {
    background: var(--hover-bg);
  }
  .footer a.btn-plain.active {
    background: var(--selected-bg);
  }
</style>
