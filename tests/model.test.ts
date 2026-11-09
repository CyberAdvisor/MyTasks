import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, deadlineLabel, formatRelative } from '../src/lib/model/dates';
import { uuidv7 } from '../src/lib/model/ids';
import { keyAtEnd, keyAtStart, keyBetween } from '../src/lib/model/order';
import {
  inDeferred,
  inInbox,
  inScheduled,
  inToday,
  inUnscheduled,
  projectIndex,
  scheduledGroups,
  sidebarCounts,
  visibleTodos,
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

  it('puts unfiled, undated to-dos in the Inbox only', () => {
    const t = todo({ start: 'inbox' });
    expect(inInbox(t)).toBe(true);
    expect(inToday(t, REF)).toBe(false);
    expect(inUnscheduled(t, none, REF)).toBe(false);
  });

  it('shows to-dos dated today or earlier in Today and Unscheduled', () => {
    const t = todo({ startDate: '2026-11-08' });
    expect(inToday(t, REF)).toBe(true);
    expect(inUnscheduled(t, none, REF)).toBe(true);
    expect(inScheduled(t, REF)).toBe(false);
  });

  it('shows future-dated to-dos in Scheduled only', () => {
    const t = todo({ startDate: '2026-11-15' });
    expect(inScheduled(t, REF)).toBe(true);
    expect(inToday(t, REF)).toBe(false);
    expect(inUnscheduled(t, none, REF)).toBe(false);
  });

  it('pulls due and overdue to-dos into Today, even when deferred', () => {
    const t = todo({ start: 'deferred', deadline: '2026-11-08' });
    expect(inToday(t, REF)).toBe(true);
    expect(inDeferred(t, REF)).toBe(false);
  });

  it('keeps deferred to-dos out of Unscheduled', () => {
    const t = todo({ start: 'deferred' });
    expect(inDeferred(t, REF)).toBe(true);
    expect(inUnscheduled(t, none, REF)).toBe(false);
  });

  it('holds to-dos of a deferred project back from Unscheduled', () => {
    const p = project({ start: 'deferred' });
    const t = todo({ projectId: p.id });
    expect(inUnscheduled(t, projectIndex([p]), REF)).toBe(false);
  });

  it('hides to-dos of a trashed project', () => {
    const p = project({ trashedAt: '2026-11-09T00:00:00Z' });
    const s: Snapshot = { areas: [], headings: [], tags: [], checklistItems: [], savedSearches: [], projects: [p], todos: [todo({ projectId: p.id, startDate: REF })] };
    expect(visibleTodos(s)).toHaveLength(0);
    expect(sidebarCounts(s, REF).today).toBe(0);
  });

  it('excludes completed and trashed to-dos from every active list', () => {
    const done = todo({ status: 'completed', startDate: REF });
    const trashed = todo({ trashedAt: 'x', startDate: REF });
    for (const t of [done, trashed]) {
      expect(inToday(t, REF)).toBe(false);
      expect(inUnscheduled(t, none, REF)).toBe(false);
    }
  });

  it('groups Scheduled by day for a week, then by month', () => {
    const s: Snapshot = {
      areas: [],
      headings: [], tags: [], checklistItems: [], savedSearches: [],
      projects: [],
      todos: [todo({ startDate: '2026-11-10' }), todo({ startDate: '2026-11-10' }), todo({ startDate: '2026-12-20' })],
    };
    const groups = scheduledGroups(s, REF);
    expect(groups.map((g) => g.todos.length)).toEqual([2, 1]);
    expect(groups[0].title).toBe('Tomorrow');
  });

  it('counts Today and due items for the sidebar', () => {
    const s: Snapshot = {
      areas: [],
      headings: [], tags: [], checklistItems: [], savedSearches: [],
      projects: [],
      todos: [todo({ start: 'inbox' }), todo({ startDate: REF }), todo({ deadline: REF })],
    };
    expect(sidebarCounts(s, REF)).toEqual({ inbox: 1, today: 2, due: 1 });
  });
});
