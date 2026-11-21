/**
 * When and deadlines (FR-3.6, FR-3.7): a reached deadline sets When to today,
 * and "Move When to the deadline" moves the When date in the same step.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/lib/db/database';
import * as repo from '../src/lib/db/repo';
import { clearUndo, undo } from '../src/lib/db/history';
import { addDays, today } from '../src/lib/model/dates';
import { inToday } from '../src/lib/model/lists';

const reset = async () => {
  await db.delete();
  await db.open();
  clearUndo();
};

const row = async (id: string) => (await db.todos.get(id))!;

beforeEach(reset);

describe('a deadline sets When (FR-3.7)', () => {
  it('sets When to today in the sweep for no When, Deferred and a later When', async () => {
    const yesterday = addDays(today(), -1);
    const none = await repo.createTodo({ title: 'none' });
    const deferred = await repo.createTodo({ title: 'deferred', deferred: true });
    const later = await repo.createTodo({ title: 'later', startDate: addDays(today(), 5) });
    const notDue = await repo.createTodo({ title: 'not due' });
    // As if the deadlines had arrived while the app was closed.
    for (const id of [none, deferred, later]) await db.todos.update(id, { deadline: yesterday });
    await db.todos.update(notDue, { deadline: addDays(today(), 1) });

    await repo.sweepRules();
    for (const id of [none, deferred, later]) {
      const t = await row(id);
      expect(t.startDate).toBe(today());
      expect(t.start).toBe('unscheduled');
      expect(inToday(t, today())).toBe(true);
    }
    expect((await row(notDue)).startDate).toBeNull();
  });

  it('is not an undo step', async () => {
    const a = await repo.createTodo({ title: 'a' });
    await repo.setTodoTrashed(a, true);
    const b = await repo.createTodo({ title: 'b', deferred: true });
    await db.todos.update(b, { deadline: today() });
    await repo.sweepRules();
    await undo(); // undoes the last user change (creating b, which leaves a tombstone), not the sweep
    expect((await row(b)).deletedAt).not.toBeNull();
  });

  it('changes many tasks in one sweep', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 30; i++) ids.push(await repo.createTodo({ title: `t${i}` }));
    for (const id of ids) await db.todos.update(id, { deadline: today() });
    await repo.sweepRules();
    for (const id of ids) {
      const t = await row(id);
      expect(t.startDate).toBe(today());
      expect(t.priority).toBe(1); // automatic P1 still goes by the deadline
    }
  });

  it('sets When when a deadline of today is set, and again after When is cleared', async () => {
    const id = await repo.createTodo({ title: 'x', deferred: true });
    await repo.setDeadline(id, today());
    expect((await row(id)).startDate).toBe(today());
    await repo.setWhen(id, { kind: 'clear' });
    expect(inToday(await row(id), today())).toBe(true);
  });
});

describe('Move When to the deadline (FR-3.6)', () => {
  it('moves a task\'s When to the deadline in one undo step', async () => {
    const id = await repo.createTodo({ title: 'x', startDate: addDays(today(), 10) });
    const deadline = addDays(today(), 3);
    await repo.setDeadline(id, deadline, true);
    expect((await row(id)).startDate).toBe(deadline);
    await undo();
    const t = await row(id);
    expect(t.deadline).toBeNull();
    expect(t.startDate).toBe(addDays(today(), 10));
  });

  it("moves a project's When to the deadline", async () => {
    const id = await repo.createProject({ title: 'p' });
    await repo.setProjectWhen(id, { kind: 'date', date: addDays(today(), 10) });
    await repo.setProjectDeadline(id, addDays(today(), 2), true);
    const p = (await db.projects.get(id))!;
    expect(p.startDate).toBe(addDays(today(), 2));
    expect(p.deadline).toBe(addDays(today(), 2));
  });
});
