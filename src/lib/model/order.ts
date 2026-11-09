/**
 * Manual ordering with fractional indexes.
 *
 * Each record's `sortKey` sits between its neighbours' keys, so moving one
 * item rewrites only that item (design doc, Section 4).
 */
import { generateKeyBetween } from 'fractional-indexing';

/** Anything with a sort key. */
export interface Sortable {
  sortKey: string;
}

/** Compare two sort keys as plain strings (fractional-indexing keys sort lexically). */
export function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Sort a copy of `items` by `sortKey`. */
export function bySortKey<T extends Sortable>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => compareKeys(a.sortKey, b.sortKey));
}

/** Key that places a new item after every existing key (or first if none). */
export function keyAtEnd(keys: readonly string[]): string {
  const last = keys.length ? [...keys].sort(compareKeys)[keys.length - 1] : null;
  return generateKeyBetween(last, null);
}

/** Key that places a new item before every existing key. */
export function keyAtStart(keys: readonly string[]): string {
  const first = keys.length ? [...keys].sort(compareKeys)[0] : null;
  return generateKeyBetween(null, first);
}

/** Key between two neighbours; either may be null for the ends. */
export function keyBetween(before: string | null, after: string | null): string {
  return generateKeyBetween(before, after);
}
