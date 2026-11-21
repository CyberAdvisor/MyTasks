/**
 * Holding a task in place while it's being worked on: the
 * lists show a held task where it was, while its card shows the saved
 * values. A task is held while its card is open, and a task moved out of
 * the Inbox stays in the Inbox until OK or another list is opened.
 * Changes are saved at once; only where the task is listed waits.
 */
import type { Snapshot } from './lists';
import type { ID, Todo } from './types';

/** The fields that decide which list, group and place a task shows in. */
const PLACEMENT = [
  'start',
  'startDate',
  'areaId',
  'projectId',
  'headingId',
  'sortKey',
  'todaySortKey',
  'priority',
  'prioritySource',
  'contextId',
] as const satisfies readonly (keyof Todo)[];

/**
 * The snapshot with each held task listed where it was: its placement as in
 * `held` (the task as it was), everything else as saved. A held task that
 * was deleted or trashed since isn't brought back.
 */
export function holdPlacement(s: Snapshot, held: ReadonlyMap<ID, Todo>): Snapshot {
  if (held.size === 0) return s;
  const todos = s.todos.map((t) => {
    const was = held.get(t.id);
    if (!was || t.trashedAt) return t;
    const kept: Partial<Todo> = {};
    for (const f of PLACEMENT) (kept as Record<string, unknown>)[f] = was[f];
    return { ...t, ...kept };
  });
  return { ...s, todos };
}
