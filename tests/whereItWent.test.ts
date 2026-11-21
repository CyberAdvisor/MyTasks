/**
 * Where a task went (FR-1.10): when it left the Inbox, the message and list
 * for each destination, none for a project, completion or the Trash, and
 * only for tracked local changes (not undo or sync); when the new-task box
 * adds one the view on screen can't list, "Added to …".
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/lib/db/database';
import * as repo from '../src/lib/db/repo';
import { clearUndo, onTodosChanged, tx, undo } from '../src/lib/db/history';
import { addDays, today } from '../src/lib/model/dates';
import { addedTo, combineWhere, shownIn, whereItWent } from '../src/lib/model/whereItWent';
import * as bulk from '../src/lib/bulk';
import { projectIndex } from '../src/lib/model/lists';
import type { Route } from '../src/lib/state/route';
import type { Todo } from '../src/lib/model/types';

const get = async (id: string) => (await db.todos.get(id))!;

/** An Inbox task, its record before a change, and the message after `change`. */
async function moved(change: (id: string) => Promise<unknown>, areaTitle = '') {
  const id = await repo.createTodo({ title: 'Call Sam' });
  const before = await get(id);
  await change(id);
  return whereItWent(before, await get(id), today(), areaTitle);
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  clearUndo();
});

describe('whereItWent', () => {
  it('names the list a task went to, and the list to show', async () => {
    expect(await moved((id) => repo.setWhen(id, { kind: 'today' }))).toEqual({
      message: 'Moved to Today',
      where: { kind: 'list', list: 'today' },
    });
    const later = await moved((id) => repo.setWhen(id, { kind: 'date', date: addDays(today(), 5) }));
    expect(later?.message).toMatch(/^Moved to Scheduled for \w+/);
    expect(later?.where).toEqual({ kind: 'list', list: 'scheduled' });
    expect((await moved((id) => repo.setWhen(id, { kind: 'deferred' })))?.message).toBe('Moved to Deferred');
    expect((await moved((id) => repo.setWhen(id, { kind: 'unscheduled' })))?.message).toBe('Moved to Unscheduled');
    const areaId = await repo.createArea('Home');
    expect(await moved((id) => repo.moveTodo(id, { areaId }), 'Home')).toEqual({
      message: 'Moved to Home',
      where: { kind: 'area', id: areaId },
    });
  });

  it('says nothing for a project, completion, the Trash, or a task still in the Inbox', async () => {
    const projectId = await repo.createProject({ title: 'Vacation' });
    expect(await moved((id) => repo.moveTodo(id, { projectId }))).toBeNull();
    expect(await moved((id) => repo.setTodoStatus(id, 'completed'))).toBeNull();
    expect(await moved((id) => repo.setTodoTrashed(id, true))).toBeNull();
    expect(await moved((id) => repo.updateTodoText(id, { title: 'Call Sam back' }))).toBeNull();
  });
});

describe('addedTo and shownIn', () => {
  it('names where a new task went, and whether the view on screen lists it', async () => {
    const ref = today();
    const projectId = await repo.createProject({ title: 'Vacation' });
    const shown = async (id: string, r: Route) => shownIn(await get(id), r, ref, projectIndex(await db.projects.toArray()));
    const inbox: Route = { kind: 'list', list: 'inbox' };

    const plain = await repo.createTodo({ title: 'a' });
    expect(await shown(plain, inbox)).toBe(true); // no message
    expect(await shown(plain, { kind: 'list', list: 'today' })).toBe(false);
    expect(addedTo(await get(plain), ref).message).toBe('Added to Inbox');

    const todayOne = await repo.createTodo({ title: 'b', startDate: ref, start: 'unscheduled' });
    expect(await shown(todayOne, inbox)).toBe(false);
    expect(addedTo(await get(todayOne), ref)).toEqual({ message: 'Added to Today', where: { kind: 'list', list: 'today' } });

    // A project and a date: the date's list (choice A).
    const both = await repo.createTodo({ title: 'c', projectId, startDate: ref });
    expect(addedTo(await get(both), ref, 'Vacation').message).toBe('Added to Today');
    const inProject = await repo.createTodo({ title: 'd', projectId });
    expect(addedTo(await get(inProject), ref, 'Vacation')).toEqual({
      message: 'Added to Vacation',
      where: { kind: 'project', id: projectId },
    });
    expect(await shown(inProject, { kind: 'project', id: projectId })).toBe(true);
    // Search and filters always get the message (choice B).
    expect(await shown(plain, { kind: 'search', query: 'a', tagIds: [] })).toBe(false);
  });
});

describe('several tasks at once (FR-10.1)', () => {
  const today_: Route = { kind: 'list', list: 'today' };

  it('says it once: "3 tasks moved to Today", or "3 tasks moved" with no Show when they went apart', () => {
    const w = (message: string, where: Route = today_) => ({ message, where });
    expect(combineWhere([w('Moved to Today'), w('Moved to Today'), w('Moved to Today')])).toEqual({ message: '3 tasks moved to Today', where: today_ });
    expect(combineWhere([w('Moved to Today'), w('Moved to Deferred', { kind: 'list', list: 'deferred' })])).toEqual({ message: '2 tasks moved' });
    expect(combineWhere([w('Moved to Home')])).toEqual(w('Moved to Home'));
    expect(combineWhere([])).toBeNull();
  });

  it('tells the listeners once, with every task the change touched', async () => {
    const ids = [await repo.createTodo({ title: 'a' }), await repo.createTodo({ title: 'b' })];
    const seen: Todo[][] = [];
    const stop = onTodosChanged((before) => seen.push(before));
    await bulk.setWhen(ids, { kind: 'today' });
    expect(seen.map((b) => b.map((t) => t.title))).toEqual([['a', 'b']]);
    stop();
  });
});

describe('onTodosChanged', () => {
  it('passes the tasks a local change touched, as they were, but not for undo or sync', async () => {
    const seen: Todo[][] = [];
    const stop = onTodosChanged((before) => seen.push(before));
    const id = await repo.createTodo({ title: 'Call Sam' });
    expect(seen).toEqual([]); // a created task has no "before"
    await repo.setWhen(id, { kind: 'deferred' });
    expect(seen.map((b) => b.map((t) => t.start))).toEqual([['inbox']]);
    await undo();
    await tx(() => db.todos.update(id, { title: 'From the gist' }), { track: false, fromSync: true });
    expect(seen).toHaveLength(1);
    stop();
  });
});
