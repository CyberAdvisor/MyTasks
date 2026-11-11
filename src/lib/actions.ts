/**
 * UI-level actions that combine routing, today's date and data operations.
 */
import { get } from 'svelte/store';
import * as repo from './db/repo';
import { undoGroup } from './db/history';
import { zoneOf } from './drag/drag';
import { orderWith } from './drag/plan';
import { addDays } from './model/dates';
import { inInbox, inScheduled, inToday, isClosed, isOpen, type BuiltInList } from './model/lists';
import type { LocalDate, Todo } from './model/types';
import { TodoDraft, type DraftStart } from './state/draft.svelte';
import { snapshot } from './state/live';
import { go, hrefFor, type Route } from './state/route';
import { ui } from './state/ui.svelte';

/**
 * Where a new to-do starts when Quick Entry is opened from a view (FR-10.5):
 * in that project, area or list. Other views start in the Inbox.
 */
export function draftStartFor(r: Route, ref: LocalDate): DraftStart {
  if (r.kind === 'project') return { placement: { projectId: r.id } };
  if (r.kind === 'area') return { placement: { areaId: r.id } };
  if (r.kind !== 'list') return {};
  if (r.list === 'today') return { startDate: ref };
  if (r.list === 'scheduled') return { startDate: addDays(ref, 1) };
  if (r.list === 'unscheduled') return { start: 'unscheduled' };
  if (r.list === 'deferred') return { deferred: true };
  return {};
}

/**
 * Fields for a to-do created inline in view `r` (FR-1.1): the view's own
 * start, as for Quick Entry, but in the same container (and, in Scheduled,
 * on the same day) as the selected to-do, as in Things.
 */
export function inlineStart(r: Route, ref: LocalDate, selected?: Todo): repo.NewTodo {
  const { placement, ...when } = draftStartFor(r, ref);
  const opts: repo.NewTodo = { ...placement, ...when };
  if (!selected) return opts;
  opts.projectId = selected.projectId;
  opts.areaId = selected.areaId;
  opts.headingId = selected.headingId;
  if (r.kind === 'list' && r.list === 'scheduled') opts.startDate = selected.startDate;
  return opts;
}

/**
 * New To-Do from the keyboard (FR-1.1): add a to-do below the selected row,
 * or at the end of Today, and open it with the title focused. Views without
 * a list of their own (search results) open Quick Entry instead.
 */
export async function newTodoInline(r: Route, ref: LocalDate): Promise<void> {
  if (!canAddHere(r)) return;
  if (r.kind !== 'list' && r.kind !== 'project' && r.kind !== 'area') {
    openQuickEntry(draftStartFor(r, ref));
    return;
  }
  const selected = get(snapshot).todos.find((t) => t.id === ui.selectedId && isOpen(t));
  const rows = document.querySelectorAll('main [data-row-id]');
  const anchor = selected
    ? document.querySelector(`main [data-row-id="${selected.id}"]`)
    : r.kind === 'list' && r.list === 'today'
      ? rows[rows.length - 1]
      : null;
  const zone = anchor ? zoneOf(anchor, 'todo') : null;
  const id = await undoGroup(async () => {
    const newId = await repo.createTodo(inlineStart(r, ref, selected));
    if (zone) {
      const after = zone.ids.indexOf((anchor as HTMLElement).dataset.rowId!);
      await zone.zone.drop(newId, orderWith(zone.ids, newId, after + 1));
    }
    return newId;
  });
  ui.open(id);
}

/** Open Quick Entry with a fresh draft (FR-8.1). */
export function openQuickEntry(start: DraftStart = {}): void {
  ui.draft = new TodoDraft(start);
}

/** Store the Quick Entry draft, close the panel and select the new to-do. */
export async function saveDraft(): Promise<void> {
  const draft = ui.draft;
  if (!draft) return;
  ui.draft = null;
  ui.selectedId = await repo.createTodo(draft.toNewTodo());
}

/** The view a to-do lives in: its project or area, else the list it shows in. */
export function homeOf(todo: Todo, ref: LocalDate): Route {
  const list = (l: BuiltInList): Route => ({ kind: 'list', list: l });
  if (todo.trashedAt) return list('trash');
  if (isClosed(todo)) return list('logbook');
  if (todo.projectId) return { kind: 'project', id: todo.projectId };
  if (todo.areaId) return { kind: 'area', id: todo.areaId };
  if (inInbox(todo)) return list('inbox');
  if (inToday(todo, ref)) return list('today');
  if (inScheduled(todo, ref)) return list('scheduled');
  if (todo.start === 'deferred') return list('deferred');
  return list('unscheduled');
}

/**
 * Show a to-do where it lives: go to its view, select it and, if it is open,
 * open its card (Quick Find, FR-9.1).
 */
export function revealTodo(todo: Todo, current: Route, ref: LocalDate): void {
  const target = homeOf(todo, ref);
  ui.revealNext(todo.id, !isClosed(todo));
  if (hrefFor(target) === hrefFor(current)) ui.enterView();
  else go(target);
}

/**
 * The project or area page an open card links to (FR-1.2): the to-do's
 * container, or null when it has none or that page is already showing.
 */
export function containerLink(todo: Todo, current: Route): Extract<Route, { kind: 'project' | 'area' }> | null {
  const target: Extract<Route, { kind: 'project' | 'area' }> | null = todo.projectId
    ? { kind: 'project', id: todo.projectId }
    : todo.areaId
      ? { kind: 'area', id: todo.areaId }
      : null;
  return target && hrefFor(target) !== hrefFor(current) ? target : null;
}

/** Go to a to-do's project or area page with the to-do selected (Go to Project). */
export function goToContainer(todo: Todo, current: Route): void {
  const target = containerLink(todo, current);
  if (!target) return;
  ui.close();
  ui.revealNext(todo.id, false);
  go(target);
}

/** Add an empty heading at the end of a project and focus its title (FR-2.4). */
export async function newHeading(projectId: string): Promise<void> {
  ui.newHeadingId = await repo.createHeading(projectId, '');
}

/** Whether the current view accepts new to-dos (Logbook, Trash and Settings do not). */
export function canAddHere(r: Route): boolean {
  if (r.kind === 'settings') return false;
  return !(r.kind === 'list' && (r.list === 'logbook' || r.list === 'trash'));
}
