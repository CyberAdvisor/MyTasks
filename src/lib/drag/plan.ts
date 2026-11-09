/**
 * Pure calculations for drag and drop and keyboard moves (FR-10.3 to
 * FR-10.10). Kept free of the DOM so they can be unit-tested.
 */

/** The vertical extent of one item on screen. */
export interface Extent {
  top: number;
  bottom: number;
}

/**
 * Where an item dropped at height `y` goes among `items` (its future
 * siblings, in order, without the dragged item): before the first item whose
 * middle is below `y`, or at the end.
 */
export function insertionIndex(items: readonly Extent[], y: number): number {
  const i = items.findIndex((r) => y < (r.top + r.bottom) / 2);
  return i < 0 ? items.length : i;
}

/** `ids` with `movedId` taken out and put back at `index`. */
export function orderWith(ids: readonly string[], movedId: string, index: number): string[] {
  const rest = ids.filter((id) => id !== movedId);
  const at = Math.max(0, Math.min(index, rest.length));
  return [...rest.slice(0, at), movedId, ...rest.slice(at)];
}

/** `ids` with `id` moved `delta` places, or null when it is already at that end. */
export function shiftedOrder(ids: readonly string[], id: string, delta: number): string[] | null {
  const i = ids.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= ids.length) return null;
  return orderWith(ids, id, j);
}

/** Whether two orders are the same. */
export function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}
