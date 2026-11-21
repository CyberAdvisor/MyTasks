import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, deadlineLabel, formatRelative, whenAfterDeadline } from '../src/lib/model/dates';
import { uuidv7 } from '../src/lib/model/ids';
import { keyAtEnd, keyAtStart, keyBetween } from '../src/lib/model/order';
import {
  deadlineWhen,
  inDeferred,
  inInbox,
  inScheduled,
  inToday,
  inUnscheduled,
  projectIndex,
  scheduledGroups,
  sidebarCounts,
  visibleTodos,
  whenMark,
  type Snapshot,
} from '../src/lib/model/lists';
import { project, todo } from './helpers';

const REF = '2026-11-09';

describe('dates', () => {
  it('adds days across month ends', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('counts days between dates', () => {
    expect(daysBetween('2026-11-09', '2026-11-12')).toBe(3);
    expect(daysBetween('2026-11-09', '2026-11-08')).toBe(-1);
  });
  it('labels deadlines', () => {
    expect(deadlineLabel(REF, REF)).toBe('Today');
    expect(deadlineLabel('2026-11-12', REF)).toBe('3 days left');
    expect(deadlineLabel('2026-11-08', REF)).toBe('1 day overdue');
    // Short, for phone rows (Milestone 11).
    expect(deadlineLabel(REF, REF, true)).toBe('Today');
    expect(deadlineLabel('2026-11-12', REF, true)).toBe('3d left');
    expect(deadlineLabel('2026-11-08', REF, true)).toBe('1d overdue');
  });
  it('labels relative days', () => {
    expect(formatRelative(REF, REF)).toBe('Today');
    expect(formatRelative('2026-11-10', REF)).toBe('Tomorrow');
  });
});

describe('ids and order', () => {
  it('makes version 7 UUIDs that sort by time', () => {
    const a = uuidv7(1_000);
    const b = uuidv7(2_000);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
  });
  it('generates keys at the ends and in between', () => {
    const first = keyAtEnd([]);
    const second = keyAtEnd([first]);
    const before = keyAtStart([first, second]);
    const mid = keyBetween(first, second);
    expect(before < first && first < mid && mid < second).toBe(true);
  });
});

describe('list membership', () => {
  const none = projectIndex([]);

  it('puts unfiled, undated tasks in the Inbox only', () => {
    const t = todo({ start: 'inbox' });
    expect(inInbox(t)).toBe(true);
    expect(inToday(t, REF)).toBe(false);
    expect(inUnscheduled(t, none, REF)).toBe(false);
  });

  it('shows tasks dated today or earlier in Today only, not Unscheduled; one with no start date is in Unscheduled', () => {
    const t = todo({ startDate: '2026-11-08' });
    expect(inToday(t, REF)).toBe(true);
    expect(inUnscheduled(t, none, REF)).toBe(false);
    expect(inScheduled(t, REF)).toBe(false);
    expect(inUnscheduled(todo({ start: 'unscheduled', startDate: null }), none, REF)).toBe(true);
  });

  it('shows future-dated tasks in Scheduled only', () => {
    const t = todo({ startDate: '2026-11-15' });
    expect(inScheduled(t, REF)).toBe(true);
    expect(inToday(t, REF)).toBe(false);
    expect(inUnscheduled(t, none, REF)).toBe(false);
  });

  it('goes by When alone for Today; a reached deadline sets When to today (FR-3.7)', () => {
    const deferred = todo({ start: 'deferred', deadline: '2026-11-08' });
    expect(inToday(deferred, REF)).toBe(false);
    expect(inDeferred(deferred)).toBe(true);
    expect(deadlineWhen(deferred, REF)).toEqual({ start: 'unscheduled', startDate: REF });
    expect(deadlineWhen(todo({ start: 'inbox', deadline: REF }), REF)).toEqual({ start: 'unscheduled', startDate: REF });
    expect(deadlineWhen(todo({ startDate: '2026-11-20', deadline: REF }), REF)).toEqual({ start: 'unscheduled', startDate: REF });
    // Already in Today, not yet due, or closed: nothing changes.
    expect(deadlineWhen(todo({ startDate: '2026-11-01', deadline: REF }), REF)).toBeNull();
    expect(deadlineWhen(todo({ deadline: '2026-11-10' }), REF)).toBeNull();
    expect(deadlineWhen(todo({ deadline: REF, status: 'completed' }), REF)).toBeNull();
  });

  it('allows a When date up to the deadline (FR-3.6)', () => {
    expect(whenAfterDeadline('2026-11-20', '2026-11-15', REF)).toBe(true);
    expect(whenAfterDeadline('2026-11-15', '2026-11-15', REF)).toBe(false);
    expect(whenAfterDeadline(REF, '2026-11-01', REF)).toBe(false);
    expect(whenAfterDeadline(null, '2026-11-01', REF)).toBe(false);
    expect(whenAfterDeadline('2026-11-20', null, REF)).toBe(false);
  });

  it('keeps deferred tasks out of Unscheduled', () => {
    const t = todo({ start: 'deferred' });
    expect(inDeferred(t)).toBe(true);
    expect(inUnscheduled(t, none, REF)).toBe(false);
  });

  it('holds tasks of a deferred project back from Unscheduled', () => {
    const p = project({ start: 'deferred' });
    const t = todo({ projectId: p.id });
    expect(inUnscheduled(t, projectIndex([p]), REF)).toBe(false);
  });

  it('hides tasks of a trashed project', () => {
    const p = project({ trashedAt: '2026-11-09T00:00:00Z' });
    const s: Snapshot = { areas: [], headings: [], tags: [], contexts: [], checklistItems: [], savedSearches: [], projects: [p], todos: [todo({ projectId: p.id, startDate: REF })] };
    expect(visibleTodos(s)).toHaveLength(0);
    expect(sidebarCounts(s, REF).today).toBe(0);
  });

  it('excludes moved and trashed tasks from every active list', () => {
    const done = todo({ status: 'completed', startDate: REF, loggedAt: 'x' });
    const trashed = todo({ trashedAt: 'x', startDate: REF });
    for (const t of [done, trashed]) {
      expect(inToday(t, REF)).toBe(false);
      expect(inUnscheduled(t, none, REF)).toBe(false);
    }
  });

  it('groups Scheduled by day for a week, then by month', () => {
    const s: Snapshot = {
      areas: [],
      headings: [], tags: [], contexts: [], checklistItems: [], savedSearches: [],
      projects: [],
      todos: [todo({ startDate: '2026-11-10' }), todo({ startDate: '2026-11-10' }), todo({ startDate: '2026-12-20' })],
    };
    const groups = scheduledGroups(s, REF);
    expect(groups.map((g) => g.todos.length)).toEqual([2, 1]);
    expect(groups[0].title).toBe('Tomorrow');
  });

  it('lays Scheduled out: 7 days, the rest of the month, 4 months, then years (FR-21.6)', () => {
    const s: Snapshot = {
      areas: [],
      headings: [], tags: [], contexts: [], checklistItems: [], savedSearches: [],
      projects: [],
      todos: ['2026-11-12', '2026-11-25', '2026-12-20', '2027-03-31', '2027-04-02', '2028-08-01'].map((d) => todo({ startDate: d })),
    };
    // REF is Monday Nov 9: the week runs to Nov 16, the rest of November follows,
    // then December to March, then years from April 2027.
    const groups = scheduledGroups(s, REF);
    expect(groups.map((g) => [g.kind, g.title, g.subtitle ?? '', g.todos.length])).toEqual([
      ['day', 'Thursday', '', 1],
      ['range', 'November', '17–30', 1],
      ['month', 'December', '', 1],
      ['month', 'March', '', 1],
      ['year', '2027', '', 1],
      ['year', '2028', '', 1],
    ]);
    expect(groups[0]).toMatchObject({ key: '2026-11-12', day: '12', from: '2026-11-12', to: '2026-11-12' });
    // The seventh day is named too, not dated.
    const seventh = scheduledGroups({ ...s, todos: [todo({ startDate: '2026-11-16' })] }, REF)[0];
    expect([seventh.day, seventh.title]).toEqual(['16', 'Monday']);
    expect(groups[4]).toMatchObject({ from: '2027-04-01', to: '2027-12-31' });
  });

  it('shows a day, a rest of the month or a month with only calendar events, but never a year (FR-21.6)', () => {
    const s: Snapshot = { areas: [], headings: [], tags: [], contexts: [], checklistItems: [], savedSearches: [], projects: [], todos: [] };
    const asked: string[] = [];
    const groups = scheduledGroups(s, REF, (from, to) => {
      asked.push(`${from}/${to}`);
      return from === '2026-11-10' || from === '2026-11-17' || from === '2027-01-01';
    });
    expect(groups.map((g) => g.key)).toEqual(['2026-11-10', '2026-11', '2027-01']);
    expect(asked).not.toContain('2027-04-01/2027-12-31');
  });

  it('starts the months after the week when the week ends a month, and names the rest of a month the week runs into', () => {
    const none: Snapshot = { areas: [], headings: [], tags: [], contexts: [], checklistItems: [], savedSearches: [], projects: [], todos: [] };
    const all = () => true;
    // Nov 23: the week ends Nov 30, so no rest of November; December to March.
    expect(scheduledGroups(none, '2026-11-23', all).filter((g) => g.kind !== 'day').map((g) => g.title)).toEqual([
      'December', 'January', 'February', 'March',
    ]);
    // Nov 28: the week runs into December, whose rest follows; then January to April.
    const later = scheduledGroups(none, '2026-11-28', all).filter((g) => g.kind !== 'day');
    expect(later.map((g) => [g.title, g.subtitle ?? ''])).toEqual([
      ['December', '6–31'], ['January', ''], ['February', ''], ['March', ''], ['April', ''],
    ]);
    // The last day of a month: tomorrow is the 1st.
    expect(scheduledGroups(none, '2026-11-30', all)[0]).toMatchObject({ title: 'Tomorrow', day: '1' });
  });

  it('shows a task\'s date in Scheduled\'s later groups, not in its days', () => {
    expect(whenMark(todo({ startDate: '2026-11-16' }), REF, 'scheduled')).toBeNull();
    expect(whenMark(todo({ startDate: '2026-11-29' }), REF, 'scheduled')).toEqual({ kind: 'scheduled', label: 'Nov 29' });
  });

  it('splits Today into due (red) and the rest (grey), adding up to the list', () => {
    const s: Snapshot = {
      areas: [],
      headings: [], tags: [], contexts: [], checklistItems: [], savedSearches: [],
      projects: [],
      todos: [todo({ start: 'inbox' }), todo({ startDate: REF }), todo({ startDate: REF }), todo({ startDate: REF, deadline: REF })],
    };
    expect(sidebarCounts(s, REF)).toEqual({ inbox: 1, today: 2, due: 1 });
  });

  it('shows only the red count when every Today task is due', () => {
    const s: Snapshot = {
      areas: [],
      headings: [], tags: [], contexts: [], checklistItems: [], savedSearches: [],
      projects: [],
      todos: [todo({ startDate: REF, deadline: REF }), todo({ startDate: REF, deadline: '2026-11-01' })],
    };
    expect(sidebarCounts(s, REF)).toEqual({ inbox: 0, today: 0, due: 2 });
  });
});

describe('dates are shown in US English on any device (review C12)', () => {
  it('formats numeric dates month first, and names in English, even with another default region', async () => {
    const real = Intl.DateTimeFormat;
    // A device set to the UK: any formatter left on the default would give 23/11/26 and "Montag"-style names.
    const uk = function (locale?: string | string[], options?: Intl.DateTimeFormatOptions) {
      return new real(locale ?? 'en-GB', options);
    } as unknown as typeof Intl.DateTimeFormat;
    Object.assign(uk, real);
    Intl.DateTimeFormat = uk;
    try {
      const { vi } = await import('vitest');
      vi.resetModules();
      const d = await import('../src/lib/model/dates');
      expect(d.formatNumeric('2026-11-23')).toBe('11/23/26');
      expect(d.formatShort('2026-11-23')).toBe('Nov 23');
    } finally {
      Intl.DateTimeFormat = real;
    }
  });
});
