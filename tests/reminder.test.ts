/**
 * Reminders (FR-3.8; v1.13.0): the stored value, typed reminders, presets and
 * labels; repeats keeping a time only, copies reminding on their own day;
 * import's reminder column; and schema 15.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MyTasksDB, SCHEMA_VERSION, db } from '../src/lib/db/database';
import * as repo from '../src/lib/db/repo';
import { clearUndo } from '../src/lib/db/history';
import { upgradeList } from '../src/lib/db/migrations';
import { addDays, today } from '../src/lib/model/dates';
import {
  copyReminderOf, formatTime, isReminderAt, isReminderTime, parseTime, parseTypedReminder,
  reminderLabel, reminderPresets, templateReminder,
} from '../src/lib/model/reminder';
import { isValidRecord } from '../src/lib/sync/validate';
import { readRows } from '../src/lib/import/rows';
import type { RepeatRule } from '../src/lib/model/types';
import { todo } from './helpers';
import Dexie from 'dexie';

/** Wednesday, November 25, 2026, at 7:14 AM. */
const NOW = new Date(2026, 10, 25, 7, 14);

function rule(over: Partial<RepeatRule> = {}): RepeatRule {
  return {
    mode: 'fixed', unit: 'day', interval: 1, weekdays: [], days: [], month: null,
    endCount: null, endDate: null, made: 0, deadlineDays: null, paused: false, ...over,
  };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  clearUndo();
});

afterEach(() => vi.useRealTimers());

describe('the stored value', () => {
  it('is a real date and time, or a time only', () => {
    expect(isReminderAt('2026-11-26T09:00')).toBe(true);
    expect(isReminderAt('2026-02-30T09:00')).toBe(false);
    expect(isReminderAt('2026-11-26T24:00')).toBe(false);
    expect(isReminderAt('2026-11-26 09:00')).toBe(false);
    expect(isReminderTime('10:00')).toBe(true);
    expect(isReminderTime('9:00')).toBe(false);
  });

  it('is checked when synced', () => {
    const at = '2026-11-25T14:00:00.000Z';
    const base = { ...todo({ createdAt: at, modifiedAt: at }), ft: {} };
    expect(isValidRecord('todos', { ...base, reminder: '2026-11-26T09:00' })).toBe(true);
    expect(isValidRecord('todos', { ...base, reminder: '10:00' })).toBe(true);
    expect(isValidRecord('todos', { ...base, reminder: 'tomorrow' })).toBe(false);
    const { reminder: _, ...without } = base;
    expect(isValidRecord('todos', without)).toBe(false);
  });

  it('a template keeps the time; a copy takes it on its own day', () => {
    expect(templateReminder('2026-11-26T10:00')).toBe('10:00');
    expect(templateReminder(null)).toBe(null);
    expect(copyReminderOf('10:00', '2026-11-27')).toBe('2026-11-27T10:00');
    expect(copyReminderOf('10:00', null)).toBe(null);
  });
});

describe('typed reminders', () => {
  it.each([
    ['tomorrow 9am', '2026-11-26T09:00'],
    ['tomorrow at 9 am', '2026-11-26T09:00'],
    ['fri 2:30pm', '2026-11-27T14:30'],
    ['jan 12 14:00', '2027-01-12T14:00'],
    ['dec 4', '2026-12-04T09:00'],
    ['tomorrow', '2026-11-26T09:00'],
    ['9pm', '2026-11-25T21:00'],
    ['noon', '2026-11-25T12:00'],
    ['in 2 hours', '2026-11-25T09:14'],
    ['in 30 minutes', '2026-11-25T07:44'],
    ['an hour', '2026-11-25T08:14'],
  ])('"%s" is %s', (typed, expected) => {
    expect(parseTypedReminder(typed, NOW)).toBe(expected);
  });

  it.each(['', 'someday', 'tomorrow 25pm', 'fri 9:75'])('"%s" is not a reminder', (typed) => {
    expect(parseTypedReminder(typed, NOW)).toBe(null);
  });

  it('reads times in several forms', () => {
    expect(parseTime('9')).toBe('09:00');
    expect(parseTime('9.30PM')).toBe('21:30');
    expect(parseTime('12am')).toBe('00:00');
    expect(parseTime('12pm')).toBe('12:00');
    expect(parseTime('13pm')).toBe(null);
  });
});

describe('presets and labels', () => {
  it('Later Today, Tomorrow, and On the start date when there is one', () => {
    expect(reminderPresets(NOW, '2026-11-28')).toEqual([
      { label: 'Later Today', value: '2026-11-25T10:00' },
      { label: 'Tomorrow', value: '2026-11-26T09:00' },
      { label: 'On the start date', value: '2026-11-28T09:00' },
    ]);
    // Late in the evening there is no later today, and a past start date gives no preset.
    expect(reminderPresets(new Date(2026, 10, 25, 22, 30), '2026-11-20').map((p) => p.label)).toEqual(['Tomorrow']);
  });

  it('names the day', () => {
    expect(reminderLabel('2026-11-25T14:00', '2026-11-25')).toBe('Today, 2:00 PM');
    expect(reminderLabel('2026-11-26T09:00', '2026-11-25')).toBe('Tomorrow, 9:00 AM');
    expect(reminderLabel('2026-11-27T09:05', '2026-11-25')).toMatch(/^Fri, Nov 27, 9:05 AM$/);
    expect(reminderLabel('19:30', '2026-11-25')).toBe("7:30 PM on each copy's day");
    expect(formatTime('00:00')).toBe('12:00 AM');
  });
});

describe('reminders on tasks', () => {
  it('a task keeps its reminder; a template only the time', async () => {
    const id = await repo.createTodo({ title: 'Call' });
    await repo.setReminder(id, '2026-11-26T09:00');
    expect((await db.todos.get(id))!.reminder).toBe('2026-11-26T09:00');
    const pills = await repo.createTodo({ title: 'Pills', reminder: '2026-11-26T10:00' });
    await repo.setRepeat(pills, rule(), today());
    expect((await db.todos.get(pills))!.reminder).toBe('10:00');
    await repo.setReminder(pills, `${addDays(today(), 3)}T08:30`);
    expect((await db.todos.get(pills))!.reminder).toBe('08:30');
  });

  it("each copy reminds at the template's time on its own day", async () => {
    const pills = await repo.createTodo({ title: 'Pills', reminder: '2026-11-26T10:00' });
    await repo.setRepeat(pills, rule(), today());
    const copy = (await db.todos.toArray()).find((t) => t.repeatOf === pills)!;
    expect(copy.reminder).toBe(`${today()}T10:00`);
  });

  it('stopping the repeat puts the time on the date it keeps', async () => {
    const pills = await repo.createTodo({ title: 'Pills', reminder: '2026-11-26T10:00' });
    await repo.setRepeat(pills, rule(), addDays(today(), 2));
    await repo.stopRepeat(pills);
    expect((await db.todos.get(pills))!.reminder).toBe(`${addDays(today(), 2)}T10:00`);
  });

  it("a repeating project's tasks keep a time, and its copies' tasks a date", async () => {
    const projectId = await repo.createProject({ title: 'Week' });
    const task = await repo.createTodo({ title: 'Plan', projectId, reminder: '2026-11-26T08:00' });
    await repo.setProjectRepeat(projectId, rule({ unit: 'week' }), today());
    expect((await db.todos.get(task))!.reminder).toBe('08:00');
    const copyTask = (await db.todos.toArray()).find((t) => t.projectId !== projectId && t.title === 'Plan')!;
    expect(copyTask.reminder).toBe(`${today()}T08:00`);
  });
});

describe('import', () => {
  const header = ['type', 'title', 'reminder', 'repeat', 'repeat_every', 'repeat_unit'];
  it('reads a date and time, or a time only', () => {
    const rows = readRows([header, ['task', 'Call', '2026-11-26 09:00', '', '', ''], ['task', 'Pills', '10:00', 'regularly', '1', 'day']]);
    expect(rows.map((r) => r.reminder)).toEqual(['2026-11-26T09:00', '10:00']);
    expect(() => readRows([header, ['task', 'Call', 'tomorrow', '', '', '']])).toThrow(/Row 2: reminder/);
  });
});

describe('schema 15', () => {
  it('upgrades a schema-14 list: tasks have no reminder', () => {
    const task = { ...todo({ id: 't' }), ft: {} } as Record<string, unknown>;
    delete task.reminder;
    const tables = { areas: [], projects: [], headings: [], todos: [task], checklistItems: [], tags: [], contexts: [], savedSearches: [] };
    const list = upgradeList({ schema: 14, tables }, SCHEMA_VERSION) as { tables: { todos: Record<string, unknown>[] } };
    expect(SCHEMA_VERSION).toBe(15);
    expect(list.tables.todos[0].reminder).toBe(null);
  });

  it('upgrades a version-14 database with data in it', async () => {
    db.close();
    const name = 'reminder-upgrade';
    await Dexie.delete(name);
    const old = new Dexie(name);
    old.version(14).stores({ todos: 'id' });
    await old.open();
    await old.table('todos').add({ id: 't', title: 'Kept', ft: {} });
    old.close();
    const upgraded = new MyTasksDB(name);
    await upgraded.open();
    expect(await upgraded.todos.get('t')).toEqual({ id: 't', title: 'Kept', reminder: null, ft: {} });
    upgraded.close();
    await Dexie.delete(name);
    await db.open();
  });
});
