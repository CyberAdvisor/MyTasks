/**
 * Priority settings and the automatic priority rules (FR-14).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/lib/db/database';
import * as repo from '../src/lib/db/repo';
import { addDays, today } from '../src/lib/model/dates';
import { priorityRules } from '../src/lib/model/priority';
import { DEFAULT_SETTINGS, readSettings, type AppSettings } from '../src/lib/model/settings';
import { todo } from './helpers';

const REF = '2026-11-09'; // a Monday

const ON = DEFAULT_SETTINGS;

const OFF: AppSettings = { ...DEFAULT_SETTINGS, autoP1: false, defaultP2: false };

describe('settings', () => {
  it('uses defaults and rejects empty labels', () => {
    expect(readSettings([])).toEqual(DEFAULT_SETTINGS);
    const s = readSettings([
      { key: 'priorityLabels', value: ['Urgent', '  ', 'Normal'] },
      { key: 'autoP1', value: false },
      { key: 'defaultP2', value: 'yes' }, // invalid, falls back
    ]);
    expect(s.priorityLabels).toEqual(['Urgent', 'P2', 'Normal', 'P4', 'P5']);
    expect(s.autoP1).toBe(false);
    expect(s.defaultP2).toBe(true);
  });
});

describe('automatic priority rules', () => {
  it('gives P2 to a task entering Today with no priority', () => {
    expect(priorityRules(todo({ startDate: REF }), REF, ON)).toEqual({ priority: 2, prioritySource: 'auto', priorityBeforeAuto: null });
    expect(priorityRules(todo({ startDate: addDays(REF, 1) }), REF, ON)).toBeNull();
    expect(priorityRules(todo({ startDate: REF }), REF, OFF)).toBeNull();
  });

  it('sets P1 when due, remembering the previous automatic value', () => {
    const t = todo({ startDate: REF, deadline: REF });
    expect(priorityRules(t, REF, ON)).toEqual({ priority: 1, prioritySource: 'auto', priorityBeforeAuto: 2 });
    const deadlineOnly = todo({ deadline: addDays(REF, -1) });
    expect(priorityRules(deadlineOnly, REF, ON)).toEqual({ priority: 1, prioritySource: 'auto', priorityBeforeAuto: null });
  });

  it('restores the earlier value when the task is no longer due', () => {
    const wasP2 = todo({ startDate: REF, priority: 1, prioritySource: 'auto', priorityBeforeAuto: 2 });
    expect(priorityRules(wasP2, REF, ON)).toEqual({ priority: 2, prioritySource: 'auto', priorityBeforeAuto: null });
    const wasNone = todo({ priority: 1, prioritySource: 'auto', priorityBeforeAuto: null });
    expect(priorityRules(wasNone, REF, ON)).toEqual({ priority: null, prioritySource: null, priorityBeforeAuto: null });
  });

  it('never changes a user priority, including a chosen "None"', () => {
    expect(priorityRules(todo({ deadline: REF, priority: 4, prioritySource: 'user' }), REF, ON)).toBeNull();
    expect(priorityRules(todo({ startDate: REF, priority: null, prioritySource: 'user' }), REF, ON)).toBeNull();
  });

  it('freezes closed tasks and leaves priorities when a rule is off', () => {
    expect(priorityRules(todo({ status: 'completed', deadline: REF }), REF, ON)).toBeNull();
    const autoP1 = todo({ priority: 1, prioritySource: 'auto', priorityBeforeAuto: 2 });
    expect(priorityRules(autoP1, REF, OFF)).toBeNull();
  });

  it('is idempotent', () => {
    const t = todo({ startDate: REF, deadline: REF });
    const once = { ...t, ...priorityRules(t, REF, ON)! };
    expect(priorityRules(once, REF, ON)).toBeNull();
  });
});

describe('priority operations', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  const row = async (id: string) => (await db.todos.get(id))!;

  it('applies P2 and P1 as When and deadline change, and restores P2', async () => {
    const id = await repo.createTodo({ title: 'x' });
    expect((await row(id)).priority).toBeNull();
    await repo.setWhen(id, { kind: 'today' });
    expect((await row(id)).priority).toBe(2);
    await repo.setDeadline(id, today());
    expect((await row(id)).priority).toBe(1);
    await repo.setDeadline(id, null);
    expect((await row(id)).priority).toBe(2);
  });

  it('respects user priorities and switched-off rules', async () => {
    const id = await repo.createTodo({ title: 'x' });
    await repo.setPriority(id, 3);
    await repo.setDeadline(id, today());
    expect((await row(id)).priority).toBe(3);

    await repo.setSetting('autoP1', false);
    const other = await repo.createTodo({ title: 'y', startDate: today() });
    await repo.setDeadline(other, today());
    expect((await row(other)).priority).toBe(2);
  });

  it('picks up a start date arriving in the sweep', async () => {
    const id = await repo.createTodo({ title: 'x', startDate: addDays(today(), 1) });
    expect((await row(id)).priority).toBeNull();
    await db.todos.update(id, { startDate: today() }); // as if a day had passed
    await repo.sweepRules();
    expect((await row(id)).priority).toBe(2);
  });

  it('turning a rule back on applies it to existing tasks', async () => {
    await repo.setSetting('defaultP2', false);
    const id = await repo.createTodo({ title: 'x', startDate: today() });
    expect((await row(id)).priority).toBeNull();
    await repo.setSetting('defaultP2', true);
    expect((await row(id)).priority).toBe(2);
  });

  it('keeps the priority of completed tasks', async () => {
    const id = await repo.createTodo({ title: 'x', startDate: today() });
    await repo.setTodoStatus(id, 'completed');
    await repo.setDeadline(id, today());
    expect((await row(id)).priority).toBe(2);
  });
});
