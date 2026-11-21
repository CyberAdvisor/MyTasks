/** Tests for the When marks on task rows: star, grey date label, dashed checkbox (Section 6, Row). */
import { describe, expect, it } from 'vitest';
import { whenLabel } from '../src/lib/model/dates';
import { whenMark } from '../src/lib/model/lists';
import { todo } from './helpers';

// Saturday, November 14, 2026.
const REF = '2026-11-14';

describe('whenLabel', () => {
  it('shows the weekday for the next 6 days, tomorrow included', () => {
    expect(whenLabel('2026-11-15', REF)).toBe('Sun');
    expect(whenLabel('2026-11-20', REF)).toBe('Fri');
  });

  it('shows month and day from 7 days out to the end of the year', () => {
    expect(whenLabel('2026-11-21', REF)).toBe('Nov 21');
    expect(whenLabel('2026-12-31', REF)).toBe('Dec 31');
  });

  it('shows month and year in another year', () => {
    expect(whenLabel('2027-08-27', REF)).toBe('Aug 2027');
  });
});

describe('whenMark', () => {
  const today = todo({ start: 'unscheduled', startDate: REF });
  const later = todo({ start: 'unscheduled', startDate: '2026-11-20' });
  const deferred = todo({ start: 'deferred', startDate: null });
  const plain = todo({ start: 'unscheduled', startDate: null });

  it('marks Today with a star, a later date with its label, Deferred with a dashed box, and Unscheduled with nothing', () => {
    expect(whenMark(today, REF, null)).toEqual({ kind: 'today' });
    expect(whenMark(later, REF, null)).toEqual({ kind: 'scheduled', label: 'Fri' });
    expect(whenMark(deferred, REF, null)).toEqual({ kind: 'deferred' });
    expect(whenMark(plain, REF, null)).toBeNull();
  });

  it('leaves off what the list already says, and marks nothing in Completed and Trash', () => {
    expect(whenMark(today, REF, 'today')).toBeNull();
    expect(whenMark(later, REF, 'scheduled')).toBeNull();
    expect(whenMark(today, REF, 'unscheduled')).toEqual({ kind: 'today' });
    expect(whenMark(deferred, REF, 'deferred')).toEqual({ kind: 'deferred' });
    expect(whenMark(today, REF, 'logbook')).toBeNull();
    expect(whenMark({ ...today, trashedAt: '2026-11-14T10:00:00.000Z' }, REF, null)).toBeNull();
  });
});

