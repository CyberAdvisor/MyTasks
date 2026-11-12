<!--
  The to-do right-click menu (FR-1.7), as in Things for Mac. Opened by
  right-click or Control-click on a row, or Shift+F10 / the Menu key for the
  selected row. One copy lives in App; `ui.rowMenu` says which row.

  - The items come from todoMenuItems (lib/model/todoMenu.ts).
  - Priority, Context and Complete open submenus beside the menu.
  - When…, Deadline…, Tags… and Get Info replace the menu with that panel in
    the same place, without opening the card.
  - Keyboard: Up/Down move, Right opens a submenu, Left closes it, Enter
    chooses, Escape closes. Keys never reach the app's shortcuts meanwhile.
-->
<script lang="ts">
  import { tick, untrack } from 'svelte';
  import ChoiceDialog from './ChoiceDialog.svelte';
  import ContextMenu from './ContextMenu.svelte';
  import DeadlinePicker from './DeadlinePicker.svelte';
  import Icon from './Icon.svelte';
  import PriorityMenu from './PriorityMenu.svelte';
  import TagPicker from './TagPicker.svelte';
  import WhenPicker from './WhenPicker.svelte';
  import * as repo from '../lib/db/repo';
  import { containerLink, convertTodo, deleteTodoForever, goToContainer, moveWaiting, trashTodo } from '../lib/actions';
  import { formatTimestamp } from '../lib/model/dates';
  import { waitingInView } from '../lib/model/lists';
  import { completeChoices, todoMenuItems, type TodoMenuAction, type TodoSubmenu } from '../lib/model/todoMenu';
  import type { Todo } from '../lib/model/types';
  import { snapshot, todayDate } from '../lib/state/live';
  import { route, viewRefOf } from '../lib/state/route';
  import { ui } from '../lib/state/ui.svelte';

  /** Space kept between the menu and the window's edges. */
  const MARGIN = 8;
  /** Items a keyboard user can move between. */
  const ITEM = '[role^="menuitem"]:not(:disabled)';

  type Panel = 'menu' | 'when' | 'deadline' | 'tags' | 'info';

  let panel = $state<Panel>('menu');
  let sub = $state<TodoSubmenu | null>(null);
  /** Top of the item whose submenu is open. */
  let subTop = $state(0);
  let root = $state<HTMLDivElement>();
  let subEl = $state<HTMLDivElement>();
  let width = $state(0);
  let height = $state(0);
  let subWidth = $state(0);
  let subHeight = $state(0);
  let innerWidth = $state(0);
  let innerHeight = $state(0);
  /** The to-do waiting for the Delete Immediately confirmation. */
  let deleting = $state<Todo | null>(null);
  /** Where focus was before the menu opened, to return it on Escape. */
  let returnFocus: HTMLElement | null = null;

  let menu = $derived(ui.rowMenu);
  let todo = $derived(menu ? $snapshot.todos.find((t) => t.id === menu.id) : undefined);
  let link = $derived(todo ? containerLink(todo, $route) : null);
  let view = $derived(viewRefOf($route));
  let waiting = $derived(view ? waitingInView($snapshot, view, $todayDate) : { todos: [], projects: [] });
  let items = $derived(
    todo && menu
      ? todoMenuItems(todo, {
          mode: menu.mode,
          link: link?.kind ?? null,
          waiting: waiting.todos.length + waiting.projects.length > 0,
        })
      : [],
  );

  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));
  let left = $derived(menu ? clamp(menu.x, MARGIN, innerWidth - width - MARGIN) : 0);
  let top = $derived(menu ? clamp(menu.y, MARGIN, innerHeight - height - MARGIN) : 0);
  // The submenu opens to the right, or to the left when there is no room.
  let subLeft = $derived(
    left + width - 4 + subWidth > innerWidth - MARGIN ? left - subWidth + 4 : left + width - 4,
  );
  let subTopClamped = $derived(clamp(subTop - 5, MARGIN, innerHeight - subHeight - MARGIN));

  // Each time the menu opens: start at the menu itself. Opened from the
  // keyboard, its first item takes focus; opened with the mouse, the menu
  // does, with nothing highlighted, as in a native menu (Down then moves in).
  $effect(() => {
    const opened = ui.rowMenu;
    if (!opened) return;
    untrack(() => {
      panel = 'menu';
      sub = null;
      returnFocus = document.activeElement as HTMLElement | null;
      void tick().then(() => (opened.keyboard ? focusItem(root, 0) : root?.focus()));
    });
  });

  // The menu closes when the view changes (Show in Project, Manage Contexts…).
  $effect(() => {
    void $route;
    untrack(() => close(false));
  });

  // Close on a click outside, scrolling, or leaving the window.
  $effect(() => {
    if (!ui.rowMenu) return;
    const outside = (e: Event) => {
      const t = e.target as Node;
      if (root?.contains(t) || subEl?.contains(t)) return;
      close(false);
    };
    const away = () => close(false);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('scroll', outside, true);
    window.addEventListener('blur', away);
    window.addEventListener('resize', away);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('scroll', outside, true);
      window.removeEventListener('blur', away);
      window.removeEventListener('resize', away);
    };
  });

  // Shift+F10 or the Menu key opens the menu for the selected row.
  $effect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (ui.rowMenu || ui.expandedId || !ui.selectedId) return;
      if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return;
      if ((e.target as Element).closest?.('input, textarea, [contenteditable], dialog')) return;
      const row = document.querySelector(`[data-row-id="${CSS.escape(ui.selectedId)}"]`);
      if (!row) return;
      e.preventDefault();
      const r = row.getBoundingClientRect();
      ui.rowMenu = { id: ui.selectedId, mode: 'open', x: r.left + 40, y: r.bottom - 4, keyboard: true };
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  function close(restoreFocus = true) {
    if (!ui.rowMenu) return;
    ui.rowMenu = null;
    sub = null;
    if (restoreFocus) returnFocus?.focus();
  }

  /** Focus item `index` of a menu (negative counts from the end). */
  function focusItem(container: HTMLElement | undefined, index: number) {
    const list = container ? [...container.querySelectorAll<HTMLElement>(ITEM)] : [];
    list.at(index)?.focus();
  }

  /** Move focus up or down a menu, wrapping around. */
  function step(container: HTMLElement, by: number) {
    const list = [...container.querySelectorAll<HTMLElement>(ITEM)];
    const i = list.indexOf(document.activeElement as HTMLElement);
    // From the menu itself (nothing highlighted yet), Down goes to the first item and Up to the last.
    const next = i === -1 ? (by > 0 ? 0 : list.length - 1) : (i + by + list.length) % list.length;
    list[next]?.focus();
  }

  async function openSub(kind: TodoSubmenu, item: HTMLElement, focus: boolean) {
    subTop = item.getBoundingClientRect().top;
    sub = kind;
    if (focus) {
      await tick();
      focusItem(subEl, 0);
    }
  }

  function onMenuKey(e: KeyboardEvent) {
    e.stopPropagation();
    const target = e.target as HTMLElement;
    const inSub = !!subEl?.contains(target);
    if (e.key === 'Escape' || (e.key === 'ArrowLeft' && inSub)) {
      e.preventDefault();
      if (inSub) {
        sub = null;
        root?.querySelector<HTMLElement>('[aria-expanded="true"]')?.focus();
      } else close();
    } else if (panel !== 'menu') {
      return; // Pickers and Get Info handle their own keys.
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      step(inSub ? subEl! : root!, e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'ArrowRight' && target.dataset.submenu) {
      e.preventDefault();
      void openSub(target.dataset.submenu as TodoSubmenu, target, true);
    }
  }

  /** Run a menu action. Panels stay open in place; everything else closes the menu first. */
  function run(action: TodoMenuAction) {
    const t = todo!;
    if (action === 'when' || action === 'deadline' || action === 'tags' || action === 'info') {
      panel = action;
      sub = null;
      // The chosen item is gone: keep keyboard focus in the panel, so Escape still closes it.
      void tick().then(() => (root?.querySelector<HTMLElement>('input, button') ?? root)?.focus());
      return;
    }
    close(false);
    switch (action) {
      case 'move':
        ui.movingId = t.id;
        break;
      case 'duplicate':
        void repo.duplicateTodo(t.id);
        break;
      case 'convert':
        void convertTodo(t.id);
        break;
      case 'delete':
        void trashTodo(t.id);
        break;
      case 'remove':
        void repo.moveTodo(t.id, {}).then(() => ui.offerUndo(`Removed from ${t.projectId ? 'Project' : 'Area'}`));
        break;
      case 'show':
        goToContainer(t, $route);
        break;
      case 'move-to-completed':
        void moveWaiting(waiting);
        break;
      case 'put-back':
        void repo.setTodoTrashed(t.id, false);
        break;
      case 'delete-forever':
        deleting = t;
        break;
    }
  }

  /** Complete submenu: an open to-do is checked off as with its checkbox; others change at once. */
  function setStatus(status: Todo['status']) {
    const t = todo!;
    close(false);
    if (t.status === 'open' && status !== 'open') ui.check(t, status);
    else void repo.setTodoStatus(t.id, status);
  }
</script>

<svelte:window bind:innerWidth bind:innerHeight />

{#if menu && todo}
  <div
    class="rowmenu"
    role={panel === 'menu' ? 'menu' : 'dialog'}
    aria-label={panel === 'menu' ? `${todo.title || 'New To-Do'} actions` : undefined}
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
      {#each items as item, i (i)}
        {#if item.kind === 'separator'}
          <hr class="menu-sep" />
        {:else if item.kind === 'submenu'}
          <button
            type="button"
            class="menu-item"
            class:active={sub === item.submenu}
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={sub === item.submenu}
            data-submenu={item.submenu}
            onpointerenter={(e) => openSub(item.submenu, e.currentTarget, false)}
            onclick={(e) => openSub(item.submenu, e.currentTarget, true)}
          >
            <span>{item.label}</span><Icon name="chevron-right" size={13} />
          </button>
        {:else}
          <button
            type="button"
            class="menu-item"
            role="menuitem"
            disabled={item.disabled}
            onpointerenter={() => (sub = null)}
            onclick={() => run(item.action)}
          >
            <span>{item.label}</span>
          </button>
        {/if}
      {/each}
    {:else if panel === 'when'}
      <WhenPicker
        startDate={todo.startDate}
        deferred={todo.start === 'deferred'}
        ref={$todayDate}
        onchoose={(choice) => {
          void repo.setWhen(todo!.id, choice);
          close();
        }}
      />
    {:else if panel === 'deadline'}
      <DeadlinePicker
        deadline={todo.deadline}
        ref={$todayDate}
        onchoose={(deadline) => {
          void repo.setDeadline(todo!.id, deadline);
          close();
        }}
      />
    {:else if panel === 'tags'}
      <TagPicker
        tagIds={todo.tagIds}
        ontoggle={(tagId, on) => repo.toggleTag('todos', todo!.id, tagId, on)}
        ondone={() => close()}
      />
    {:else}
      <div class="info">
        <p class="info-title">{todo.title || 'New To-Do'}</p>
        <dl>
          <dt>Created</dt><dd>{formatTimestamp(todo.createdAt)}</dd>
          <dt>Modified</dt><dd>{formatTimestamp(todo.modifiedAt)}</dd>
          {#if todo.completedAt}
            <dt>{todo.status === 'canceled' ? 'Canceled' : 'Completed'}</dt><dd>{formatTimestamp(todo.completedAt)}</dd>
          {/if}
          {#if todo.trashedAt}
            <dt>Deleted</dt><dd>{formatTimestamp(todo.trashedAt)}</dd>
          {/if}
        </dl>
      </div>
    {/if}
  </div>

  {#if sub && panel === 'menu'}
    <div
      class="rowmenu"
      role="menu"
      tabindex="-1"
      aria-label={sub === 'complete' ? 'Complete' : sub === 'priority' ? 'Priority' : 'Context'}
      bind:this={subEl}
      bind:offsetWidth={subWidth}
      bind:offsetHeight={subHeight}
      style:left="{subLeft}px"
      style:top="{subTopClamped}px"
      onkeydown={onMenuKey}
      oncontextmenu={(e) => e.preventDefault()}
    >
      {#if sub === 'complete'}
        {#each completeChoices(todo.status) as choice (choice.status)}
          <button type="button" class="menu-item" role="menuitem" onclick={() => setStatus(choice.status)}>
            <span>{choice.label}</span>
          </button>
        {/each}
      {:else if sub === 'priority'}
        <PriorityMenu
          priority={todo.priority}
          onchoose={(p) => {
            void repo.setPriority(todo!.id, p);
            close();
          }}
        />
      {:else}
        <ContextMenu
          contextId={todo.contextId}
          onchoose={(c) => {
            void repo.setContext(todo!.id, c);
            close();
          }}
        />
      {/if}
    </div>
  {/if}
{/if}

{#if deleting}
  <ChoiceDialog
    title="Delete Immediately?"
    message={`“${deleting.title || 'New To-Do'}” will be deleted permanently. This cannot be undone.`}
    choices={[{ label: 'Delete', value: 'delete', danger: true }]}
    onchoose={(v) => {
      if (v === 'delete') void deleteTodoForever(deleting!.id);
      deleting = null;
    }}
  />
{/if}

<style>
  .rowmenu {
    position: fixed;
    z-index: 60;
    min-width: 220px;
    max-height: calc(100vh - 16px);
    overflow-y: auto;
    padding: 4px;
    border-radius: 8px;
    background: var(--surface);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.22);
    display: flex;
    flex-direction: column;
    outline: none;
  }
  .rowmenu > .menu-item {
    justify-content: space-between;
  }
  .info {
    padding: 8px 10px 6px;
    font-size: 13px;
    min-width: 260px;
  }
  .info-title {
    margin: 0 0 8px;
    font-weight: 600;
    font-size: 14px;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 14px;
    margin: 0;
  }
  dt {
    color: var(--text-3);
  }
  dd {
    margin: 0;
  }
</style>
