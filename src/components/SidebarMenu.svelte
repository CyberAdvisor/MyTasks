<!--
  The sidebar's right-click menu: right-click or Control-click a saved
  search, area or project, or press Shift+F10 or the Menu key on it.
  The built-in lists have none. One copy lives in App; `ui.sidebarMenu` says which item.

  - The items come from sidebarMenuItems (lib/model/sidebarMenu.ts), the
    same list the item's ⋯ menu draws; the commands are the ones that menu
    runs (lib/actions.ts), and its confirmations come from lib/dialogs.ts.
    Print… opens the item's page first, then prints it.
  - When…, Tags… and Deadline… replace the menu with that picker in the same
    place, so the page being shown doesn't change; so does a template's
    Repeat › submenu (FR-4.6).
  - Keyboard: Up/Down move, Enter chooses, Escape closes, as in RowMenu.
-->
<script lang="ts">
  import { tick, untrack } from 'svelte';
  import AreaPickerDialog from './AreaPickerDialog.svelte';
  import ChoiceDialog from './ChoiceDialog.svelte';
  import DeadlinePicker from './DeadlinePicker.svelte';
  import SavedSearchDialog from './SavedSearchDialog.svelte';
  import TagPicker from './TagPicker.svelte';
  import MenuItems from './MenuItems.svelte';
  import { printPage } from '../lib/print';
  import WhenPicker from './WhenPicker.svelte';
  import * as repo from '../lib/db/repo';
  import {
    deleteArea,
    deleteSavedSearch,
    duplicateProject,
    deleteProject,
    moveWaiting,
    newProjectInArea,
    projectRepeatAction,
    toggleAreaFocus,
  } from '../lib/actions';
  import { DELETE_AREA_DIALOG, DELETE_SAVED_SEARCH_DIALOG, completeProjectDialog } from '../lib/dialogs';
  import { openTaskCount, repeatingTaskCount, waitingInView } from '../lib/model/lists';
  import { projectRepeatItems, sidebarMenuItems, type ProjectRepeatAction, type SidebarMenuAction } from '../lib/model/sidebarMenu';
  import type { ID } from '../lib/model/types';
  import { MARGIN, clamp, closeOnOutside, focusItem, step } from '../lib/menuNav';
  import { focusedArea, snapshot, todayDate } from '../lib/state/live';
  import { go, route } from '../lib/state/route';
  import { ui } from '../lib/state/ui.svelte';

  /** A dialog the menu leads to; it stays open after the menu closes. */
  type Dialog =
    | { kind: 'complete'; id: ID; openCount: number; repeating: number }
    | { kind: 'move'; id: ID; areaId: ID | null }
    | { kind: 'delete-area'; id: ID }
    | { kind: 'edit-search'; id: ID }
    | { kind: 'delete-search'; id: ID };

  let panel = $state<'menu' | 'when' | 'tags' | 'deadline' | 'repeat'>('menu');
  let dialog = $state<Dialog | null>(null);
  let root = $state<HTMLDivElement>();
  let width = $state(0);
  let height = $state(0);
  let innerWidth = $state(0);
  let innerHeight = $state(0);
  /** Where focus was before the menu opened, to return it on Escape. */
  let returnFocus: HTMLElement | null = null;

  let menu = $derived(ui.sidebarMenu);
  let s = $derived($snapshot);
  let target = $derived(menu?.target);
  let project = $derived(target?.kind === 'project' ? s.projects.find((p) => p.id === target.id) : undefined);
  let area = $derived(target?.kind === 'area' ? s.areas.find((a) => a.id === target.id) : undefined);
  let saved = $derived(target?.kind === 'saved' ? s.savedSearches.find((x) => x.id === target.id) : undefined);
  /** The item still exists (another device may have deleted it). */
  let exists = $derived(!!(project || area || saved));
  let waiting = $derived(
    target && target.kind !== 'saved' ? waitingInView(s, target, $todayDate) : { todos: [], projects: [] },
  );
  let items = $derived(
    target
      ? sidebarMenuItems(target, {
          status: project?.status,
          hasTags: !!(project ?? area)?.tagIds.length,
          hasDeadline: !!project?.deadline,
          waiting: waiting.todos.length + waiting.projects.length > 0,
          sortByDate: project?.sortByDate,
          focused: !!area && area.id === $focusedArea,
          template: !!project?.repeat,
        })
      : [],
  );
  let label = $derived(
    project ? project.title || 'New Project' : area ? area.title || 'New Area' : (saved?.title || 'Saved Search'),
  );

  let left = $derived(menu ? clamp(menu.x, MARGIN, innerWidth - width - MARGIN) : 0);
  let top = $derived(menu ? clamp(menu.y, MARGIN, innerHeight - height - MARGIN) : 0);

  // Each time the menu opens: start at the menu. Opened from the keyboard,
  // its first item takes focus; with the mouse, the menu itself does.
  $effect(() => {
    const opened = ui.sidebarMenu;
    if (!opened) return;
    untrack(() => {
      panel = 'menu';
      returnFocus = document.activeElement as HTMLElement | null;
      void tick().then(() => (opened.keyboard ? focusItem(root, 0) : root?.focus()));
    });
  });

  // The menu closes when the view changes, or on a click outside, scrolling or leaving the window.
  $effect(() => {
    void $route;
    untrack(() => close(false));
  });
  $effect(() => {
    if (!ui.sidebarMenu) return;
    return closeOnOutside(() => [root], () => close(false));
  });

  function close(restoreFocus = true) {
    if (!ui.sidebarMenu) return;
    ui.sidebarMenu = null;
    if (restoreFocus) returnFocus?.focus();
  }

  function onMenuKey(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if ((panel === 'menu' || panel === 'repeat') && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      step(root!, e.key === 'ArrowDown' ? 1 : -1);
    }
  }

  /** Run a menu action. Pickers stay open in place; everything else closes the menu first. */
  function run(action: SidebarMenuAction) {
    const t = target!;
    if (action === 'when' || action === 'tags' || action === 'deadline' || action === 'repeat-menu') {
      panel = action === 'repeat-menu' ? 'repeat' : action;
      // The chosen item is gone: keep keyboard focus in the picker, so Escape still closes it.
      void tick().then(() => (root?.querySelector<HTMLElement>('input, button') ?? root)?.focus());
      return;
    }
    // Closing clears the target, and with it `project`: keep what's needed first.
    const p = project;
    close(false);
    const id = t.id;
    switch (action) {
      case 'complete': {
        const openCount = openTaskCount(s, id);
        const repeating = repeatingTaskCount(s, id);
        if (openCount > 0 || repeating > 0) dialog = { kind: 'complete', id, openCount, repeating };
        else void repo.closeProject(id, 'completed', 'completed');
        break;
      }
      case 'reopen':
        void repo.reopenProject(id);
        break;
      case 'move':
        dialog = { kind: 'move', id, areaId: p?.areaId ?? null };
        break;
      case 'duplicate':
        void duplicateProject(id);
        break;
      case 'repeat':
        ui.repeating = { kind: 'project', id };
        break;
      case 'sort-by-date':
        void repo.setProjectSortByDate(id, !p?.sortByDate);
        break;
      case 'new-project':
        void newProjectInArea(id);
        break;
      case 'focus':
        toggleAreaFocus(id);
        break;
      case 'move-to-completed':
        void moveWaiting(waiting);
        break;
      case 'edit-search':
        dialog = { kind: 'edit-search', id };
        break;
      case 'print':
        // Print the item's own page: open it, let it draw, then print.
        go(t);
        void tick().then(() => requestAnimationFrame(() => printPage()));
        break;
      case 'edit-rule':
      case 'create-next':
      case 'show-previous':
      case 'pause':
      case 'resume':
      case 'stop':
        void projectRepeatAction(id, action as ProjectRepeatAction);
        break;
      case 'delete':
        if (t.kind === 'project') void deleteProject(id);
        else if (t.kind === 'area') dialog = { kind: 'delete-area', id };
        else if (t.kind === 'saved') dialog = { kind: 'delete-search', id };
        break;
    }
  }

  /** A dialog's answer: carry out the choice, then close it. */
  function answer(d: Dialog, v: string | null) {
    dialog = null;
    if (d.kind === 'complete' && (v === 'complete' || v === 'cancel')) {
      void repo.closeProject(d.id, 'completed', v === 'complete' ? 'completed' : 'canceled');
    } else if (d.kind === 'delete-area' && (v === 'keep' || v === 'trash')) void deleteArea(d.id, v);
    else if (d.kind === 'delete-search' && v === 'delete') void deleteSavedSearch(d.id);
  }

  let editing = $derived.by(() => {
    const d = dialog;
    return d?.kind === 'edit-search' ? s.savedSearches.find((x) => x.id === d.id) : undefined;
  });
</script>

<svelte:window bind:innerWidth bind:innerHeight />

{#if menu && exists}
  <div
    class="sidemenu"
    role={panel === 'menu' || panel === 'repeat' ? 'menu' : 'dialog'}
    aria-label={panel === 'menu' ? `${label} actions` : panel === 'repeat' ? 'Repeat' : undefined}
    tabindex="-1"
    bind:this={root}
    bind:offsetWidth={width}
    bind:offsetHeight={height}
    style:left="{left}px"
    style:top="{top}px"
    onkeydown={onMenuKey}
    oncontextmenu={(e) => e.preventDefault()}
  >
    {#if panel === 'menu'}
      <MenuItems {items} onchoose={run} />
    {:else if panel === 'repeat' && project?.repeat}
      <MenuItems items={projectRepeatItems(project.repeat.paused)} onchoose={run} />
    {:else if panel === 'when' && project}
      <WhenPicker
        startDate={project.startDate}
        deferred={project.start === 'deferred'}
        deadline={project.deadline}
        ref={$todayDate}
        onchoose={(choice) => {
          void repo.setProjectWhen(project!.id, choice);
          close();
        }}
      />
    {:else if panel === 'deadline' && project}
      <DeadlinePicker
        deadline={project.deadline}
        when={project.startDate}
        noun="project"
        ref={$todayDate}
        onchoose={(deadline, moveWhen) => {
          void repo.setProjectDeadline(project!.id, deadline, moveWhen);
          close();
        }}
      />
    {:else if panel === 'tags' && (project || area)}
      {@const item = (project ?? area)!}
      <TagPicker
        tagIds={item.tagIds}
        ontoggle={(tagId, on) => repo.toggleTag(project ? 'projects' : 'areas', item.id, tagId, on)}
        ondone={() => close()}
      />
    {/if}
  </div>
{/if}

{#if dialog?.kind === 'complete'}
  {@const d = dialog}
  <ChoiceDialog {...completeProjectDialog(d.openCount, d.repeating)} onchoose={(v) => answer(d, v)} />
{:else if dialog?.kind === 'delete-area'}
  {@const d = dialog}
  <ChoiceDialog {...DELETE_AREA_DIALOG} onchoose={(v) => answer(d, v)} />
{:else if dialog?.kind === 'delete-search'}
  {@const d = dialog}
  <ChoiceDialog {...DELETE_SAVED_SEARCH_DIALOG} onchoose={(v) => answer(d, v)} />
{:else if dialog?.kind === 'move'}
  {@const d = dialog}
  <AreaPickerDialog
    current={d.areaId}
    onchoose={(areaId) => {
      dialog = null;
      if (areaId !== undefined) void repo.updateProject(d.id, { areaId });
    }}
  />
{:else if dialog?.kind === 'edit-search' && editing}
  {@const x = editing}
  <SavedSearchDialog
    title="Edit Saved Search"
    initial={{ title: x.title, query: x.query, tagIds: x.tagIds, contextId: x.contextId }}
    onsave={(fields) => {
      dialog = null;
      void repo.updateSavedSearch(x.id, fields);
    }}
    oncancel={() => (dialog = null)}
  />
{/if}

<style>
  /* The same look as the task right-click menu (RowMenu). */
  .sidemenu {
    position: fixed;
    z-index: var(--z-context-menu);
    min-width: 220px;
    max-height: calc(100vh - 16px);
    overflow-y: auto;
    padding: 4px;
    border-radius: 8px;
    background: var(--surface);
    box-shadow: var(--shadow-menu);
    display: flex;
    flex-direction: column;
    outline: none;
  }
</style>
