/**
 * Long lists drawn in steps (NFR-7, 11b): the limit shared across a view's
 * groups in screen order, growing a step at a time, back to the first step
 * on a new page, and lifted by drawAll.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { ROW_STEP, rowLimit, shareOf, startsOf } from '../src/lib/state/rowLimit.svelte';
import { ui } from '../src/lib/state/ui.svelte';

beforeEach(() => {
  rowLimit.reset();
  rowLimit.total = 0;
});

describe('sharing the limit across groups', () => {
  it('starts each group after the rows above it', () => {
    expect(startsOf([])).toEqual([]);
    expect(startsOf([3, 0, 5, 2])).toEqual([0, 3, 3, 8]);
  });

  it('draws a group’s rows up to what the limit leaves, never fewer than none', () => {
    const counts = [100, 100, 100];
    const draws = (limit: number) => startsOf(counts).map((start, i) => shareOf(counts[i], start, limit));
    expect(draws(150)).toEqual([100, 50, 0]);
    expect(draws(300)).toEqual([100, 100, 100]);
    expect(draws(Infinity)).toEqual([100, 100, 100]);
    expect(draws(0)).toEqual([0, 0, 0]);
  });
});

describe('the limit', () => {
  it('grows a step while rows are left, and stops at none', () => {
    rowLimit.total = ROW_STEP * 2 + 10;
    expect(rowLimit.more).toBe(true);
    rowLimit.grow();
    expect(rowLimit.limit).toBe(ROW_STEP * 2);
    rowLimit.grow();
    expect(rowLimit.limit).toBe(ROW_STEP * 3);
    expect(rowLimit.more).toBe(false);
    rowLimit.grow();
    expect(rowLimit.limit).toBe(ROW_STEP * 3);
  });

  it('draws everything at once for commands that need every row, and only when rows are left', () => {
    rowLimit.total = 40;
    rowLimit.drawAll();
    expect(rowLimit.limit).toBe(ROW_STEP);
    rowLimit.total = 1000;
    rowLimit.drawAll();
    expect(rowLimit.limit).toBe(Infinity);
    expect(rowLimit.more).toBe(false);
  });

  it('goes back to the first step when the page changes', () => {
    rowLimit.total = 1000;
    rowLimit.drawAll();
    ui.enterView();
    expect(rowLimit.limit).toBe(ROW_STEP);
  });
});
