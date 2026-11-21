/**
 * Runs keyboard commands (design doc, Section 7). `shortcuts.ts` decides which
 * command a key means; this module carries it out against the current view.
 *
 * Item commands act on the open card's to-do, or else the selected rows:
 * with several selected, on all of them at once (FR-10.1).
 */
import { get } from 'svelte/store';
import * as repo from './db/repo';
import { moveByKeyboard } from './drag/drag';
import { canAddHere, changeStatus, changeWhen, newHeading, newTodoInline, openQuickEntry, trashTodos } from './actions';
import { isListed, type BuiltInList, type TodayGrouping } from './model/lists';
import { nextTagFilter } from './model/tags';
import type { ID, LocalDate, Priority, Todo } from './model/types';
import * as bulk from './bulk';
import { extend, inOrder, selectAll, single } from './model/selection';
import { rowLimit } from './state/rowLimit.svelte';
import { settings, snapshot, todayDate } from './state/live';
import { go, route } from './state/route';
import { ui, type CardCommand } from './state/ui.svelte';
import type { Command } from './shortcuts';

const GO: Partial<Record<Command, BuiltInList>> = {
  'go-inbox': 'inbox',
  'go-today': 'today',
  'go-scheduled': 'scheduled',
  'go-unscheduled': 'unscheduled',
  'go-deferred': 'deferred',
  'go-logbook': 'logbook',
  'go-trash': 'trash',
};

const CARD: Partial<Record<Command, CardCommand>> = {
  when: 'when',
  deadline: 'deadline',
  tags: 'tags',
  checklist: 'checklist',
};

const GROUPING_CYCLE: TodayGrouping[] = ['none', 'project', 'priority', 'context'];

/** The rows of the current view, in screen order. */
function rows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('main [data-row-id]')];
}

/** The ids of the current view's rows, in screen order. */
export function rowIds(): ID[] {
  return rows().map((el) => el.dataset.rowId!);
}

/** The selected tasks still on screen, in screen order: what a command for several acts on (FR-10.1). */
export function selectedIds(): ID[] {
  return inOrder(ui.selection, rowIds());
}

/** The row element of a to-do in the current view. */
function rowOf(id: string): HTMLElement | undefined {
  return rows().find((el) => el.dataset.rowId === id);
}

/**
 * The to-do item commands act on: the open card's, else the selected row's.
 * A completed to-do still waiting in its list counts (FR-12.2).
 */
function target(): Todo | undefined {
  const id = ui.expandedId ?? (ui.selectedId && rowOf(ui.selectedId) ? ui.selectedId : null);
  return get(snapshot).todos.find((t) => t.id === id && isListed(t));
}

/** Going down from the last row drawn (NFR-7): draw the rest of the list first. */
function drawPastEnd(): void {
  const ids = rowIds();
  if (ui.selectedId && ids[ids.length - 1] === ui.selectedId) rowLimit.drawAll();
}

/** Move the selection to the previous (-1) or next (+1) row and focus it. */
function selectNext(delta: number): void {
  if (delta > 0) drawPastEnd();
  const list = rows();
  if (!list.length) return;
  const i = list.findIndex((el) => el.dataset.rowId === ui.selectedId);
  const j = i < 0 ? (delta > 0 ? 0 : list.length - 1) : Math.max(0, Math.min(list.length - 1, i + delta));
  const el = list[j];
  ui.selectedId = el.dataset.rowId!;
  el.querySelector<HTMLElement>('.body')?.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'nearest' });
}

/** Shift+Up (-1) or Shift+Down (+1): grow or shrink the selection from its anchor (FR-10.1). */
function extendSelection(delta: -1 | 1): boolean {
  if (delta > 0) drawPastEnd();
  const order = rowIds();
  if (!order.length || ui.expandedId) return false;
  ui.selection = extend(ui.selection, order, delta);
  const el = rows().find((r) => r.dataset.rowId === ui.selectedId);
  el?.querySelector<HTMLElement>('.body')?.focus({ preventScroll: true });
  el?.scrollIntoView({ block: 'nearest' });
  return true;
}

/**
 * An item command with several tasks selected (FR-10.1): it acts on all of
 * them, as one undo step. Pickers open in the menu for the selection, as
 * from a right-click. Commands for one task (open, move up or down, the
 * checklist) do nothing.
 */
function runOnSeveral(command: Command, ids: ID[], ref: LocalDate): boolean {
  const todos = ids.map((id) => get(snapshot).todos.find((t) => t.id === id)!);
  const card = CARD[command];
  if (card === 'when' || card === 'deadline' || card === 'tags') {
    const el = rows().find((r) => r.dataset.rowId === ui.selectedId) ?? rows().find((r) => r.dataset.rowId === ids[0]);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    ui.rowMenu = { id: el.dataset.rowId!, mode: 'open', x: r.left + 40, y: r.bottom - 4, keyboard: true, panel: card };
    return true;
  }
  const inToday = (t: Todo) => t.start !== 'deferred' && t.startDate !== null && t.startDate <= ref;
  switch (command) {
    case 'complete':
    case 'cancel':
      // As a checkbox: open tasks are checked off; if none is open, all reopen.
      void changeStatus(ids, todos.some((t) => t.status === 'open') ? (command === 'complete' ? 'completed' : 'canceled') : 'open');
      return true;
    case 'today':
      void changeWhen(ids, { kind: todos.every(inToday) ? 'clear' : 'today' });
      return true;
    case 'unscheduled':
      void bulk.setWhen(ids, { kind: todos.every((t) => t.start === 'unscheduled' && t.startDate === null) ? 'clear' : 'unscheduled' });
      return true;
    case 'deferred':
      void bulk.setWhen(ids, { kind: todos.every((t) => t.start === 'deferred') ? 'unscheduled' : 'deferred' });
      return true;
    case 'move':
      ui.movingIds = ids;
      return true;
    case 'duplicate':
      void bulk.duplicate(ids).then((copies) => {
        if (copies.length) ui.selection = { ids: copies, active: copies[copies.length - 1], anchor: copies[0] };
      });
      return true;
    case 'trash':
      void trashTodos(ids);
      return true;
  }
  if (command.startsWith('priority-')) {
    const n = Number(command.slice(-1));
    void bulk.setPriority(ids, n ? (n as Priority) : null);
    return true;
  }
  return false;
}

/**
 * A tag shortcut (FR-6.4) for the tag with that key. `apply` adds the tag to
 * the open or selected tasks, or removes it when all of them have it (one
 * undo step); `filter` selects the tag in the filter bar, or, if it is
 * already selected, goes back to its parent or clears it (`nextTagFilter`). Returns false when no tag has the key or there is no
 * task to tag, so the key keeps its usual meaning.
 */
export function runTagShortcut(kind: 'apply' | 'filter', key: string): boolean {
  const s = get(snapshot);
  const tag = s.tags.find((t) => t.shortcut === key);
  if (!tag) return false;
  if (kind === 'filter') {
    ui.tagFilter = nextTagFilter(ui.tagFilter, tag.id, s.tags);
    return true;
  }
  const several = !ui.expandedId && ui.multiple ? selectedIds() : [];
  const ids = several.length > 1 ? several : [target()?.id].filter((id): id is ID => !!id);
  const todos = s.todos.filter((t) => ids.includes(t.id) && isListed(t));
  if (!todos.length) return false;
  void bulk.setTag(
    todos.map((t) => t.id),
    tag.id,
    !todos.every((t) => t.tagIds.includes(tag.id)),
  );
  return true;
}

/**
 * Carry out a command. Returns false when it does not apply here (an item
 * command with nothing selected), so the key keeps its usual meaning.
 */
export function runCommand(command: Command): boolean {
  const r = get(route);
  const ref = get(todayDate);
  const list = GO[command];
  if (list) {
    go({ kind: 'list', list });
    return true;
  }

  switch (command) {
    case 'new-todo':
      if (!canAddHere(r)) return false;
      void newTodoInline(r, ref);
      return true;
    case 'new-project':
      void repo.createProject({ areaId: r.kind === 'area' ? r.id : null }).then((id) => go({ kind: 'project', id }));
      return true;
    case 'new-heading':
      if (r.kind !== 'project') return false;
      void newHeading(r.id);
      return true;
    case 'quick-entry':
      // Quick Entry starts in the Inbox.
      openQuickEntry();
      return true;
    case 'find':
      ui.openFind();
      return true;
    case 'select-prev':
    case 'select-next':
      selectNext(command === 'select-prev' ? -1 : 1);
      return true;
    case 'extend-prev':
    case 'extend-next':
      return extendSelection(command === 'extend-prev' ? -1 : 1);
    case 'select-all': {
      rowLimit.drawAll();
      const order = rowIds();
      if (!order.length || ui.expandedId) return false;
      ui.selection = selectAll(ui.selection, order);
      return true;
    }
    case 'collapse-selection':
      if (!ui.multiple) return false;
      ui.selection = single(ui.selectedId);
      return true;
    case 'toggle-sidebar':
      ui.toggleSidebar();
      return true;
    case 'undo':
      void ui.undoLast();
      return true;
    case 'redo':
      void ui.redoLast();
      return true;
    case 'help':
      ui.helpOpen = true;
      return true;
    case 'cycle-grouping': {
      if (r.kind !== 'list' || r.list !== 'today') return false;
      const i = GROUPING_CYCLE.indexOf(get(settings).todayGrouping);
      void repo.setSetting('todayGrouping', GROUPING_CYCLE[(i + 1) % GROUPING_CYCLE.length]);
      return true;
    }
  }

  if (!ui.expandedId && ui.multiple) {
    const ids = selectedIds().filter((id) => get(snapshot).todos.some((t) => t.id === id && isListed(t)));
    if (ids.length > 1) return runOnSeveral(command, ids, ref);
  }
  const t = target();
  if (!t) return false;
  const card = CARD[command];
  if (card) {
    ui.openWith(t.id, card);
    return true;
  }
  switch (command) {
    case 'open':
      ui.open(t.id);
      return true;
    case 'move-up':
    case 'move-down': {
      const el = rowOf(t.id);
      if (el) void moveByKeyboard(el, command === 'move-up' ? -1 : 1);
      return true;
    }
    case 'complete':
    case 'cancel':
      ui.check(t, command === 'complete' ? 'completed' : 'canceled');
      return true;
    case 'today':
      // Toggles (FR-3.4).
      void changeWhen([t.id], { kind: t.start !== 'deferred' && t.startDate !== null && t.startDate <= ref ? 'clear' : 'today' });
      return true;
    case 'unscheduled':
      void repo.setWhen(t.id, { kind: t.start === 'unscheduled' && t.startDate === null ? 'clear' : 'unscheduled' });
      return true;
    case 'deferred':
      void repo.setWhen(t.id, { kind: t.start === 'deferred' ? 'unscheduled' : 'deferred' });
      return true;
    case 'move':
      ui.movingIds = [t.id];
      return true;
    case 'duplicate':
      void repo.duplicateTodo(t.id).then((id) => {
        if (id) ui.selectedId = ui.scrollId = id;
      });
      return true;
    case 'trash': {
      // Select the next row, so repeated Delete keeps working down the list.
      const list = rows();
      const i = list.findIndex((el) => el.dataset.rowId === t.id);
      const next = list[i + 1] ?? list[i - 1];
      ui.close();
      void repo.setTodoTrashed(t.id, true).then(() => ui.offerUndo('Moved to Trash'));
      ui.selectedId = next?.dataset.rowId ?? null;
      return true;
    }
  }
  if (command.startsWith('priority-')) {
    const n = Number(command.slice(-1));
    void repo.setPriority(t.id, n ? (n as Priority) : null);
    return true;
  }
  return false;
}
