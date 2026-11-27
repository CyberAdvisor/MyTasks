/**
 * Natural-language entry (FR-1.12): what readTitle reads from a title, what
 * it leaves as text, and the part of a changed title that is new.
 */
import { describe, expect, it } from 'vitest';
import { readTitle, typedPart, type TitleContext } from '../src/lib/model/titleWords';

// Friday, November 27, 2026, 8:00 AM.
const ctx = (over: Partial<TitleContext> = {}): TitleContext => ({
  ref: '2026-11-27',
  now: new Date(2026, 10, 27, 8, 0),
  tags: [
    { id: 'errand', title: 'Errand', path: 'Errand' },
    { id: 'garden', title: 'Garden', path: 'Home/Garden' },
  ],
  contexts: [
    { id: 'home', title: 'Home' },
    { id: 'low', title: 'Low energy' },
  ],
  remindersOn: true,
  template: false,
  deadline: null,
  startDate: null,
  ...over,
});

describe('readTitle', () => {
  it.each([
    ['Call the dentist tomorrow', 'Call the dentist', { startDate: '2026-11-28' }],
    ['Call the dentist today', 'Call the dentist', { startDate: '2026-11-27' }],
    ['Pay rent next fri', 'Pay rent', { startDate: '2026-12-04' }],
    ['Pay rent friday', 'Pay rent', { startDate: '2026-12-04' }],
    ['Book flights in 3 days', 'Book flights', { startDate: '2026-11-30' }],
    ['Book flights jan 12', 'Book flights', { startDate: '2027-01-12' }],
    ['Book flights 1/12/27', 'Book flights', { startDate: '2027-01-12' }],
    ['Plan next week', 'Plan', { startDate: '2026-11-30' }],
    ['File taxes by dec 4', 'File taxes', { deadline: '2026-12-04' }],
    ['File taxes due monday', 'File taxes', { deadline: '2026-11-30' }],
    ['Call Sam at 9am', 'Call Sam', { reminder: '2026-11-27T09:00' }],
    ['Call Sam tomorrow 9am', 'Call Sam', { startDate: '2026-11-28', reminder: '2026-11-28T09:00' }],
    ['Call Sam tomorrow at 2:30pm', 'Call Sam', { startDate: '2026-11-28', reminder: '2026-11-28T14:30' }],
    ['Call Sam in 30 minutes', 'Call Sam', { reminder: '2026-11-27T08:30' }],
    ['Call Sam in 2 hours', 'Call Sam', { reminder: '2026-11-27T10:00' }],
    ['Call Sam p1', 'Call Sam', { priority: 1 }],
    ['Call Sam #errand', 'Call Sam', { tagIds: ['errand'] }],
    ['Weed the beds #home/garden', 'Weed the beds', { tagIds: ['garden'] }],
    ['Weed the beds #garden', 'Weed the beds', { tagIds: ['garden'] }],
    ['Call Sam @home', 'Call Sam', { contextId: 'home' }],
    ['Call Sam @low-energy', 'Call Sam', { contextId: 'low' }],
  ])('%s', (title, rest, fields) => {
    const r = readTitle(title, ctx());
    expect(r.title).toBe(rest);
    expect(r.fields).toEqual(fields);
  });

  it('reads a repeat as a rule starting at its next date', () => {
    const r = readTitle('Water the plants every mon', ctx());
    expect(r.title).toBe('Water the plants');
    expect(r.fields.repeat?.rule).toMatchObject({ mode: 'fixed', unit: 'week', interval: 1, weekdays: [1] });
    expect(r.fields.repeat?.first).toBe('2026-11-30');
    const monthly = readTitle('Pay the water bill every 15th', ctx());
    expect(monthly.fields.repeat?.rule).toMatchObject({ unit: 'month', days: [{ ordinal: 15, weekday: null }] });
    expect(monthly.fields.repeat?.first).toBe('2026-12-15');
    expect(readTitle('Meet every 2nd tue', ctx()).fields.repeat?.rule.days).toEqual([{ ordinal: 2, weekday: 2 }]);
  });

  it('reads everything in one title', () => {
    const r = readTitle('Call the dentist tomorrow 9am p1 #errand @home', ctx());
    expect(r.title).toBe('Call the dentist');
    expect(r.fields).toEqual({ startDate: '2026-11-28', reminder: '2026-11-28T09:00', priority: 1, tagIds: ['errand'], contextId: 'home' });
    expect(r.words.map((w) => w.text)).toEqual(['tomorrow', '9am', 'p1', '#errand', '@home']);
  });

  it.each([
    ['Lunch with Tom'],
    ['Enjoy the sun'],
    ['Sat exam results'],
    ['Plan the weekend'],
    ['May I borrow it'],
    ['Buy 1/2 gallon of milk'],
    ['Read 2 weeks of notes'],
    ['Plan a week of meals'],
    ['Room 12'],
    ['Plan the "next week" party'],
    ['Call Sam #unknown'],
    ['Call Sam @office'],
    ['tomorrow'],
  ])('leaves “%s” as it is', (title) => {
    const r = readTitle(title, ctx());
    expect(r.title).toBe(title);
    expect(r.fields).toEqual({});
  });

  it('reads only the first of each kind', () => {
    const r = readTitle('Call Sam tomorrow or friday p1 p2', ctx());
    expect(r.title).toBe('Call Sam or friday p2');
    expect(r.fields).toEqual({ startDate: '2026-11-28', priority: 1 });
  });

  it('reads no reminder while reminders are off', () => {
    const r = readTitle('Call Sam tomorrow at 9am', ctx({ remindersOn: false }));
    expect(r.title).toBe('Call Sam at 9am');
    expect(r.fields).toEqual({ startDate: '2026-11-28' });
  });

  it('in a template’s task reads a time, priority, tags and context, but no dates or repeat', () => {
    const r = readTitle('Check the oil tomorrow at 9am every mon by fri p2', ctx({ template: true }));
    expect(r.title).toBe('Check the oil tomorrow every mon by fri');
    expect(r.fields).toEqual({ reminder: '09:00', priority: 2 });
  });

  it('keeps a repeat’s time as a time, and leaves its own dates as text', () => {
    const r = readTitle('Stand-up every weekday at 9:30am', ctx());
    expect(r.fields.reminder).toBe('09:30');
    expect(r.fields.repeat?.rule.weekdays).toEqual([1, 2, 3, 4, 5]);
    expect(r.title).toBe('Stand-up');
  });

  it('leaves a start date after the deadline as text, saying why', () => {
    const r = readTitle('Draft the report dec 10', ctx({ deadline: '2026-12-04' }));
    expect(r.fields).toEqual({});
    expect(r.unused).toEqual([{ text: 'dec 10', why: 'After the deadline (Dec 4)' }]);
    const both = readTitle('Draft the report dec 10 by dec 4', ctx());
    expect(both.fields).toEqual({ deadline: '2026-12-04' });
    expect(both.title).toBe('Draft the report dec 10');
  });

  it('puts a time alone on the task’s later start date', () => {
    expect(readTitle('Call Sam at 9am', ctx({ startDate: '2026-12-02' })).fields.reminder).toBe('2026-12-02T09:00');
  });

  it('skips words kept as text, and words outside the part read', () => {
    expect(readTitle('Review the notes from friday', ctx(), { kept: new Set([22]) }).fields).toEqual({});
    const title = 'Review friday notes tomorrow';
    expect(readTitle(title, ctx(), { from: 20 }).fields).toEqual({ startDate: '2026-11-28' });
  });
});

describe('typedPart', () => {
  it.each([
    ['', 'Call Sam tomorrow', 0, 17],
    ['Call Sam', 'Call Sam tomorrow', 8, 17],
    ['Call Sam', 'Call Sam p1 now', 8, 15],
    ['Review friday notes', 'Review friday notes tomorrow', 19, 28],
    ['Call Sam', 'Call Samuel', 5, 11],
    ['Call Sam', 'Call Sam', 8, 8],
  ])('%j → %j', (before, now, from, to) => {
    expect(typedPart(before, now)).toEqual({ from, to });
  });
});
