/**
 * Swipe actions on touch rows (FR-10.4): which way a move is going, and what
 * letting go does.
 */
import { describe, expect, it } from 'vitest';
import { atEdge, axisOf, swipeAction } from '../src/lib/swipe';

describe('swipe actions', () => {
  it('waits for a clear direction, and treats a mostly vertical move as a scroll', () => {
    expect(axisOf(4, 3)).toBeNull();
    expect(axisOf(20, 5)).toBe('across');
    expect(axisOf(-20, 5)).toBe('across');
    expect(axisOf(12, 10)).toBe('along');
    expect(axisOf(2, -30)).toBe('along');
  });

  it('acts past a third of the row: left to right for Start Date, right to left for Select', () => {
    expect(swipeAction(130, 375)).toBe('when');
    expect(swipeAction(-130, 375)).toBe('select');
    expect(swipeAction(100, 375)).toBeNull();
    expect(swipeAction(-100, 375)).toBeNull();
  });

  it("leaves a swipe from the screen's left edge to the browser", () => {
    expect(atEdge(10)).toBe(true);
    expect(atEdge(40)).toBe(false);
  });
});
