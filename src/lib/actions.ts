/**
 * UI-level actions that combine routing, today's date and data operations.
 */
import * as repo from './db/repo';
import { addDays } from './model/dates';
import type { LocalDate } from './model/types';
import type { Route } from './state/route';
import { ui } from './state/ui.svelte';

/**
 * Create a to-do that belongs in the current view (FR-1.1), then open its
 * card so the title can be typed straight away.
 */
export async function newTodoHere(r: Route, ref: LocalDate): Promise<void> {
  let id: string;
  if (r.kind === 'project') id = await repo.createTodo({ projectId: r.id });
  else if (r.kind === 'area') id = await repo.createTodo({ areaId: r.id });
  else if (r.kind === 'list' && r.list === 'today') id = await repo.createTodo({ startDate: ref });
  else if (r.kind === 'list' && r.list === 'scheduled') id = await repo.createTodo({ startDate: addDays(ref, 1) });
  else if (r.kind === 'list' && r.list === 'unscheduled') id = await repo.createTodo({ start: 'unscheduled' });
  else if (r.kind === 'list' && r.list === 'deferred') id = await repo.createTodo({ deferred: true });
  else id = await repo.createTodo();
  ui.open(id);
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
