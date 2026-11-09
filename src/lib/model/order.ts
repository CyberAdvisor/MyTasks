/**
 * Manual ordering with fractional indexes.
 *
 * Each record's `sortKey` sits between its neighbours' keys, so moving one
 * item rewrites only that item (design doc, Section 4).
 */
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

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

/**
 * New sort keys that put `movedId` where it sits in `order`, the display
 * order of its siblings after a drag or a keyboard move.
 *
 * `keyOf` gives each sibling's current key (null when it has none). Normally
 * only the moved item gets a new key, between its two neighbours. When the
 * neighbours' keys are missing or not in order (for example in Today, which
 * mixes items from different containers), every item in `order` gets a fresh
 * key instead, so the result always matches `order`.
 */
export function placementKeys(
  order: readonly string[],
  movedId: string,
  keyOf: (id: string) => string | null,
): Map<string, string> {
  const i = order.indexOf(movedId);
  if (i < 0) return new Map();
  const before = i > 0 ? keyOf(order[i - 1]) : null;
  const after = i < order.length - 1 ? keyOf(order[i + 1]) : null;
  const missing = (i > 0 && before === null) || (i < order.length - 1 && after === null);
  if (!missing && (before === null || after === null || before < after)) {
    return new Map([[movedId, keyBetween(before, after)]]);
  }
  const fresh = generateNKeysBetween(null, null, order.length);
  return new Map(order.map((id, n) => [id, fresh[n]]));
}
