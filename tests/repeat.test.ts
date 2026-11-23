/**
 * Repeating tasks (FR-4.1 to FR-4.4, FR-14.7; v1.2.12): the dates a rule
 * gives, its wording, copies made at launch and on completion, pause, stop,
 * undo, the lists, and schema 9. Repeating projects (FR-4.6; v1.6.0): whole
 * copies, the template's tasks, Scheduled, and schema 11; working ahead on
 * the template and its Repeat › commands (v1.6.1).
 */
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MyTasksDB, SCHEMA_VERSION, db } from '../src/lib/db/database';
import * as repo from '../src/lib/db/repo';
import { clearUndo, undo } from '../src/lib/db/history';
import { upgradeList } from '../src/lib/db/migrations';
import { addDays, today, weekday } from '../src/lib/model/dates';
import { inInbox, inScheduled, inScheduledProject, inToday, inUnscheduled, projectIndex, scheduledGroups, sidebarCounts, visibleTodos, whenMark } from '../src/lib/model/lists';
import { projectRepeatItems, sidebarMenuItems } from '../src/lib/model/sidebarMenu';
import { afterCompletionDate, copyId, dueCopy, firstDate, nextAfter, ruleText, upcoming } from '../src/lib/model/repeat';
import { isValidRecord } from '../src/lib/sync/validate';
import { bySortKey } from '../src/lib/model/order';
import type { RepeatRule } from '../src/lib/model/types';
import { snap } from './helpers';

/** A rule with defaults: fixed, every 1 day. */
function rule(over: Partial<RepeatRule> = {}): RepeatRule {
  return {
    mode: 'fixed', unit: 'day', interval: 1, weekdays: [], days: [], month: null,
    endCount: null, endDate: null, made: 0, deadlineDays: null, paused: false, ...over,
  };
}

const row = async (id: string) => (await db.todos.get(id))!;
const copiesOf = async (id: string) => (await db.todos.toArray()).filter((t) => t.repeatOf === id && t.deletedAt === null);

/** Run the launch sweep as if on `date`. */
async function sweepOn(date: string): Promise<void> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${date}T09:00:00`));
  await repo.sweepRules();
  vi.useRealTimers();
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  clearUndo();
});

afterEach(() => {
  vi.useRealTimers();
});

// 2026-11-16 is a Monday.
describe('dates', () => {
  it('steps through a weekly rule on several days, and every 2 weeks', () => {
    const r = rule({ unit: 'week', weekdays: [3, 1] });
    expect(nextAfter(r, '2026-11-16')).toBe('2026-11-18');
    expect(nextAfter(r, '2026-11-18')).toBe('2026-11-23');
    expect(nextAfter({ ...r, interval: 2 }, '2026-11-18')).toBe('2026-11-30');
    expect(firstDate(r, '2026-11-17')).toBe('2026-11-18');
    expect(firstDate({ ...r, interval: 2 }, '2026-11-19')).toBe('2026-11-23');
  });

  it('finds the 2nd Tuesday, the last day, and skips a month with no 5th Tuesday', () => {
    const second = rule({ unit: 'month', days: [{ ordinal: 2, weekday: 2 }] });
    expect(firstDate(second, '2026-11-16')).toBe('2026-12-08');
    expect(nextAfter(second, '2026-12-08')).toBe('2027-01-12');
    expect(nextAfter(rule({ unit: 'month', days: [{ ordinal: -1, weekday: null }] }), '2026-11-30')).toBe('2026-12-31');
    expect(firstDate(rule({ unit: 'month', days: [{ ordinal: 5, weekday: 2 }] }), '2026-11-16')).toBe('2026-12-29');
  });

  it('puts the 31st on a shorter month’s last day', () => {
    const r = rule({ unit: 'month', days: [{ ordinal: 31, weekday: null }] });
    expect(nextAfter(r, '2027-01-31')).toBe('2027-02-28');
    expect(nextAfter(r, '2027-02-28')).toBe('2027-03-31');
  });

  it('steps through yearly rules, Feb 29 included', () => {
    const dec8 = rule({ unit: 'year', days: [{ ordinal: 8, weekday: null }], month: 12 });
    expect(firstDate(dec8, '2026-11-16')).toBe('2026-12-08');
    expect(nextAfter(dec8, '2026-12-08')).toBe('2027-12-08');
    const leap = rule({ unit: 'year', days: [{ ordinal: 29, weekday: null }], month: 2 });
    expect(firstDate(leap, '2026-11-16')).toBe('2027-02-28');
    expect(nextAfter(leap, '2027-02-28')).toBe('2028-02-29');
  });

  it('counts after completion from the day the copy was done', () => {
    expect(afterCompletionDate(rule({ mode: 'afterCompletion', unit: 'day', interval: 3 }), '2026-11-16')).toBe('2026-11-19');
    expect(afterCompletionDate(rule({ mode: 'afterCompletion', unit: 'month' }), '2027-01-31')).toBe('2027-02-28');
    expect(afterCompletionDate(rule({ mode: 'afterCompletion', unit: 'year' }), '2026-11-16')).toBe('2027-11-16');
  });

  it('lists upcoming dates up to the end date', () => {
    const r = rule({ unit: 'week', weekdays: [1], endDate: '2026-12-01' });
    expect(upcoming(r, '2026-11-16', 5)).toEqual(['2026-11-16', '2026-11-23', '2026-11-30']);
  });
});

describe('due copies', () => {
  const weekly = rule({ unit: 'week', weekdays: [1] });

  it('makes one copy, for the latest date, after missed ones', () => {
    expect(dueCopy(weekly, '2026-11-02', '2026-11-16')).toEqual({ date: '2026-11-16', next: '2026-11-23', finished: false });
    expect(dueCopy(weekly, '2026-11-23', '2026-11-16')).toBeNull();
  });

  it('starts a copy earlier by the deadline offset', () => {
    const r = { ...weekly, deadlineDays: 2 };
    expect(dueCopy(r, '2026-11-23', '2026-11-21')?.date).toBe('2026-11-23');
    expect(dueCopy(r, '2026-11-23', '2026-11-20')).toBeNull();
  });

  it('makes nothing while paused, and finishes at the end count or date', () => {
    expect(dueCopy({ ...weekly, paused: true }, '2026-11-16', '2026-11-16')).toBeNull();
    expect(dueCopy({ ...weekly, endCount: 1 }, '2026-11-16', '2026-11-16')).toEqual({ date: '2026-11-16', next: null, finished: true });
    expect(dueCopy({ ...weekly, endDate: '2026-11-20' }, '2026-11-16', '2026-11-16')?.finished).toBe(true);
  });

  it('gives each copy the same id on every device, and a new one each date', () => {
    expect(copyId('t1', '2026-11-16')).toBe(copyId('t1', '2026-11-16'));
    expect(copyId('t1', '2026-11-16')).not.toBe(copyId('t1', '2026-11-23'));
    expect(copyId('t1', '2026-11-16')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('wording', () => {
  it('writes the rule in words', () => {
    expect(ruleText(rule({ unit: 'week', weekdays: [3, 1] }))).toBe('Repeat every week on Monday and Wednesday');
    expect(ruleText(rule({ unit: 'week', interval: 2, weekdays: [1, 3, 5] }))).toBe('Repeat every 2 weeks on Monday, Wednesday and Friday');
    expect(ruleText(rule({ unit: 'month', days: [{ ordinal: 16, weekday: null }] }))).toBe('Repeat every month on the 16th day');
    expect(ruleText(rule({ unit: 'month', days: [{ ordinal: 2, weekday: 2 }] }))).toBe('Repeat every month on the 2nd Tuesday');
    expect(ruleText(rule({ unit: 'year', days: [{ ordinal: 8, weekday: null }], month: 12 }))).toBe('Repeat every year on the 8th day in December');
    expect(ruleText(rule({ interval: 3 }))).toBe('Repeat every 3 days');
    expect(ruleText(rule({ mode: 'afterCompletion', unit: 'week' }))).toBe('Repeat 1 week after completion');
  });
});

describe('copies', () => {
  /** A weekly task on today's weekday, starting today. */
  async function weeklyToday(over: Partial<RepeatRule> = {}, priority?: 1 | 2 | 3 | 4 | 5) {
    const projectId = await repo.createProject({ title: 'Home' });
    const id = await repo.createTodo({ title: 'Water plants', projectId, priority });
    await repo.addChecklistItems(id, ['fern', 'palm']);
    await repo.setRepeat(id, rule({ unit: 'week', weekdays: [weekday(today())], ...over }), today());
    return id;
  }

  it('makes the task a template, with today’s copy in Today and the template on next week', async () => {
    const id = await weeklyToday();
    const [copy] = await copiesOf(id);
    const s = await snap();
    const ref = today();
    expect(copy).toMatchObject({ title: 'Water plants', startDate: ref, repeat: null, repeatOf: id, status: 'open' });
    expect(inToday(copy, ref)).toBe(true);
    const template = await row(id);
    expect(template).toMatchObject({ startDate: addDays(ref, 7), repeatOf: null });
    expect(template.repeat?.made).toBe(1);
    expect(inToday(template, ref)).toBe(false);
    expect(inScheduled(template, ref)).toBe(true);
    expect(whenMark(template, ref, null)).toEqual({ kind: 'scheduled', label: expect.any(String) });
    expect(sidebarCounts(s, ref).today).toBe(1);
    // The checklist is copied, unchecked.
    expect(bySortKey(s.checklistItems.filter((c) => c.todoId === copy.id)).map((c) => [c.title, c.completed])).toEqual([['fern', false], ['palm', false]]);
  });

  it('copies a priority the user set on the template, and leaves others to the automatic rules (FR-14.7)', async () => {
    const id = await weeklyToday({}, 2);
    expect((await copiesOf(id))[0]).toMatchObject({ priority: 2, prioritySource: 'user' });
    const other = await weeklyToday();
    expect((await copiesOf(other))[0].prioritySource).not.toBe('user');
  });

  it('gives copies the deadline and starts them earlier by the offset (FR-4.2)', async () => {
    const id = await repo.createTodo({ title: 'Rent' });
    const due = addDays(today(), 2);
    await repo.setRepeat(id, rule({ unit: 'week', weekdays: [weekday(due)], deadlineDays: 2 }), due);
    expect((await copiesOf(id))[0]).toMatchObject({ startDate: today(), deadline: due });
  });

  it('makes the next copy once its date comes, only once, and one for missed dates', async () => {
    const id = await weeklyToday();
    await sweepOn(addDays(today(), 6));
    expect(await copiesOf(id)).toHaveLength(1);
    await sweepOn(addDays(today(), 7));
    await sweepOn(addDays(today(), 7));
    expect(await copiesOf(id)).toHaveLength(2);
    await sweepOn(addDays(today(), 28));
    const copies = await copiesOf(id);
    expect(copies).toHaveLength(3);
    expect(copies.map((c) => c.startDate).sort().at(-1)).toBe(addDays(today(), 28));
    expect((await row(id)).startDate).toBe(addDays(today(), 35));
  });

  it('after completion: the next copy is dated from when the last was done', async () => {
    const id = await repo.createTodo({ title: 'Haircut' });
    await repo.setRepeat(id, rule({ mode: 'afterCompletion', unit: 'day', interval: 3 }), today());
    const [first] = await copiesOf(id);
    expect((await row(id)).startDate).toBeNull();
    await repo.setTodoStatus(first.id, 'completed');
    expect((await row(id)).startDate).toBe(addDays(today(), 3));
    expect(await copiesOf(id)).toHaveLength(1);
    await sweepOn(addDays(today(), 3));
    expect(await copiesOf(id)).toHaveLength(2);
    expect((await row(id)).startDate).toBeNull();
  });

  it('after completion: trashing the copy releases the template, dated from today; undo puts both back', async () => {
    const id = await repo.createTodo({ title: 'Change the filter' });
    await repo.setRepeat(id, rule({ mode: 'afterCompletion', unit: 'day', interval: 3 }), today());
    const [copy] = await copiesOf(id);
    const other = await repo.createTodo({ title: 'Unrelated' });
    await repo.setTodoTrashed(other, true);
    expect((await row(id)).startDate).toBeNull(); // Its copy is still open.
    await repo.setTodoTrashed(copy.id, true);
    expect((await row(id)).startDate).toBe(addDays(today(), 3));
    await sweepOn(addDays(today(), 3));
    expect((await copiesOf(id)).filter((c) => !c.trashedAt)).toHaveLength(1);
  });

  it('after completion: undoing the trash brings the copy back and the template waits again', async () => {
    const id = await repo.createTodo({ title: 'Change the filter' });
    await repo.setRepeat(id, rule({ mode: 'afterCompletion', unit: 'day', interval: 3 }), today());
    const [copy] = await copiesOf(id);
    await repo.setTodoTrashed(copy.id, true);
    await undo();
    expect((await row(copy.id)).trashedAt).toBeNull();
    expect((await row(id)).startDate).toBeNull();
  });

  it('Create Next Copy makes a copy even when that date’s copy was deleted, with its checklist', async () => {
    const id = await repo.createTodo({ title: 'Change the filter' });
    await repo.addChecklistItems(id, ['Buy a filter']);
    await repo.setRepeat(id, rule({ mode: 'afterCompletion', unit: 'week' }), today());
    const [gone] = await copiesOf(id);
    await db.todos.update(gone.id, { deletedAt: new Date().toISOString() }); // Today's copy, deleted.
    const made = await repo.createNextCopy(id);
    expect(made).toBeDefined();
    expect(made).not.toBe(gone.id);
    const copy = await row(made!);
    expect(copy).toMatchObject({ status: 'open', deletedAt: null, repeatOf: id, startDate: today() });
    const items = (await db.checklistItems.toArray()).filter((c) => c.todoId === made && c.deletedAt === null);
    expect(items.map((c) => c.title)).toEqual(['Buy a filter']);
  });

  it('after completion: a template stuck with its copy already gone is released at the next sweep', async () => {
    const id = await repo.createTodo({ title: 'Change the filter' });
    await repo.setRepeat(id, rule({ mode: 'afterCompletion', unit: 'week' }), today());
    const [copy] = await copiesOf(id);
    // As left by an earlier version, or synced from another device: the copy deleted, the template waiting.
    await db.todos.update(copy.id, { deletedAt: new Date().toISOString() });
    await repo.sweepRules();
    expect((await row(id)).startDate).toBe(addDays(today(), 7));
  });

  it('pauses and resumes, stops, and ends after a count', async () => {
    const id = await weeklyToday();
    await repo.setRepeatPaused(id, true);
    await sweepOn(addDays(today(), 7));
    expect(await copiesOf(id)).toHaveLength(1);
    const s = await snap();
    const paused = await row(id);
    expect(whenMark(paused, today(), null)).toEqual({ kind: 'paused' });
    expect(inScheduled(paused, today())).toBe(false);
    expect(inUnscheduled(paused, projectIndex(s.projects), today())).toBe(true);
    await repo.setRepeatPaused(id, false);
    expect((await row(id)).repeat?.paused).toBe(false);

    await repo.stopRepeat(id);
    expect(await row(id)).toMatchObject({ repeat: null });
    expect(await copiesOf(id)).toHaveLength(0);

    const twice = await weeklyToday({ endCount: 2 });
    await sweepOn(addDays(today(), 7));
    expect(await copiesOf(twice)).toHaveLength(2);
    expect(await row(twice)).toMatchObject({ repeat: null, status: 'completed' });
  });

  it('checking off a template completes its next copy early; unchecking that copy leaves it open (FR-4.4)', async () => {
    const id = await repo.createTodo({ title: 'Loose' });
    const next = addDays(today(), 7);
    await repo.setRepeat(id, rule({ unit: 'week', weekdays: [weekday(today())] }), next);
    expect(inInbox(await row(id))).toBe(false);
    await repo.setTodoStatus(id, 'completed');
    const [early] = await copiesOf(id);
    expect(early).toMatchObject({ startDate: next, status: 'completed' });
    expect(await row(id)).toMatchObject({ status: 'open', startDate: addDays(today(), 14) });
    await repo.setTodoStatus(early.id, 'open');
    expect(await row(early.id)).toMatchObject({ status: 'open', startDate: next });
    expect((await row(id)).startDate).toBe(addDays(today(), 14));
    // Mark as Canceled skips the next copy the same way.
    await repo.setTodoStatus(id, 'canceled');
    expect((await copiesOf(id)).find((c) => c.startDate === addDays(today(), 14))?.status).toBe('canceled');
    expect((await row(id)).startDate).toBe(addDays(today(), 21));
  });

  it('after completion, completing early counts the next date from today', async () => {
    const id = await repo.createTodo({ title: 'Haircut' });
    await repo.setRepeat(id, rule({ mode: 'afterCompletion', unit: 'week' }), today());
    await repo.setTodoStatus((await copiesOf(id))[0].id, 'completed');
    expect((await row(id)).startDate).toBe(addDays(today(), 7));
    await repo.setTodoStatus(id, 'completed');
    const copies = await copiesOf(id);
    expect(copies.filter((c) => c.status === 'completed')).toHaveLength(2);
    expect((await row(id)).startDate).toBe(addDays(today(), 7));
  });

  it('Create Next Copy makes the next copy on its date, one undo step; Show Previous Copy finds the latest', async () => {
    const id = await weeklyToday();
    clearUndo();
    const made = await repo.createNextCopy(id);
    expect(await row(made!)).toMatchObject({ status: 'open', startDate: addDays(today(), 7), repeatOf: id });
    expect((await row(id)).startDate).toBe(addDays(today(), 14));
    expect((await repo.previousCopy(id))?.id).toBe(made);
    await undo();
    expect(await copiesOf(id)).toHaveLength(1);
    expect((await row(id)).startDate).toBe(addDays(today(), 7));
    expect((await repo.previousCopy(id))?.startDate).toBe(today());
  });

  it('is one undo step', async () => {
    const id = await repo.createTodo({ title: 'Water plants' });
    clearUndo();
    await repo.setRepeat(id, rule({ unit: 'week', weekdays: [weekday(today())] }), today());
    await undo();
    expect(await copiesOf(id)).toHaveLength(0);
    expect((await row(id)).repeat).toBeNull();
  });
});

describe('schema 9', () => {
  const at = '2026-11-16T00:00:00.000Z';
  const task = {
    id: 't', createdAt: at, modifiedAt: at, deletedAt: null, sortKey: 'a0', title: 'Old', notes: '', status: 'open',
    start: 'inbox', startDate: null, todaySortKey: null, deadline: null, priority: null, prioritySource: null,
    priorityBeforeAuto: null, tagIds: [], contextId: null, areaId: null, projectId: null, headingId: null,
    completedAt: null, loggedAt: null, trashedAt: null, releasedBy: null, releasedFrom: null,
  };

  it('upgrades a schema-8 list: tasks don’t repeat, tombstones stay bare', () => {
    const gone = { id: 'g', deletedAt: at, modifiedAt: at };
    const old = {
      schema: 8,
      tables: { areas: [], projects: [], headings: [], todos: [task, gone], checklistItems: [], tags: [], contexts: [], savedSearches: [] },
    };
    // Through every later step too: schema 13 adds part times (FR-19.10).
    const list = upgradeList(old, SCHEMA_VERSION);
    expect(isValidRecord('todos', task)).toBe(false);
    expect(list.tables.todos[0]).toEqual({ ...task, repeat: null, repeatOf: null, ft: {} });
    expect(list.tables.todos[1]).toEqual(gone);
    expect(isValidRecord('todos', list.tables.todos[0])).toBe(true);
  });

  it('upgrades a version-8 database with data in it', async () => {
    // Through every later step too (schema 10 changes no records).
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(9);
    const name = 'upgrade-to-9';
    const old = new Dexie(name);
    old.version(8).stores({
      areas: 'id, sortKey',
      projects: 'id, areaId, status, sortKey',
      headings: 'id, projectId, sortKey',
      todos: 'id, projectId, areaId, headingId, status, startDate, deadline, sortKey, contextId',
      checklistItems: 'id, todoId, sortKey',
      tags: 'id, parentTagId, sortKey',
      savedSearches: 'id, sortKey',
      changeLog: '++seq, entity, entityId, at',
      settings: 'key',
      contexts: 'id, sortKey',
    });
    await old.open();
    await old.table('todos').add(task);
    old.close();

    const upgraded = new MyTasksDB(name);
    await upgraded.open();
    expect(await upgraded.todos.get('t')).toEqual({ ...task, repeat: null, repeatOf: null, ft: {} });
    upgraded.close();
    await Dexie.delete(name);
  });

  it('refuses a rule with a bad field', () => {
    const good = { ...task, repeat: rule(), repeatOf: null, ft: {} };
    expect(isValidRecord('todos', good)).toBe(true);
    expect(isValidRecord('todos', { ...good, repeat: { ...rule(), interval: 0 } })).toBe(false);
    expect(isValidRecord('todos', { ...good, repeat: { ...rule(), weekdays: [7] } })).toBe(false);
    expect(isValidRecord('todos', { ...good, repeat: { ...rule(), extra: 1 } })).toBe(false);
  });
});

describe('repeating tasks stay correct (review C4)', () => {
  /** A project with a daily repeating task (and its copy for today) and an ordinary task. */
  async function setUp() {
    const projectId = await repo.createProject({ title: 'P' });
    const template = await repo.createTodo({ title: 'Water', projectId });
    await repo.setRepeat(template, rule(), today());
    const plain = await repo.createTodo({ title: 'Plain', projectId });
    return { projectId, template, plain, copy: (await copiesOf(template))[0] };
  }

  it('Duplicate gives an ordinary task, from a repeating task or one of its copies', async () => {
    const { template, copy } = await setUp();
    expect(copy).toBeDefined();
    const fromTemplate = await row((await repo.duplicateTodo(template))!);
    expect(fromTemplate.repeat).toBeNull();
    expect(fromTemplate.repeatOf).toBeNull();
    const fromCopy = await row((await repo.duplicateTodo(copy.id))!);
    expect(fromCopy.repeatOf).toBeNull();
    expect(fromCopy.todaySortKey).toBeNull();
    // Still one repeating task: tomorrow's sweep makes one copy, not two.
    await sweepOn(addDays(today(), 1));
    expect((await db.todos.toArray()).filter((t) => t.repeat !== null)).toHaveLength(1);
  });

  it('completing the project stops its repeating tasks: Completed, ordinary, copies freed', async () => {
    const { projectId, template, copy } = await setUp();
    await repo.closeProject(projectId, 'completed', 'completed');
    const t = await row(template);
    expect(t).toMatchObject({ status: 'completed', repeat: null, startDate: null });
    expect((await row(copy.id)).repeatOf).toBeNull();
    // Reopening the project doesn't bring the repeat back, and no more copies are made.
    await repo.reopenProject(projectId);
    await sweepOn(addDays(today(), 2));
    expect(await copiesOf(template)).toHaveLength(0);
    expect((await db.todos.toArray()).filter((x) => x.repeat !== null)).toHaveLength(0);
  });

  it('archiving a heading stops its repeating tasks too', async () => {
    const projectId = await repo.createProject({ title: 'P' });
    const headingId = (await repo.createHeading(projectId, 'H'))!;
    const template = await repo.createTodo({ title: 'Water', projectId, headingId });
    await repo.setRepeat(template, rule(), addDays(today(), 1));
    await repo.archiveHeading(headingId);
    expect(await row(template)).toMatchObject({ status: 'completed', repeat: null });
  });

  it('a repeating task is not converted to a project, and its menu has no Convert to Project', async () => {
    const { template, copy } = await setUp();
    expect(await repo.convertTodoToProject(template)).toBeUndefined();
    expect((await row(template)).repeat).not.toBeNull();
    const { todoMenuItems } = await import('../src/lib/model/todoMenu');
    const labels = (todo: { projectId: string | null; areaId: string | null; repeat?: RepeatRule | null }) =>
      todoMenuItems(todo, { mode: 'open', link: null, waiting: false }).map((i) => ('label' in i ? i.label : '-'));
    expect(labels(await row(template))).not.toContain('Convert to Project…');
    expect(labels(await row(copy.id))).toContain('Convert to Project…');
  });
});

describe('repeating projects (FR-4.6)', () => {
  const project = async (id: string) => (await db.projects.get(id))!;
  const projectCopiesOf = async (id: string) =>
    (await db.projects.toArray()).filter((p) => p.repeatOf === id && p.deletedAt === null);

  /** "Weekly review": a task with a dated checklist, a heading with a task, and an archived heading. */
  async function weeklyReview() {
    const areaId = await repo.createArea('Work');
    const id = await repo.createProject({ title: 'Weekly review', notes: 'Every Friday', areaId });
    const inbox = await repo.createTodo({ title: 'Clear inbox', projectId: id, startDate: addDays(today(), 1), deadline: addDays(today(), 3) });
    await repo.addChecklistItems(inbox, ['mail', 'notes']);
    const plan = await repo.createHeading(id, 'Plan');
    await repo.createTodo({ title: 'Plan next week', projectId: id, headingId: plan, priority: 2 });
    const old = await repo.createHeading(id, 'Old');
    await repo.createTodo({ title: 'Archived task', projectId: id, headingId: old });
    await repo.archiveHeading(old);
    return { id, areaId, inbox };
  }

  it('makes the project the template, with a whole copy for today', async () => {
    const { id, areaId, inbox } = await weeklyReview();
    const ref = today();
    await repo.setProjectRepeat(id, rule({ unit: 'week', weekdays: [weekday(ref)] }), ref);

    const template = await project(id);
    expect(template).toMatchObject({ startDate: addDays(ref, 7), repeatOf: null, status: 'open' });
    expect(template.repeat?.made).toBe(1);

    const [copy] = await projectCopiesOf(id);
    expect(copy).toMatchObject({ id: copyId(id, ref), title: 'Weekly review', notes: 'Every Friday', areaId, startDate: ref, repeat: null });
    // Placed just above the template among its siblings.
    expect(copy.sortKey < template.sortKey).toBe(true);

    const s = await snap();
    const headings = s.headings.filter((h) => h.projectId === copy.id);
    expect(headings.map((h) => h.title)).toEqual(['Plan']);
    const tasks = bySortKey(s.todos.filter((t) => t.projectId === copy.id));
    expect(tasks.map((t) => t.title)).toEqual(['Clear inbox', 'Plan next week']);
    expect(tasks[1]).toMatchObject({ headingId: headings[0].id, priority: 2, repeatOf: null });
    // The first copy is the project as it was: its task keeps its dates.
    expect(tasks[0]).toMatchObject({ startDate: addDays(ref, 1), deadline: addDays(ref, 3) });
    expect(s.checklistItems.filter((c) => c.todoId === tasks[0].id).map((c) => c.title).sort()).toEqual(['mail', 'notes']);

    // The template's tasks lose their dates (they belong to copies), and stay out of every list.
    expect(await row(inbox)).toMatchObject({ startDate: null, deadline: null });
    const p = projectIndex(s.projects);
    const templateTasks = s.todos.filter((t) => t.projectId === id);
    expect(templateTasks.every((t) => !inUnscheduled(t, p, ref) && !inToday(t, ref))).toBe(true);
    expect(visibleTodos(s).some((t) => t.projectId === id)).toBe(false);
    expect(visibleTodos(s).filter((t) => t.projectId === copy.id)).toHaveLength(2);
  });

  it('lists the template in Scheduled on its next date, with the day’s tasks', async () => {
    const { id } = await weeklyReview();
    const ref = today();
    await repo.setProjectRepeat(id, rule({ unit: 'day', interval: 2 }), addDays(ref, 2));
    const s = await snap();
    expect(inScheduledProject((await project(id)), ref)).toBe(true);
    const groups = scheduledGroups(s, ref);
    const group = groups.find((g) => g.projects?.some((p) => p.id === id));
    expect(group?.from).toBe(addDays(ref, 2));
    // No copy yet: none is due.
    expect(await projectCopiesOf(id)).toHaveLength(0);
  });

  it('makes the next copy when its date comes, once, with the same ids on every device', async () => {
    const { id } = await weeklyReview();
    const ref = today();
    await repo.setProjectRepeat(id, rule({ unit: 'day' }), addDays(ref, 1));
    await sweepOn(addDays(ref, 1));
    await sweepOn(addDays(ref, 1));
    const copies = await projectCopiesOf(id);
    expect(copies.map((c) => c.id)).toEqual([copyId(id, addDays(ref, 1))]);
    const tasks = (await db.todos.toArray()).filter((t) => t.projectId === copies[0].id);
    expect(tasks).toHaveLength(2);
    // The copy's tasks are open with no dates of their own, its checklist unchecked.
    expect(tasks.every((t) => t.status === 'open' && t.startDate === null)).toBe(true);
    expect((await project(id)).startDate).toBe(addDays(ref, 2));
  });

  it('Create Next Copy makes it now, on its date; Show Previous Copy finds it; one undo step', async () => {
    const { id } = await weeklyReview();
    const ref = today();
    await repo.setProjectRepeat(id, rule({ unit: 'day' }), addDays(ref, 1));
    clearUndo();
    const made = await repo.createNextProjectCopy(id);
    expect(made).toBe(copyId(id, addDays(ref, 1)));
    expect((await project(made!)).startDate).toBe(addDays(ref, 1));
    expect((await project(id)).startDate).toBe(addDays(ref, 2));
    expect((await repo.previousProjectCopy(id))?.id).toBe(made);
    await undo();
    expect(await projectCopiesOf(id)).toHaveLength(0);
    expect((await project(id)).startDate).toBe(addDays(ref, 1));
  });

  it('after completion: completing a copy dates the next from today', async () => {
    const { id } = await weeklyReview();
    const ref = today();
    await repo.setProjectRepeat(id, rule({ mode: 'afterCompletion', unit: 'week' }), ref);
    const [copy] = await projectCopiesOf(id);
    expect((await project(id)).startDate).toBeNull();
    await repo.closeProject(copy.id, 'completed', 'completed');
    expect((await project(id)).startDate).toBe(addDays(ref, 7));
  });

  it('Create Next Copy on a project makes a copy even when that date’s copy was deleted, with its tasks', async () => {
    const { id } = await weeklyReview();
    const ref = today();
    await repo.setProjectRepeat(id, rule({ mode: 'afterCompletion', unit: 'week' }), ref);
    const [gone] = await projectCopiesOf(id);
    await db.projects.update(gone.id, { deletedAt: new Date().toISOString() });
    const made = await repo.createNextProjectCopy(id);
    expect(made).toBeDefined();
    expect(made).not.toBe(gone.id);
    expect(await project(made!)).toMatchObject({ status: 'open', deletedAt: null, repeatOf: id });
    const tasks = (await db.todos.toArray()).filter((t) => t.projectId === made && t.deletedAt === null);
    expect(tasks.length).toBeGreaterThan(0);
  });

  it('after completion: trashing the project copy releases the template', async () => {
    const { id } = await weeklyReview();
    const ref = today();
    await repo.setProjectRepeat(id, rule({ mode: 'afterCompletion', unit: 'week' }), ref);
    const [copy] = await projectCopiesOf(id);
    await repo.setProjectTrashed(copy.id, true);
    expect((await project(id)).startDate).toBe(addDays(ref, 7));
  });

  it('a repeating task inside stops repeating; Duplicate gives an ordinary project; the menu leaves off Start Date and Duplicate', async () => {
    const { id } = await weeklyReview();
    const inner = await repo.createTodo({ title: 'Inner', projectId: id });
    await repo.setRepeat(inner, rule({ unit: 'week', weekdays: [weekday(addDays(today(), 3))] }), addDays(today(), 3));
    await repo.setProjectRepeat(id, rule({ unit: 'week', weekdays: [weekday(today())] }), addDays(today(), 7));
    expect((await row(inner)).repeat).toBeNull();
    const dup = await repo.duplicateProject(id);
    expect(await project(dup!)).toMatchObject({ repeat: null, repeatOf: null });
    const actions = sidebarMenuItems({ kind: 'project', id }, { status: 'open', template: true }).flatMap((i) => (i.kind === 'action' ? [i.action] : []));
    expect(actions).toContain('repeat-menu');
    expect(actions).not.toContain('repeat');
    expect(actions).not.toContain('when');
    expect(actions).not.toContain('duplicate');
    const plain = sidebarMenuItems({ kind: 'project', id }, { status: 'open' });
    expect(plain.some((i) => i.kind === 'action' && i.action === 'repeat' && i.label === 'Repeat…')).toBe(true);
  });
});

describe('repeating projects: working ahead and the template’s commands (FR-4.6, v1.6.1)', () => {
  const project = async (id: string) => (await db.projects.get(id))!;
  const copiesOf = async (id: string) => (await db.projects.toArray()).filter((p) => p.repeatOf === id && p.deletedAt === null);
  const tasksOf = async (projectId: string) => bySortKey((await db.todos.toArray()).filter((t) => t.projectId === projectId && !t.deletedAt));

  /** A daily repeating project starting tomorrow, with two tasks. */
  async function daily() {
    const id = await repo.createProject({ title: 'Daily' });
    const a = await repo.createTodo({ title: 'A', projectId: id });
    const b = await repo.createTodo({ title: 'B', projectId: id });
    await repo.setProjectRepeat(id, rule({ unit: 'day' }), addDays(today(), 1));
    clearUndo();
    return { id, a, b };
  }

  it('Complete on the template closes the next copy early, its tasks as chosen; the template moves on, its tasks untouched', async () => {
    const { id, a, b } = await daily();
    const ref = today();
    await repo.closeProject(id, 'completed', 'canceled');
    const [copy] = await copiesOf(id);
    expect(copy).toMatchObject({ id: copyId(id, addDays(ref, 1)), status: 'completed', startDate: addDays(ref, 1) });
    expect((await tasksOf(copy.id)).map((t) => t.status)).toEqual(['canceled', 'canceled']);
    expect(await project(id)).toMatchObject({ status: 'open', startDate: addDays(ref, 2) });
    expect([(await row(a)).status, (await row(b)).status]).toEqual(['open', 'open']);
    // One undo step takes it all back.
    await undo();
    expect(await copiesOf(id)).toHaveLength(0);
    expect((await project(id)).startDate).toBe(addDays(ref, 1));
  });

  it('Create Copy Now: only a template’s tasks are asked about; the change goes to their task in the next copy', async () => {
    const { id, a } = await daily();
    const other = await repo.createTodo({ title: 'Elsewhere' });
    expect(await repo.templateTaskIds([other, a])).toEqual([a]);
    const made = await repo.copyNowForTasks([a]);
    const date = addDays(today(), 1);
    expect(made).toEqual({ projectIds: [copyId(id, date)], taskIds: [copyId(a, date)] });
    expect((await row(copyId(a, date))).title).toBe('A');
    // The template moves on; its task is left as it was.
    expect((await project(id)).startDate).toBe(addDays(today(), 2));
    expect(await row(a)).toMatchObject({ status: 'open', startDate: null });
  });

  it('pauses and resumes; resumed, a copy that came due is made', async () => {
    const { id } = await daily();
    await repo.setProjectRepeatPaused(id, true);
    expect((await project(id)).repeat?.paused).toBe(true);
    expect(inScheduledProject(await project(id), today())).toBe(false);
    await sweepOn(addDays(today(), 1));
    expect(await copiesOf(id)).toHaveLength(0);
    const tomorrow = addDays(today(), 1);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(`${tomorrow}T09:00:00`));
    await repo.setProjectRepeatPaused(id, false);
    vi.useRealTimers();
    expect(await copiesOf(id)).toHaveLength(1);
    expect(projectRepeatItems(false).flatMap((i) => (i.kind === 'action' ? [i.label] : []))).toEqual([
      'Edit Rule…', 'Show Previous Copy', 'Create Next Copy', 'Pause', 'Stop…',
    ]);
    expect(projectRepeatItems(true).some((i) => i.kind === 'action' && i.action === 'resume')).toBe(true);
  });

  it('Stop makes the template and its copies ordinary projects; its tasks show again', async () => {
    const { id, a } = await daily();
    const copy = await repo.createNextProjectCopy(id);
    await repo.stopProjectRepeat(id);
    expect(await project(id)).toMatchObject({ repeat: null, startDate: addDays(today(), 2) });
    expect((await project(copy!)).repeatOf).toBeNull();
    expect(visibleTodos(await snap()).some((t) => t.id === a)).toBe(true);
  });
});

describe('schema 11', () => {
  const at = '2026-11-20T00:00:00.000Z';
  const old = {
    id: 'p', createdAt: at, modifiedAt: at, deletedAt: null, sortKey: 'a0', title: 'Old', notes: '', status: 'open',
    start: 'unscheduled', startDate: null, deadline: null, tagIds: [], areaId: null, completedAt: null, loggedAt: null,
    trashedAt: null, sortByDate: false,
  };

  it('upgrades a schema-10 list: projects don’t repeat, tombstones stay bare', () => {
    const gone = { id: 'g', deletedAt: at, modifiedAt: at };
    const list = upgradeList(
      { schema: 10, tables: { areas: [], projects: [old, gone], headings: [], todos: [], checklistItems: [], tags: [], contexts: [], savedSearches: [] } },
      SCHEMA_VERSION,
    );
    expect(isValidRecord('projects', old)).toBe(false);
    expect(list.tables.projects[0]).toEqual({ ...old, repeat: null, repeatOf: null, ft: {} });
    expect(list.tables.projects[1]).toEqual(gone);
    expect(isValidRecord('projects', list.tables.projects[0])).toBe(true);
    expect(isValidRecord('projects', { ...old, repeat: rule(), repeatOf: null, ft: {} })).toBe(true);
    expect(isValidRecord('projects', { ...old, repeat: { ...rule(), unit: 'hour' }, repeatOf: null, ft: {} })).toBe(false);
  });

  it('upgrades a version-10 database with data in it', async () => {
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(11);
    const name = 'upgrade-to-11';
    const v10 = new Dexie(name);
    v10.version(10).stores({
      areas: 'id, sortKey',
      projects: 'id, areaId, status, sortKey',
      headings: 'id, projectId, sortKey',
      todos: 'id, projectId, areaId, headingId, status, startDate, deadline, sortKey, contextId',
      checklistItems: 'id, todoId, sortKey',
      tags: 'id, parentTagId, sortKey',
      savedSearches: 'id, sortKey',
      changeLog: '++seq, entity, entityId, at',
      settings: 'key',
      contexts: 'id, sortKey',
    });
    await v10.open();
    await v10.table('projects').add(old);
    v10.close();
    const upgraded = new MyTasksDB(name);
    await upgraded.open();
    expect(await upgraded.projects.get('p')).toEqual({ ...old, repeat: null, repeatOf: null, ft: {} });
    upgraded.close();
    await Dexie.delete(name);
  });
});
