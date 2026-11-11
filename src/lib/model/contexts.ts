/**
 * Context helpers (design doc, Section 5.13: FR-18).
 *
 * A to-do has one context or none. Contexts belong to to-dos only: projects
 * and areas have none, and nothing is inherited. Pure functions over the
 * snapshot, used by rows, the card, the filter bar, search and Today grouping.
 */
import type { Snapshot } from './lists';
import { bySortKey } from './order';
import type { Context, ID, Todo } from './types';

/** Contexts in Settings order. */
export function contextsInOrder(s: Snapshot): Context[] {
  return bySortKey(s.contexts);
}

/** A context's display name, or '' when it is unset or no longer exists. */
export function contextTitle(id: ID | null, s: Snapshot): string {
  if (id === null) return '';
  const c = s.contexts.find((x) => x.id === id);
  return c ? c.title || 'Untitled' : '';
}

/** Contexts used by any of `todos`, in Settings order, for the filter bar. */
export function contextsInUse(todos: Todo[], s: Snapshot): Context[] {
  const used = new Set(todos.map((t) => t.contextId));
  return contextsInOrder(s).filter((c) => used.has(c.id));
}

/** The selected context if it is still offered in the bar, otherwise no filter. */
export function activeContext(selected: ID | null, offered: Context[]): ID | null {
  return selected !== null && offered.some((c) => c.id === selected) ? selected : null;
}

/** Keep the to-dos in context `contextId`. `null` keeps all. */
export function filterByContext(todos: Todo[], contextId: ID | null): Todo[] {
  return contextId === null ? todos : todos.filter((t) => t.contextId === contextId);
}
