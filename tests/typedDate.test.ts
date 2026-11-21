/**
 * Typed dates (FR-3.2, v1.2.4): what the Start Date and Deadline pickers
 * understand. Today is fixed at Monday, Nov 16, 2026.
 */
import { describe, expect, it } from 'vitest';
import { parseTypedDate } from '../src/lib/model/typedDate';

const MON = '2026-11-16';
const parse = (text: string, ref = MON) => parseTypedDate(text, ref);

describe('parseTypedDate', () => {
  it('reads today and tomorrow, short or long, in any capitals', () => {
    expect(['today', 'Tod', ' TODAY '].map((t) => parse(t))).toEqual([MON, MON, MON]);
    expect(['tomorrow', 'tom', 'tmr', 'Tmrw'].map((t) => parse(t))).toEqual(Array(4).fill('2026-11-17'));
  });

  it('reads a weekday as the next one after today, and "next" as next week', () => {
    expect(parse('fri')).toBe('2026-11-20');
    expect(parse('this friday')).toBe('2026-11-20');
    expect(parse('next fri')).toBe('2026-11-27');
    expect(parse('mon')).toBe('2026-11-23'); // never today
    expect(parse('thurs')).toBe('2026-11-19');
    // Weeks run Sunday to Saturday, as the calendar (review C12): on a Sunday,
    // "next tue" is in the week after, and on a Saturday the next day starts it.
    expect(parse('next tue', '2026-11-22')).toBe('2026-12-01');
    expect(parse('next sun', '2026-11-21')).toBe('2026-11-22');
    expect(parse('next sat', '2026-11-18')).toBe('2026-11-28');
  });

  it('reads the weekend, next week and next month', () => {
    expect(parse('weekend')).toBe('2026-11-21');
    expect(parse('next week')).toBe('2026-11-23');
    expect(parse('next month')).toBe('2026-12-01');
  });

  it('reads an amount of time from today, keeping to the end of a short month', () => {
    expect(parse('in 3 days')).toBe('2026-11-19');
    expect(parse('in a week')).toBe('2026-11-23');
    expect(parse('2 weeks')).toBe('2026-11-30');
    expect(parse('in 1 month', '2027-01-31')).toBe('2027-02-28');
    expect(parse('in 1 year')).toBe('2027-11-16');
  });

  it('reads a month and day either way round, moving a past date to next year', () => {
    expect(parse('jan 12')).toBe('2027-01-12');
    expect(parse('12 January')).toBe('2027-01-12');
    expect(parse('dec 4th')).toBe('2026-12-04');
    expect(parse('nov 16')).toBe(MON);
    expect(parse('Jan 12, 2028')).toBe('2028-01-12');
  });

  it('reads month/day and year-month-day numbers', () => {
    expect(parse('1/12')).toBe('2027-01-12');
    expect(parse('12/25/27')).toBe('2027-12-25');
    expect(parse('2027-01-12')).toBe('2027-01-12');
  });

  it('gives nothing for text that is not a date, or a date that does not exist', () => {
    for (const text of ['', 'fryday', 'next', 'soon', 'feb 30', '13/1', 'in 3 parsecs', 'fr', 'last fri'])
      expect(parse(text), text).toBeNull();
  });
});
