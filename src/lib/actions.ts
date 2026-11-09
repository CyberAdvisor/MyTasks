/**
 * UI-level actions that combine routing, today's date and data operations.
 */
import * as repo from './db/repo';
import { addDays } from './model/dates';
import { inInbox, inScheduled, inToday, isClosed, type BuiltInList } from './model/lists';
import type { LocalDate, Todo } from './model/types';
import { TodoDraft, type DraftStart } from './state/draft.svelte';
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

/** Add an empty heading at the end of a project and focus its title (FR-2.4). */
export async function newHeading(projectId: string): Promise<void> {
  ui.newHeadingId = await repo.createHeading(projectId, '');
}

/** Whether the current view accepts new to-dos (Logbook, Trash and Settings do not). */
export function canAddHere(r: Route): boolean {
  if (r.kind === 'settings') return false;
  return !(r.kind === 'list' && (r.list === 'logbook' || r.list === 'trash'));
}
