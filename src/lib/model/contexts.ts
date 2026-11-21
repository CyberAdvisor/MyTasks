/**
 * Context helpers (design doc, Section 5.13: FR-18).
 *
 * A to-do has one context or none. Contexts belong to to-dos only: projects
 * and areas have none, and nothing is inherited. Pure functions over the
 * snapshot, used by rows, the card, search and Today grouping. (Since 1.3.5 the filter
 * bar shows tags only.)
 */
import type { Snapshot } from './lists';
import { bySortKey } from './order';
import type { Context, ID } from './types';

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
