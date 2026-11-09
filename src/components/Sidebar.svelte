<!--
  Sidebar (design doc, Section 3 "Sidebar layout"): app header, built-in
  lists with counts, collapsible Saved Searches, then areas and projects.
-->
<script lang="ts">
  import Icon from './Icon.svelte';
  import ProgressPie from './ProgressPie.svelte';
  import { snapshot, todayDate } from '../lib/state/live';
  import { route, go, hrefFor, type Route } from '../lib/state/route';
  import { areaProjects, projectProgress, sidebarCounts, type BuiltInList } from '../lib/model/lists';
  import { bySortKey } from '../lib/model/order';
  import { LIST_META } from '../lib/listMeta';
  import { openMatchCount, savedSearchesInOrder } from '../lib/model/search';
  import { ui } from '../lib/state/ui.svelte';
  import * as repo from '../lib/db/repo';

  const SAVED_KEY = 'mytasks.savedSearchesCollapsed';

  let counts = $derived(sidebarCounts($snapshot, $todayDate));
  let areas = $derived(bySortKey($snapshot.areas));
  let looseProjects = $derived(areaProjects($snapshot, null));
  let saved = $derived(savedSearchesInOrder($snapshot));
  let savedCollapsed = $state(readFlag(SAVED_KEY));
  let menuOpen = $state(false);

  /** Read a remembered boolean; storage can be unavailable in some contexts. */
  function readFlag(key: string): boolean {
    try {
      return localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  }

  function toggleSaved() {
    savedCollapsed = !savedCollapsed;
    try {
      localStorage.setItem(SAVED_KEY, savedCollapsed ? '1' : '0');
    } catch {
      /* not remembered; harmless */
    }
  }

  /** Is this route the one currently shown? */
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

  const groups: BuiltInList[][] = [['inbox'], ['today', 'scheduled', 'unscheduled', 'deferred'], ['logbook', 'trash']];
</script>

<nav class="sidebar" aria-label="Lists">
  <div class="brand">
    <svg width="32" height="32" viewBox="0 0 32 32" role="img" aria-label="My Tasks logo">
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <path d="M9 16.5l4.5 4.5L23 11" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
    <div class="brand-text">
      <span class="brand-name">My Tasks</span>
      <span class="brand-sub">Getting Tasks Done Daily</span>
    </div>
    <!-- Phones have no toolbar, so Quick Find opens from here. -->
    <button type="button" class="find" aria-label="Quick Find" title="Quick Find" onclick={() => ui.openFind()}>
      <Icon name="search" size={20} />
    </button>
  </div>

  <div class="scroll">
    {#each groups as group, gi (gi)}
      <ul class="lists" class:gap={gi > 0}>
        {#each group as list (list)}
          {@const meta = LIST_META[list]}
          {@const r = { kind: 'list', list } as Route}
          <li>
            <a href={hrefFor(r)} class="item" class:active={isActive(r)} aria-current={isActive(r) ? 'page' : undefined}>
              <Icon name={meta.icon} color={meta.color} />
              <span class="label">{meta.title}</span>
              {#if list === 'inbox' && counts.inbox}<span class="count">{counts.inbox}</span>{/if}
              {#if list === 'today' && counts.today}
                {#if counts.due}<span class="count due" title="Due or overdue">{counts.due}</span>{/if}
                <span class="count">{counts.today}</span>
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
        <ul class="lists">
          {#each saved as x (x.id)}
            {@const r = { kind: 'saved', id: x.id } as Route}
            {@const count = openMatchCount($snapshot, x)}
            <li>
              <a href={hrefFor(r)} class="item" class:active={isActive(r)} aria-current={isActive(r) ? 'page' : undefined}>
                <Icon name="search" color="var(--text-2)" />
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

    {#each areas as area (area.id)}
      {@const r = { kind: 'area', id: area.id } as Route}
      <a href={hrefFor(r)} class="item area" class:active={isActive(r)}>
        <Icon name="area" color="var(--text-2)" />
        <span class="label">{area.title || 'New Area'}</span>
      </a>
      <ul class="lists">
        {#each areaProjects($snapshot, area.id) as project (project.id)}
          {@const pr = { kind: 'project', id: project.id } as Route}
          <li>
            <a href={hrefFor(pr)} class="item project" class:active={isActive(pr)}>
              <ProgressPie fraction={projectProgress($snapshot, project.id)} />
              <span class="label">{project.title || 'New Project'}</span>
            </a>
          </li>
        {/each}
      </ul>
    {/each}

    {#if looseProjects.length}
      <ul class="lists gap">
        {#each looseProjects as project (project.id)}
          {@const pr = { kind: 'project', id: project.id } as Route}
          <li>
            <a href={hrefFor(pr)} class="item" class:active={isActive(pr)}>
              <ProgressPie fraction={projectProgress($snapshot, project.id)} />
              <span class="label">{project.title || 'New Project'}</span>
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <div class="footer">
    <div class="menu-wrap">
      <button type="button" class="btn-plain" aria-haspopup="menu" aria-expanded={menuOpen} onclick={() => (menuOpen = !menuOpen)}>
        <Icon name="plus" size={14} /> New List
      </button>
      {#if menuOpen}
        <div class="menu" role="menu">
          <button type="button" role="menuitem" onclick={newProject}>New Project</button>
          <button type="button" role="menuitem" onclick={newArea}>New Area</button>
        </div>
      {/if}
    </div>
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

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--sidebar-bg);
    border-right: 1px solid var(--sidebar-border);
    font-size: 14px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 18px 20px 14px;
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
    margin-top: 12px;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    border-radius: var(--radius);
    color: var(--text);
    text-decoration: none;
    min-height: 32px;
  }
  .item:hover {
    background: var(--hover-bg);
  }
  .item.active {
    background: var(--selected-bg);
    font-weight: 600;
  }
  .item.area {
    font-weight: 600;
    margin-top: 10px;
  }
  .item.project {
    padding-left: 20px;
  }
  .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .count {
    font-size: 12px;
    color: var(--text-3);
    font-weight: 400;
  }
  .count.due {
    color: #fff;
    background: var(--danger);
    border-radius: 999px;
    padding: 0 6px;
    font-weight: 600;
  }
  hr {
    border: 0;
    height: 1px;
    background: #d9d9de;
    margin: 10px 6px;
  }
  .section-label {
    display: flex;
    align-items: center;
    gap: 6px;
    border: 0;
    background: transparent;
    color: var(--text-2);
    font-size: 12px;
    font-weight: 600;
    padding: 4px 10px;
  }
  .empty {
    margin: 2px 0 0;
    padding: 4px 10px 4px 28px;
    font-size: 13px;
    color: var(--text-3);
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
  }
  .menu {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 0;
    min-width: 160px;
    background: #fff;
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
    padding: 4px;
    display: flex;
    flex-direction: column;
    z-index: 10;
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
