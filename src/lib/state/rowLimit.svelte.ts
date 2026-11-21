/**
 * Long lists are drawn in steps (NFR-7, 11b, conversation 2026-11-17-C): the
 * view on screen draws its first ROW_STEP rows, and ROW_STEP more each time
 * the list is scrolled near its end (MoreRows.svelte). The limit counts rows
 * across all of a view's groups, in screen order; each TodoList draws its
 * share (`shareOf`), given how many rows come before it (`startsOf`).
 *
 * Commands that need every row of the view (Select All, extending the
 * selection or moving past the last drawn row, dragging, Print, revealing a
 * task, placing a new one) call `drawAll()` first, so they never act on part
 * of a list. The limit goes back to ROW_STEP when the page changes.
 */
import { flushSync } from 'svelte';

/** Rows drawn at first, and added at each step. */
export const ROW_STEP = 150;

/** Where each group starts in the view's rows, given each group's row count. */
export function startsOf(counts: readonly number[]): number[] {
  let total = 0;
  return counts.map((n) => {
    const start = total;
    total += n;
    return start;
  });
}

/** How many of a group's `count` rows to draw, when `start` rows come before it and `limit` may be drawn. */
export function shareOf(count: number, start: number, limit: number): number {
  return Math.max(0, Math.min(count, limit - start));
}

class RowLimit {
  /** How many rows the view on screen may draw. */
  limit = $state(ROW_STEP);
  /** How many rows the view on screen has, drawn or not (set by MoreRows). */
  total = $state(0);

  /** Whether the view has rows not yet drawn. */
  get more(): boolean {
    return this.total > this.limit;
  }

  /** Draw the next step of rows. */
  grow(): void {
    if (this.more) this.limit += ROW_STEP;
  }

  /** Back to the first step, for a new page. */
  reset(): void {
    this.limit = ROW_STEP;
  }

  /**
   * Draw every row now, before a command that needs them all. Synchronous
   * (`flushSync`), so the rows are on the page when it returns.
   */
  drawAll(): void {
    if (!this.more) return;
    this.limit = Infinity;
    flushSync();
  }
}

export const rowLimit = new RowLimit();
