<!--
  The to-do menu (FR-1.7). Opened by right-click or
  Control-click on a row, Shift+F10 / the Menu key for the selected row, the
  ⋯ on an open card, or a tap on a Trash row on touch. One copy lives in App;
  `ui.rowMenu` says which row.

  - The items come from todoMenuItems (lib/model/todoMenu.ts).
  - Priority, Context and Complete open submenus beside the menu.
  - When…, Deadline…, Tags… and Get Info replace the menu with that panel in
    the same place, without opening the card.
  - On phones (under 768 px) the menu is a sheet along the bottom of the
    screen, titled with the task, over a dimmed backdrop that closes it, as
    the pickers are (Section 6). A submenu replaces the list, with ‹ Back.
  - Keyboard: Up/Down move, Right opens a submenu, Left closes it, Enter
    chooses, Escape closes. Keys never reach the app's shortcuts meanwhile.
  - Opened on a row of a selection of several (FR-10.1), it is the menu for
    all of them (severalMenuItems), and each choice changes them all as one
    undo step (lib/bulk.ts). A keyboard picker command for several opens it
    straight at that picker (`ui.rowMenu.panel`).
  - In Select mode on touch (FR-10.2), opened from the floating bar, it acts
    on the selected tasks, even just one, and its items are
    selectModeMenuItems.
-->
<script lang="ts">
  import { isPhoneWidth } from '../lib/breakpoints';
  import { tick, untrack } from 'svelte';
  import ChoiceDialog from './ChoiceDialog.svelte';
  import ContextMenu from './ContextMenu.svelte';
  import DeadlinePicker from './DeadlinePicker.svelte';
  import Icon from './Icon.svelte';
  import PriorityMenu from './PriorityMenu.svelte';
  import TagPicker from './TagPicker.svelte';
  import WhenPicker from './WhenPicker.svelte';
  import * as repo from '../lib/db/repo';
  import { changeDeadline, changeStatus, changeWhen, containerLink, convertTodo, deleteTodoForever, goToContainer, moveWaiting, revealTodo, trashTodo, trashTodos } from '../lib/actions';
  import * as bulk from '../lib/bulk';
  import { selectedIds } from '../lib/commands';
  import { formatTimestamp } from '../lib/model/dates';
  import { waitingInView } from '../lib/model/lists';
  import { completeChoices, completeChoicesFor, repeatSubmenuItems, selectModeMenuItems, severalMenuItems, todoMenuItems, type TodoMenuAction, type TodoSubmenu } from '../lib/model/todoMenu';
  import type { ID, Todo } from '../lib/model/types';
  import { settings, snapshot, todayDate, todoById } from '../lib/state/live';
  import { route, viewRefOf } from '../lib/state/route';
  import { ui } from '../lib/state/ui.svelte';
  import { MARGIN, clamp, closeOnOutside, focusItem, step } from '../lib/menuNav';

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
  /** The repeating task waiting for the Stop confirmation (FR-4.4). */
  let stopping = $state<Todo | null>(null);
  /** Where focus was before the menu opened, to return it on Escape. */
  let returnFocus: HTMLElement | null = null;

  let menu = $derived(ui.rowMenu);
  let todo = $derived(menu ? $snapshot.todos.find((t) => t.id === menu.id) : undefined);
  /**
   * With several tasks selected and the menu opened on one of them, or in
   * Select mode (FR-10.2): the selected tasks (FR-10.1); else empty.
   */
  let several = $derived(
    menu?.mode === 'open' && (ui.multiple || ui.selecting) && ui.isSelected(menu.id) ? ui.selectedTodos($todoById) : [],
  );
  /** The menu acts on the selection, through lib/bulk.ts. */
  let many = $derived(several.length > 1 || (ui.selecting && several.length > 0));
  /** What the sheet and the menu are named for: "3 tasks", or the one task's title. */
  let name = $derived(several.length > 1 ? `${several.length} tasks` : todo?.title || 'New Task');
  let link = $derived(todo ? containerLink(todo, $route) : null);
  let view = $derived(viewRefOf($route));
  /** Tasks Reset Other Tasks… would return (FR-17.6); the item shows only when there are some. */
  let toReset = $derived(todo && menu?.mode === 'open' ? repo.tasksToReset(todo, $snapshot, $settings) : []);
  /** The to-do waiting for the Reset Other Tasks confirmation, with the tasks it returns. */
  let resetting = $state<{ todo: Todo; others: Todo[] } | null>(null);
  let waiting = $derived(view ? waitingInView($snapshot, view, $todayDate) : { todos: [], projects: [] });
  let items = $derived(
    many && ui.selecting
      ? selectModeMenuItems(several.map((t) => t.status))
      : many
      ? severalMenuItems(several, { waiting: waiting.todos.length + waiting.projects.length > 0 })
      : todo && menu
      ? todoMenuItems(todo, {
          mode: menu.mode,
          link: link?.kind ?? null,
          waiting: waiting.todos.length + waiting.projects.length > 0,
          resetOthers: toReset.length > 0,
        })
      : [],
  );

  /** Phones show the menu as a sheet along the bottom (Section 6). */
  let sheet = $derived(innerWidth > 0 && isPhoneWidth(innerWidth));
  let left = $derived(menu ? clamp(menu.alignEnd ? menu.x - width : menu.x, MARGIN, innerWidth - width - MARGIN) : 0);
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
      panel = opened.panel ?? 'menu';
      // A phone's sheet can open straight into a submenu: a template's repeat line opens Repeat (FR-4.4).
      sub = opened.submenu ?? null;
      returnFocus = document.activeElement as HTMLElement | null;
      // On touch, a picker's date field isn't focused, so the keyboard stays down (Select mode's Start Date, FR-10.2).
      const coarse = matchMedia('(pointer: coarse)').matches;
      void tick().then(() =>
        opened.panel
          ? (coarse ? root : (root?.querySelector<HTMLElement>('input, button') ?? root))?.focus()
          : opened.keyboard
            ? focusItem(root, 0)
            : root?.focus(),
      );
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
    return closeOnOutside(() => [root, subEl], () => close(false));
  });

  // Shift+F10 or the Menu key opens the menu for the selected row.
  $effect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || ui.rowMenu || ui.expandedId || !ui.selectedId) return;
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

  async function openSub(kind: TodoSubmenu, item: HTMLElement, focus: boolean) {
    subTop = item.getBoundingClientRect().top;
    sub = kind;
    if (focus) {
      await tick();
      // On a sheet the submenu takes the list's place in the menu itself.
      focusItem(sheet ? root : subEl, sheet ? 1 : 0);
    }
  }

  /** Leave a submenu, returning focus to the item that opened it. */
  async function closeSub() {
    const kind = sub;
    sub = null;
    await tick();
    root?.querySelector<HTMLElement>(`[data-submenu="${kind}"]`)?.focus();
  }

  function onMenuKey(e: KeyboardEvent) {
    e.stopPropagation();
    const target = e.target as HTMLElement;
    const inSub = sheet ? sub !== null : !!subEl?.contains(target);
    if (e.key === 'Escape' || (e.key === 'ArrowLeft' && inSub)) {
      e.preventDefault();
      if (inSub) void closeSub();
      else close();
    } else if (panel !== 'menu') {
      return; // Pickers and Get Info handle their own keys.
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      step(inSub && !sheet ? subEl! : root!, e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'ArrowRight' && target.dataset.submenu) {
      e.preventDefault();
      void openSub(target.dataset.submenu as TodoSubmenu, target, true);
    }
  }

  /** Run a menu action. Panels stay open in place; everything else closes the menu first. */
  function run(action: TodoMenuAction) {
    const t = todo!;
    // Read before closing: closing the menu clears what it was opened for.
    const others = toReset;
    if (action === 'when' || action === 'deadline' || action === 'tags' || action === 'info') {
      panel = action;
      sub = null;
      // The chosen item is gone: keep keyboard focus in the panel, so Escape still closes it.
      void tick().then(() => (root?.querySelector<HTMLElement>('input, button') ?? root)?.focus());
      return;
    }
    // Read the selection before closing: closing clears what the menu was opened for.
    const chosen = many ? ids() : [];
    const first = several[0];
    const allDone = several.every((x) => x.status !== 'open');
    close(false);
    if (chosen.length) return runOnSeveral(action, chosen, first, allDone);
    switch (action) {
      case 'move':
        ui.movingIds = [t.id];
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
      case 'reset-others':
        resetting = { todo: t, others };
        break;
      case 'repeat':
      case 'edit-rule':
        ui.repeating = { kind: 'todo', id: t.id };
        break;
      case 'pause':
      case 'resume':
        void repo.setRepeatPaused(t.id, action === 'pause');
        break;
      case 'stop':
        stopping = t;
        break;
      case 'create-next':
        void repo.createNextCopy(t.id);
        break;
      case 'show-previous':
        void repo.previousCopy(t.id).then((c) => c && revealTodo(c, $route, $todayDate));
        break;
    }
  }

  /** The selected tasks the menu acts on, in screen order. */
  function ids(): ID[] {
    return selectedIds().filter((id) => several.some((t) => t.id === id));
  }

  /**
   * Run a menu action on the selected several (the panels were handled
   * before); `first` names Remove From's container, and `allDone` makes
   * Select mode's Mark as Completed reopen them.
   */
  function runOnSeveral(action: TodoMenuAction, chosen: ID[], first: Todo, allDone: boolean) {
    switch (action) {
      case 'complete':
        void changeStatus(chosen, allDone ? 'open' : 'completed');
        break;
      case 'move':
        ui.movingIds = chosen;
        break;
      case 'duplicate':
        void bulk.duplicate(chosen);
        break;
      case 'delete':
        void trashTodos(chosen);
        break;
      case 'remove': {
        const from = first.projectId ? 'Project' : 'Area';
        void bulk.removeFromContainer(chosen).then(() => ui.offerUndo(`Removed ${chosen.length} tasks from ${from}`));
        break;
      }
      case 'move-to-completed':
        void moveWaiting(waiting);
        break;
    }
  }

  /** Complete submenu: an open to-do is checked off as with its checkbox; others change at once. */
  function setStatus(status: Todo['status']) {
    const t = todo!;
    const chosen = many ? ids() : [];
    close(false);
    if (chosen.length) {
      void changeStatus(chosen, status);
      return;
    }
    if (t.status === 'open' && status !== 'open') ui.check(t, status);
    else void repo.setTodoStatus(t.id, status);
  }
</script>

<svelte:window bind:innerWidth bind:innerHeight />

{#snippet subItems(kind: TodoSubmenu, t: Todo)}
  {#if kind === 'repeat'}
    {#each repeatSubmenuItems(t.repeat?.paused ?? false) as item, i (i)}
      {#if item.kind === 'separator'}
        <hr class="menu-sep" />
      {:else if item.kind === 'action'}
        <button type="button" class="menu-item" role="menuitem" onclick={() => run(item.action)}>
          <span>{item.label}</span>
        </button>
      {/if}
    {/each}
  {:else if kind === 'complete'}
    {#each many ? completeChoicesFor(several.map((x) => x.status)) : completeChoices(t.status) as choice (choice.status)}
      <button type="button" class="menu-item" role="menuitem" onclick={() => setStatus(choice.status)}>
        <span>{choice.label}</span>
      </button>
    {/each}
  {:else if kind === 'priority'}
    <PriorityMenu
      priority={many ? bulk.shared(several, (x) => x.priority) : t.priority}
      onchoose={(p) => {
        void (many ? bulk.setPriority(ids(), p) : repo.setPriority(t.id, p));
        close();
      }}
    />
  {:else}
    <ContextMenu
      contextId={many ? bulk.shared(several, (x) => x.contextId) : t.contextId}
      onchoose={(c) => {
        void (many ? bulk.setContext(ids(), c) : repo.setContext(t.id, c));
        close();
      }}
    />
  {/if}
{/snippet}

{#if menu && todo}
  {#if sheet}
    <!-- Phones: the dimmed screen behind the sheet; a tap on it closes the menu (closeOnOutside). -->
    <div class="rowmenu-backdrop" aria-hidden="true"></div>
  {/if}
  <div
    class="rowmenu"
    class:sheet
    role={panel === 'menu' ? 'menu' : 'dialog'}
    aria-label={panel === 'menu' ? `${name} actions` : undefined}
    tabindex="-1"
    bind:this={root}
    bind:offsetWidth={width}
    bind:offsetHeight={height}
    style:left={sheet ? null : `${left}px`}
    style:top={sheet ? null : `${top}px`}
    onkeydown={onMenuKey}
    oncontextmenu={(e) => e.preventDefault()}
  >
    {#if sheet}
      <div class="sheet-title" aria-hidden="true">{name}</div>
    {/if}
    {#if panel === 'menu' && sheet && sub}
      <button type="button" class="menu-item back" role="menuitem" onclick={() => void closeSub()}>
        <span><Icon name="chevron-left" size={13} /> Back</span>
      </button>
      {@render subItems(sub, todo)}
    {:else if panel === 'menu'}
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
            onpointerenter={(e) => !sheet && openSub(item.submenu, e.currentTarget, false)}
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
            onpointerenter={() => !sheet && (sub = null)}
            onclick={() => run(item.action)}
          >
            <span>{item.label}</span>
          </button>
        {/if}
      {/each}
    {:else if panel === 'when' && many}
      <WhenPicker
        startDate={bulk.shared(several, (x) => x.startDate) ?? null}
        deferred={several.every((x) => x.start === 'deferred')}
        deadline={bulk.earliestDeadline(several)}
        ref={$todayDate}
        onchoose={(choice) => {
          void changeWhen(ids(), choice);
          close();
        }}
      />
    {:else if panel === 'when'}
      <WhenPicker
        startDate={todo.startDate}
        deferred={todo.start === 'deferred'}
        deadline={todo.deadline}
        ref={$todayDate}
        onchoose={(choice) => {
          void changeWhen([todo!.id], choice);
          close();
        }}
      />
    {:else if panel === 'deadline' && many}
      <DeadlinePicker
        deadline={bulk.shared(several, (x) => x.deadline) ?? null}
        when={bulk.latestStart(several)}
        noun="tasks"
        ref={$todayDate}
        onchoose={(deadline, moveWhen) => {
          void changeDeadline(ids(), deadline, moveWhen);
          close();
        }}
      />
    {:else if panel === 'deadline'}
      <DeadlinePicker
        deadline={todo.deadline}
        when={todo.startDate}
        ref={$todayDate}
        onchoose={(deadline, moveWhen) => {
          void changeDeadline([todo!.id], deadline, moveWhen);
          close();
        }}
      />
    {:else if panel === 'tags' && many}
      {@const tags = bulk.tagsOf(several)}
      <TagPicker tagIds={tags.all} someIds={tags.some} ontoggle={(tagId, on) => bulk.setTag(ids(), tagId, on)} ondone={() => close()} />
    {:else if panel === 'tags'}
      <TagPicker
        tagIds={todo.tagIds}
        ontoggle={(tagId, on) => repo.toggleTag('todos', todo!.id, tagId, on)}
        ondone={() => close()}
      />
    {:else}
      <div class="info">
        <p class="info-title">{todo.title || 'New Task'}</p>
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

  {#if sub && panel === 'menu' && !sheet}
    <div
      class="rowmenu"
      role="menu"
      tabindex="-1"
      aria-label={{ complete: 'Complete', priority: 'Priority', context: 'Context', repeat: 'Repeat' }[sub]}
      bind:this={subEl}
      bind:offsetWidth={subWidth}
      bind:offsetHeight={subHeight}
      style:left="{subLeft}px"
      style:top="{subTopClamped}px"
      onkeydown={onMenuKey}
      oncontextmenu={(e) => e.preventDefault()}
    >
      {@render subItems(sub, todo)}
    </div>
  {/if}
{/if}

{#if resetting}
  <ChoiceDialog
    title="Reset other tasks?"
    message={`Keeps “${resetting.todo.title || 'New Task'}” in Today and returns these tasks to where they were:`}
    points={resetting.others.map((o) => o.title || 'New Task')}
    note="Tasks with a deadline stay in Today."
    choices={[{ label: 'Reset Others', value: 'reset' }]}
    onchoose={(v) => {
      if (v === 'reset') void repo.resetOtherTasks(resetting!.others.map((o) => o.id));
      resetting = null;
    }}
  />
{/if}

{#if stopping}
  <ChoiceDialog
    title="Stop repeating?"
    message={`“${stopping.title || 'New Task'}” and the copies it has made become ordinary tasks. No more copies are made.`}
    choices={[{ label: 'Stop It', value: 'stop', danger: true }]}
    onchoose={(v) => {
      if (v === 'stop') void repo.stopRepeat(stopping!.id);
      stopping = null;
    }}
  />
{/if}

{#if deleting}
  <ChoiceDialog
    title="Delete Immediately?"
    message={`“${deleting.title || 'New Task'}” will be deleted permanently. This cannot be undone.`}
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
  .sheet-title {
    display: none;
  }

  /* Phones: a sheet along the bottom of the screen, as the pickers are (Popover.svelte). */
  .rowmenu-backdrop {
    display: block;
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.38);
    z-index: var(--z-sheet-backdrop);
  }
  .rowmenu.sheet {
    left: 0;
    right: 0;
    bottom: 0;
    max-height: 75vh;
    border-radius: 16px 16px 0 0;
    padding: 10px 16px calc(16px + env(safe-area-inset-bottom));
    z-index: var(--z-sheet);
  }
  .sheet .sheet-title {
    display: block;
    font-weight: 600;
    text-align: center;
    margin-bottom: 8px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sheet :global(.menu-item) {
    min-height: 44px;
    font-size: 15px;
  }
  .sheet > :global(*:not(.sheet-title)) {
    width: 100%;
    max-width: 320px;
    margin-inline: auto;
  }
  .back {
    color: var(--accent);
  }
</style>
