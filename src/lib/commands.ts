/**
 * Runs keyboard commands (design doc, Section 7). `shortcuts.ts` decides which
 * command a key means; this module carries it out against the current view.
 *
 * Item commands act on the open card's to-do, or else the selected row.
 */
import { get } from 'svelte/store';
import * as repo from './db/repo';
import { moveByKeyboard } from './drag/drag';
import { canAddHere, newHeading, newTodoInline, openQuickEntry } from './actions';
import { isOpen, type BuiltInList, type TodayGrouping } from './model/lists';
import type { Priority, Todo } from './model/types';
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

const GROUPING_CYCLE: TodayGrouping[] = ['none', 'project', 'priority'];

/** The rows of the current view, in screen order. */
function rows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('main [data-row-id]')];
}

/** The row element of a to-do in the current view. */
function rowOf(id: string): HTMLElement | undefined {
  return rows().find((el) => el.dataset.rowId === id);
}

/** The to-do item commands act on: the open card's, else the selected row's. */
function target(): Todo | undefined {
  const id = ui.expandedId ?? (ui.selectedId && rowOf(ui.selectedId) ? ui.selectedId : null);
  return get(snapshot).todos.find((t) => t.id === id && isOpen(t));
}

/** Move the selection to the previous (-1) or next (+1) row and focus it. */
function selectNext(delta: number): void {
  const list = rows();
  if (!list.length) return;
  const i = list.findIndex((el) => el.dataset.rowId === ui.selectedId);
  const j = i < 0 ? (delta > 0 ? 0 : list.length - 1) : Math.max(0, Math.min(list.length - 1, i + delta));
  const el = list[j];
  ui.selectedId = el.dataset.rowId!;
  el.querySelector<HTMLElement>('.body')?.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'nearest' });
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
      // As in Things, Quick Entry starts in the Inbox.
      openQuickEntry();
      return true;
    case 'find':
      ui.openFind();
      return true;
    case 'select-prev':
    case 'select-next':
      selectNext(command === 'select-prev' ? -1 : 1);
      return true;
    case 'toggle-sidebar':
      ui.toggleSidebar();
      return true;
    case 'undo':
      void ui.undoLast();
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
      ui.toggleDone(t.id, command === 'complete' ? 'completed' : 'canceled');
      return true;
    case 'today':
      // Toggles, as in Things (FR-3.4).
      void repo.setWhen(t.id, { kind: t.start !== 'deferred' && t.startDate !== null && t.startDate <= ref ? 'clear' : 'today' });
      return true;
    case 'unscheduled':
      void repo.setWhen(t.id, { kind: t.start === 'unscheduled' && t.startDate === null ? 'clear' : 'unscheduled' });
      return true;
    case 'deferred':
      void repo.setWhen(t.id, { kind: t.start === 'deferred' ? 'unscheduled' : 'deferred' });
      return true;
    case 'move':
      ui.movingId = t.id;
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
