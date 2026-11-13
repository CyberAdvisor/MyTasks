/**
 * Tests for Milestone 5c: when completed items move to Completed (FR-12.2),
 * Move to Completed, and the two "move to the bottom" settings (FR-12.7,
 * FR-7.5). Schema version 3.
 */
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, MyTasksDB, SCHEMA_VERSION } from '../src/lib/db/database';
import * as repo from '../src/lib/db/repo';
import { clearUndo, undo } from '../src/lib/db/history';
import { addDays, today } from '../src/lib/model/dates';
import {
  areaProjects,
  inboxTodos,
  logbookGroups,
  loggedProjects,
  projectSections,
  sidebarCounts,
  sinkClosed,
  todayTodos,
  waitingInView,
} from '../src/lib/model/lists';
import { readSettings } from '../src/lib/model/settings';
import { quickFind } from '../src/lib/model/search';
import { snap, todo } from './helpers';

beforeEach(async () => {
  await db.delete();
  await db.open();
  clearUndo();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Complete a to-do at a given time, as if checked off then. */
async function completeAt(id: string, iso: string): Promise<void> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
  await repo.setTodoStatus(id, 'completed');
  vi.useRealTimers();
}

describe('schema version 3', () => {
  it('marks items completed before the upgrade as already moved to Completed', async () => {
    const name = 'mytasks-v3-migration-test';
    await Dexie.delete(name);
    const v2 = new Dexie(name);
    v2.version(2).stores({
      areas: 'id, sortKey',
      projects: 'id, areaId, status, sortKey',
      headings: 'id, projectId, sortKey',
      todos: 'id, projectId, areaId, headingId, status, startDate, deadline, sortKey, contextId',
      checklistItems: 'id, todoId, sortKey',
      tags: 'id, parentTagId, sortKey',
      contexts: 'id, sortKey',
      savedSearches: 'id, sortKey',
      changeLog: '++seq, entity, entityId, at',
      settings: 'key',
    });
    const base = { sortKey: 'a0', modifiedAt: '2026-11-02T00:00:00Z' };
    await v2.table('todos').bulkAdd([
      { ...base, id: 'open', status: 'open', completedAt: null },
      { ...base, id: 'done', status: 'completed', completedAt: '2026-11-01T09:00:00Z' },
      { ...base, id: 'gone', status: 'canceled', completedAt: null },
    ]);
    await v2.table('projects').bulkAdd([
      { ...base, id: 'p-open', status: 'open', completedAt: null },
      { ...base, id: 'p-done', status: 'completed', completedAt: '2026-11-01T10:00:00Z' },
    ]);
    v2.close();

    const v3 = new MyTasksDB(name);
    await v3.open();
    expect(v3.verno).toBe(SCHEMA_VERSION); // upgraded to the latest version
    expect((await v3.todos.get('open'))?.loggedAt).toBeNull();
    expect((await v3.todos.get('done'))?.loggedAt).toBe('2026-11-01T09:00:00Z');
    expect((await v3.todos.get('gone'))?.loggedAt).toBe('2026-11-02T00:00:00Z');
    expect((await v3.projects.get('p-open'))?.loggedAt).toBeNull();
    expect((await v3.projects.get('p-done'))?.loggedAt).toBe('2026-11-01T10:00:00Z');
    v3.close();
    await Dexie.delete(name);
  });
});

describe('settings', () => {
  it('defaults to Daily, with both "move to the bottom" switches off', () => {
    const s = readSettings([]);
    expect(s.moveToCompleted).toBe('daily');
    expect(s.sinkCompleted).toBe(false);
    expect(s.sinkChecked).toBe(false);
  });

  it('ignores invalid stored values', () => {
    const s = readSettings([
      { key: 'moveToCompleted', value: 'weekly' },
      { key: 'sinkCompleted', value: 'yes' },
    ]);
    expect(s.moveToCompleted).toBe('daily');
    expect(s.sinkCompleted).toBe(false);
  });
});

describe('completed items wait in their list (FR-12.2)', () => {
  it('Daily: a completed to-do stays in Today, struck through, and out of the counts', async () => {
    const id = await repo.createTodo({ title: 'x', startDate: today(), deadline: today() });
    await repo.createTodo({ title: 'y', startDate: today() });
    await repo.setTodoStatus(id, 'completed');
    const s = await snap();
    expect(todayTodos(s, today()).map((t) => t.title)).toEqual(['x', 'y']);
    expect(logbookGroups(s, today())).toHaveLength(0);
    expect(sidebarCounts(s, today())).toEqual({ inbox: 0, today: 1, due: 0 });
  });

  it('stays in the Inbox and in its project section until moved', async () => {
    const inbox = await repo.createTodo({ title: 'in' });
    const p = await repo.createProject({ title: 'P' });
    const h = await repo.createHeading(p, 'H');
    const under = await repo.createTodo({ projectId: p, headingId: h, title: 'under' });
    await repo.setTodoStatus(inbox, 'completed');
    await repo.setTodoStatus(under, 'canceled');
    const s = await snap();
    expect(inboxTodos(s).map((t) => t.id)).toEqual([inbox]);
    expect(projectSections(s, p).headings[0].todos.map((t) => t.id)).toEqual([under]);
  });

  it('Immediately: a completed to-do goes straight to Completed', async () => {
    await repo.setSetting('moveToCompleted', 'immediately');
    const id = await repo.createTodo({ title: 'x', startDate: today() });
    await repo.setTodoStatus(id, 'completed');
    const s = await snap();
    expect(todayTodos(s, today())).toHaveLength(0);
    expect(logbookGroups(s, today())[0].todos[0].id).toBe(id);
  });

  it('a completed project stays in its area until moved', async () => {
    const a = await repo.createArea('A');
    const p = await repo.createProject({ title: 'P', areaId: a });
    await repo.closeProject(p, 'completed', 'completed');
    const s = await snap();
    expect(areaProjects(s, a, true).map((x) => x.id)).toEqual([p]);
    expect(areaProjects(s, a)).toHaveLength(0); // the Move dialog offers open projects only
    expect(loggedProjects(s)).toHaveLength(0);
  });

  it('archiving a heading sends its to-dos straight to Completed', async () => {
    const p = await repo.createProject({ title: 'P' });
    const h = await repo.createHeading(p, 'H');
    const t = await repo.createTodo({ projectId: p, headingId: h });
    await repo.archiveHeading(h);
    expect((await db.todos.get(t))?.loggedAt).not.toBeNull();
  });

  it('unchecking a waiting to-do reopens it in place', async () => {
    const id = await repo.createTodo({ title: 'x', startDate: today() });
    await repo.setTodoStatus(id, 'completed');
    await repo.setTodoStatus(id, 'open');
    const t = await db.todos.get(id);
    expect(t?.status).toBe('open');
    expect(t?.completedAt).toBeNull();
    expect(t?.loggedAt).toBeNull();
  });
});

describe('the daily move (FR-12.2, FR-3.5)', () => {
  it('moves items completed before today and leaves today\'s', async () => {
    const old = await repo.createTodo({ title: 'old' });
    const fresh = await repo.createTodo({ title: 'fresh' });
    await completeAt(old, `${addDays(today(), -1)}T12:00:00`);
    await repo.setTodoStatus(fresh, 'completed');
    await repo.sweepCompleted();
    expect((await db.todos.get(old))?.loggedAt).not.toBeNull();
    expect((await db.todos.get(fresh))?.loggedAt).toBeNull();
  });

  it('Manually: the sweep moves nothing', async () => {
    await repo.setSetting('moveToCompleted', 'manually');
    const old = await repo.createTodo({ title: 'old' });
    await completeAt(old, `${addDays(today(), -3)}T12:00:00`);
    await repo.sweepCompleted();
    expect((await db.todos.get(old))?.loggedAt).toBeNull();
  });

  it('switching to Immediately moves everything waiting; switching to Daily moves the older ones', async () => {
    await repo.setSetting('moveToCompleted', 'manually');
    const old = await repo.createTodo({ title: 'old' });
    const fresh = await repo.createTodo({ title: 'fresh' });
    await completeAt(old, `${addDays(today(), -1)}T12:00:00`);
    await repo.setTodoStatus(fresh, 'completed');

    await repo.setSetting('moveToCompleted', 'daily');
    expect((await db.todos.get(old))?.loggedAt).not.toBeNull();
    expect((await db.todos.get(fresh))?.loggedAt).toBeNull();

    await repo.setSetting('moveToCompleted', 'immediately');
    expect((await db.todos.get(fresh))?.loggedAt).not.toBeNull();
  });

  it('is not an undo step', async () => {
    const id = await repo.createTodo({ title: 'x' });
    await completeAt(id, `${addDays(today(), -1)}T12:00:00`);
    await repo.sweepCompleted();
    await undo(); // undoes the check-off, the user's last change
    const t = await db.todos.get(id);
    expect(t?.status).toBe('open');
  });
});

describe('Move to Completed in a view', () => {
  it('moves only the waiting items shown in that view, and can be undone', async () => {
    await repo.setSetting('moveToCompleted', 'manually');
    const inToday = await repo.createTodo({ title: 'today', startDate: today() });
    const inInbox = await repo.createTodo({ title: 'inbox' });
    await repo.createTodo({ title: 'open', startDate: today() });
    await repo.setTodoStatus(inToday, 'completed');
    await repo.setTodoStatus(inInbox, 'completed');

    const waiting = waitingInView(await snap(), { kind: 'list', list: 'today' }, today());
    expect(waiting).toEqual({ todos: [inToday], projects: [] });
    await repo.moveToCompleted(waiting);
    expect((await db.todos.get(inToday))?.loggedAt).not.toBeNull();
    expect((await db.todos.get(inInbox))?.loggedAt).toBeNull();
    expect(waitingInView(await snap(), { kind: 'list', list: 'today' }, today()).todos).toHaveLength(0);

    await undo();
    expect((await db.todos.get(inToday))?.loggedAt).toBeNull();
  });

  it('on a project page includes the project itself; on an area page, its projects', async () => {
    const a = await repo.createArea('A');
    const p = await repo.createProject({ title: 'P', areaId: a });
    const t = await repo.createTodo({ projectId: p });
    const loose = await repo.createTodo({ areaId: a });
    await repo.setTodoStatus(loose, 'completed');
    await repo.closeProject(p, 'completed', 'completed');
    const s = await snap();
    expect(waitingInView(s, { kind: 'project', id: p }, today())).toEqual({ todos: [t], projects: [p] });
    expect(waitingInView(s, { kind: 'area', id: a }, today())).toEqual({ todos: [loose], projects: [p] });
  });
});

describe('move to the bottom (FR-12.7, FR-7.5)', () => {
  it('shows closed items after open ones, keeping each part in order', () => {
    const rows = [
      todo({ title: 'a' }),
      todo({ title: 'b', status: 'completed' }),
      todo({ title: 'c' }),
      todo({ title: 'd', status: 'canceled' }),
      todo({ title: 'e' }),
    ];
    expect(sinkClosed(rows).map((t) => t.title)).toEqual(['a', 'c', 'e', 'b', 'd']);
    expect(rows.map((t) => t.title)).toEqual(['a', 'b', 'c', 'd', 'e']); // input untouched
  });
});

describe('Move to Completed in Quick Find', () => {
  const LIST_TITLES = {
    inbox: 'Inbox', today: 'Today', scheduled: 'Scheduled', unscheduled: 'Unscheduled',
    deferred: 'Deferred', logbook: 'Completed', trash: 'Trash',
  };

  it('is offered first, only when the current view has items waiting', async () => {
    const id = await repo.createTodo({ title: 'x', startDate: today() });
    const s0 = await snap();
    const none = waitingInView(s0, { kind: 'list', list: 'today' }, today());
    expect(quickFind(s0, 'move', LIST_TITLES, none).some((r) => r.kind === 'move-completed')).toBe(false);

    await repo.setTodoStatus(id, 'completed');
    const s = await snap();
    const waiting = waitingInView(s, { kind: 'list', list: 'today' }, today());
    expect(quickFind(s, 'move comp', LIST_TITLES, waiting)[0]).toEqual({
      kind: 'move-completed',
      title: 'Move to Completed',
      waiting: { todos: [id], projects: [] },
    });
    expect(quickFind(s, 'garden', LIST_TITLES, waiting).some((r) => r.kind === 'move-completed')).toBe(false);
  });
});
