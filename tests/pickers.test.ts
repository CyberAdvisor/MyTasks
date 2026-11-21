/**
 * Date helpers behind the Start Date and Deadline pickers (FR-3.1, FR-3.3).
 */
import { describe, expect, it } from 'vitest';
import { monthGrid, nextWeek, thisWeekend } from '../src/lib/model/dates';

const REF = '2026-11-09'; // a Monday

describe('picker dates', () => {
  it('finds This Weekend and Next Week', () => {
    expect(thisWeekend(REF)).toBe('2026-11-14'); // Saturday
    expect(thisWeekend('2026-11-15')).toBe('2026-11-15'); // Sunday is already the weekend
    expect(nextWeek(REF)).toBe('2026-11-16'); // next Monday, not today
    expect(nextWeek('2026-11-15')).toBe('2026-11-16');
  });

  it('builds a Sunday-first month grid, as US calendars are (review C12)', () => {
    const weeks = monthGrid('2026-11-20');
    // Nov 1 2026 is a Sunday: the first column.
    expect(weeks[0]).toEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07']);
    // Dec 1 2026 is a Tuesday: two blanks first.
    expect(monthGrid('2026-12-05')[0].slice(0, 3)).toEqual([null, null, '2026-12-01']);
    expect(weeks.flat().filter(Boolean)).toHaveLength(30);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
  });
});
