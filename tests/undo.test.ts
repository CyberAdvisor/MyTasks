/**
 * Multi-step undo and redo (FR-1.6).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Dexie from 'dexie';
import { db } from '../src/lib/db/database';
import * as repo from '../src/lib/db/repo';
import { clearUndo, redo, undo, undoGroup, UNDO_LIMIT } from '../src/lib/db/history';
import { applyRemote } from '../src/lib/sync/local';
import { bySortKey } from '../src/lib/model/order';
import { snap } from './helpers';
import * as bulk from '../src/lib/bulk';
import type { BaseRecord } from '../src/lib/model/types';

const reset = async () => {
  await db.delete();
  await db.open();
  clearUndo();
};

const ids = <T extends { id: string; sortKey: string }>(rows: T[]) => bySortKey(rows).map((r) => r.id);

describe('undo (FR-1.6)', () => {
  beforeEach(reset);

  it('has nothing to undo at first', async () => {
    expect(await undo()).toBe('none');
  });

  it('restores a trashed task', async () => {
    const t = await repo.createTodo({ title: 'a' });
    await repo.setTodoTrashed(t, true);
    expect(await undo()).toBe('done');
    expect((await db.todos.get(t))?.trashedAt).toBeNull();
    expect(await undo()).toBe('done'); // its creation
    expect(await undo()).toBe('none');
  });

  it('cannot undo Empty Trash, nor the move to Trash before it (FR-12.3)', async () => {
    const t = await repo.createTodo({ title: 'a' });
    await repo.setTodoTrashed(t, true);
    await repo.emptyTrash();
    expect(await undo()).toBe('none');
    expect(await redo()).toBe('none');
    expect((await db.todos.get(t))?.deletedAt).not.toBeNull();
  });

  it('removes a record the step created, as a tombstone that can sync', async () => {
    const t = await repo.createTodo({ title: 'a' });
    await undo();
    expect((await db.todos.get(t))?.deletedAt).not.toBeNull();
  });

  it('undoes one change at a time, with every record it touched', async () => {
    const p = await repo.createProject({ title: 'P' });
    const h = await repo.createHeading(p, 'H');
    const a = await repo.createTodo({ projectId: p, headingId: h, title: 'a' });
    await repo.deleteHeading(h);
    await undo();
    expect((await db.headings.get(h))?.deletedAt).toBeNull();
    expect((await db.todos.get(a))?.headingId).toBe(h);
    expect(await db.projects.get(p)).toBeDefined();
    await undo();
    expect((await db.todos.get(a))?.deletedAt).not.toBeNull();
    expect((await db.headings.get(h))?.deletedAt).toBeNull();
  });

  it('redoes what was undone, until a new change clears it', async () => {
    const t = await repo.createTodo({ title: 'a' });
    await repo.updateTodoText(t, { title: 'b' });
    await repo.setTodoTrashed(t, true);
    await undo();
    await undo();
    expect(await db.todos.get(t)).toMatchObject({ title: 'a', trashedAt: null });
    expect(await redo()).toBe('done');
    expect(await db.todos.get(t)).toMatchObject({ title: 'b', trashedAt: null });
    await repo.updateTodoText(t, { title: 'c' });
    expect(await redo()).toBe('none');
    expect(await undo()).toBe('done');
    expect((await db.todos.get(t))?.title).toBe('b');
  });

  it('brings back a created task on redo', async () => {
    const t = await repo.createTodo({ title: 'a' });
    await undo();
    await redo();
    expect(await db.todos.get(t)).toMatchObject({ title: 'a', deletedAt: null });
  });

  it(`keeps the last ${UNDO_LIMIT} steps`, async () => {
    const t = await repo.createTodo({ title: '0' });
    for (let i = 1; i <= UNDO_LIMIT; i++) await repo.updateTodoText(t, { title: String(i) });
    for (let i = 0; i < UNDO_LIMIT; i++) expect(await undo()).toBe('done');
    expect(await undo()).toBe('none');
    expect((await db.todos.get(t))?.title).toBe('0');
  });

  it('drops a step another device has changed since, and goes on to the one before', async () => {
    const a = await repo.createTodo({ title: 'a' });
    const b = await repo.createTodo({ title: 'b' });
    await repo.updateTodoText(b, { title: 'b2' });
    const current = await db.todos.get(b);
    await applyRemote({ tables: { todos: [{ ...current!, title: 'b3', modifiedAt: '2999-01-01T00:00:00.000Z' } as BaseRecord] }, settings: [] });
    expect(await undo()).toBe('stale');
    expect((await db.todos.get(b))?.title).toBe('b3');
    expect(await undo()).toBe('stale'); // b's creation holds b too
    expect(await undo()).toBe('done');
    expect((await db.todos.get(a))?.deletedAt).not.toBeNull();
  });

  it('undoes a drag', async () => {
    const a = await repo.createTodo({ title: 'a' });
    const b = await repo.createTodo({ title: 'b' });
    await repo.placeTodo(b, { order: [b, a] });
    await undo();
    expect(ids((await snap()).todos)).toEqual([a, b]);
  });

  it('ignores the automatic priority sweep and settings', async () => {
    const t = await repo.createTodo({ title: 'a' });
    await repo.setTodoTrashed(t, true);
    await repo.sweepRules();
    await repo.setSetting('todayGrouping', 'project');
    await undo();
    expect((await db.todos.get(t))?.trashedAt).toBeNull();
  });

  it('merges a group of changes into one step', async () => {
    const a = await repo.createTodo({ title: 'a' });
    const b = await undoGroup(async () => {
      const id = await repo.createTodo({ title: 'b' });
      await repo.placeTodo(id, { order: [id, a] });
      return id;
    });
    await undo();
    expect((await db.todos.get(b))?.deletedAt).not.toBeNull();
    expect((await db.todos.get(a))?.deletedAt).toBeNull();
  });

  it('undoes a change to several selected tasks in one step (FR-10.1, FR-14.5)', async () => {
    const ids = [await repo.createTodo({ title: 'a' }), await repo.createTodo({ title: 'b' }), await repo.createTodo({ title: 'c' })];
    await repo.setPriority(ids[0], 4);
    // Saved in one transaction, so the lists are read again once, not once per task (NFR-7).
    let outer = 0;
    const real = db.transaction.bind(db);
    const spy = vi.spyOn(db, 'transaction').mockImplementation(((...args: unknown[]) => {
      if (!Dexie.currentTransaction) outer++;
      return (real as (...a: unknown[]) => unknown)(...args);
    }) as typeof db.transaction);
    await bulk.setPriority(ids, 1);
    spy.mockRestore();
    expect(outer).toBe(1);
    expect((await db.todos.bulkGet(ids)).map((t) => t?.priority)).toEqual([1, 1, 1]);
    await undo();
    expect((await db.todos.bulkGet(ids)).map((t) => t?.priority)).toEqual([4, null, null]);
    await bulk.trash(ids);
    await undo();
    expect((await db.todos.bulkGet(ids)).every((t) => t?.trashedAt === null)).toBe(true);
  });

  it('restores without writing a change log (removed in 1.3.7)', async () => {
    const t = await repo.createTodo({ title: 'a' });
    await repo.updateTodoText(t, { title: 'b' });
    await undo();
    expect((await db.todos.get(t))?.title).toBe('a');
    expect(await db.changeLog.count()).toBe(0);
  });
});
