/**
 * Tests for PR 2 of the security review (2026-11-13, v0.8.0): deleted
 * records keep only id, deletedAt and modifiedAt, on the device and in
 * uploads; records deleted before are cleaned once by schema version 4;
 * and timestamps from the gist later than now count as now.
 */
import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, MyTasksDB, SCHEMA_VERSION } from '../src/lib/db/database';
import * as repo from '../src/lib/db/repo';
import { clearUndo, undo } from '../src/lib/db/history';
import { readLocal } from '../src/lib/sync/local';
import { mergePayloads, SYNCED_TABLES, type Payload } from '../src/lib/sync/payload';
import type { BaseRecord, EntityName } from '../src/lib/model/types';

beforeEach(async () => {
  await db.delete();
  await db.open();
  clearUndo();
});

const TOMBSTONE_FIELDS = ['deletedAt', 'id', 'modifiedAt'];

/** Every record on this device, deleted or not. */
async function everything(): Promise<BaseRecord[]> {
  const all: BaseRecord[] = [];
  for (const t of SYNCED_TABLES) all.push(...((await db.table(t).toArray()) as BaseRecord[]));
  return all;
}

/** An empty payload with some records. */
function payload(over: Partial<Payload['tables']> = {}, settings: Payload['settings'] = []): Payload {
  const tables = Object.fromEntries(SYNCED_TABLES.map((t) => [t, []])) as unknown as Payload['tables'];
  return { app: 'mytasks', schema: SCHEMA_VERSION, tables: { ...tables, ...over }, settings };
}

describe('deleting keeps only id, deletedAt and modifiedAt', () => {
  it('on every deletion path, on the device and in the upload', async () => {
    // Emptied from Trash: a task with notes and a checklist, and a project with a heading and a task.
    const a = await repo.createTodo({ title: 'SECRET-A', notes: 'SECRET-A notes', checklist: [{ title: 'SECRET-A item', completed: false }] });
    await repo.setTodoTrashed(a, true);
    const p = await repo.createProject({ title: 'SECRET-P' });
    await repo.createHeading(p, 'SECRET-P heading');
    await repo.createTodo({ title: 'SECRET-P task', projectId: p });
    await repo.setProjectTrashed(p, true);
    await repo.emptyTrash();
    // Delete Immediately.
    const b = await repo.createTodo({ title: 'SECRET-B', checklist: [{ title: 'SECRET-B item', completed: true }] });
    await repo.setTodoTrashed(b, true);
    await repo.deleteTodoForever(b);
    // A heading, an area, a context, a saved search and a checklist item.
    const q = await repo.createProject({ title: 'kept project' });
    await repo.deleteHeading(await repo.createHeading(q, 'SECRET-H'));
    await repo.deleteArea(await repo.createArea('SECRET-AREA'), 'keep');
    await repo.deleteContext(await repo.createContext('SECRET-CTX'));
    await repo.deleteSavedSearch(await repo.createSavedSearch({ title: 'SECRET-SS', query: 'SECRET-SS query', tagIds: [] }));
    const kept = await repo.createTodo({ title: 'kept task' });
    const [item] = await repo.addChecklistItems(kept, ['SECRET-CI']);
    await repo.deleteChecklistItem(item);
    // A tag in use, deleted while deleted records are present.
    const tag = await repo.createTag('SECRET-TAG');
    await repo.toggleTag('todos', kept, tag, true);
    await repo.deleteTag(tag);
    expect((await db.todos.get(kept))!.tagIds).toEqual([]);
    // Undoing a creation.
    await repo.createTodo({ title: 'SECRET-UNDONE' });
    await undo();

    const deleted = (await everything()).filter((r) => r.deletedAt);
    expect(deleted.length).toBeGreaterThanOrEqual(14);
    for (const r of deleted) expect(Object.keys(r).sort()).toEqual(TOMBSTONE_FIELDS);
    expect(JSON.stringify(await everything())).not.toContain('SECRET');
    expect(JSON.stringify(await readLocal())).not.toContain('SECRET');
  });

  it('Undo of a deletion still brings everything back', async () => {
    const project = await repo.createProject({ title: 'trip' });
    const heading = await repo.createHeading(project, 'Packing');
    const task = await repo.createTodo({ title: 'passport', projectId: project, headingId: heading });
    await repo.deleteHeading(heading);
    expect(Object.keys((await db.headings.get(heading))!).sort()).toEqual(TOMBSTONE_FIELDS);
    await undo();
    const restored = (await db.headings.get(heading))!;
    expect([restored.title, restored.deletedAt, restored.projectId]).toEqual(['Packing', null, project]);
    expect((await db.todos.get(task))!.headingId).toBe(heading);
  });
});

describe('merging', () => {
  const at = '2026-11-13T10:00:00.000Z';
  const stripped = { id: 'x', deletedAt: at, modifiedAt: at } as unknown as BaseRecord;
  const full = { ...stripped, title: 'SECRET', notes: 'SECRET notes', sortKey: 'a0' } as unknown as BaseRecord;

  it('never brings back deleted content from a device still on 0.7.1', () => {
    // Same time: the copies are the same once stripped, so nothing is applied.
    const same = mergePayloads(payload({ todos: [stripped] }), payload({ todos: [full] }), at);
    expect(same.toApply.tables.todos).toBeUndefined();
    expect(JSON.stringify(same.merged)).not.toContain('SECRET');
    // The gist still holds the content, so the cleaned copy is pushed.
    expect(same.pushNeeded).toBe(true);
    expect(mergePayloads(payload({ todos: [stripped] }), payload({ todos: [stripped] }), at).pushNeeded).toBe(false);
    // Later: only the tombstone is applied.
    const later = { ...full, modifiedAt: '2026-11-13T11:00:00.000Z' };
    const m = mergePayloads(payload(), payload({ todos: [later] }), '2026-11-13T12:00:00.000Z');
    expect(m.toApply.tables.todos).toEqual([{ id: 'x', deletedAt: at, modifiedAt: '2026-11-13T11:00:00.000Z' }]);
    // And this device's own full copy is never pushed.
    expect(JSON.stringify(mergePayloads(payload({ todos: [full] }), payload(), at).merged)).not.toContain('SECRET');
  });

  it('treats a time from the gist later than now as now, and pushes the correction', () => {
    const now = '2026-11-13T12:00:00.000Z';
    const future = '2099-01-01T00:00:00.000Z';
    const record = { id: 't', title: 'from a fast clock', deletedAt: null, modifiedAt: future } as unknown as BaseRecord;
    const setting = { key: 'todayGrouping', value: 'all', modifiedAt: future } as unknown as Payload['settings'][number];
    const m = mergePayloads(payload(), payload({ todos: [record] }, [setting]), now);
    expect(m.toApply.tables.todos![0].modifiedAt).toBe(now);
    expect(m.toApply.settings[0].modifiedAt).toBe(now);
    expect(m.merged.tables.todos[0].modifiedAt).toBe(now);
    expect(m.pushNeeded).toBe(true);
    // A later local edit now wins against it.
    const edited = { ...record, title: 'edited here', modifiedAt: '2026-11-13T12:05:00.000Z' };
    const next = mergePayloads(payload({ todos: [edited] }), m.merged, '2026-11-13T12:06:00.000Z');
    expect(next.merged.tables.todos[0]).toMatchObject({ title: 'edited here' });
  });
});

describe('upgrade to schema version 4', () => {
  it('strips records deleted before, and leaves everything else as it was', async () => {
    const name = 'upgrade-v4-test';
    const v3 = new Dexie(name);
    v3.version(3).stores({
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
    const at = '2026-11-12T10:00:00.000Z';
    const old = { deletedAt: at, modifiedAt: at, createdAt: at, sortKey: 'a0' };
    await v3.table('todos').bulkAdd([
      { id: 'gone', title: 'SECRET', notes: 'SECRET notes', ...old },
      { id: 'live', title: 'keep me', notes: 'my notes', ...old, deletedAt: null },
    ]);
    await v3.table('headings').add({ id: 'h', title: 'SECRET heading', projectId: 'p', ...old });
    await v3.table('checklistItems').add({ id: 'c', title: 'SECRET item', todoId: 'gone', ...old });
    v3.close();

    const v4 = new MyTasksDB(name);
    await v4.open();
    expect(v4.verno).toBe(SCHEMA_VERSION);
    for (const [table, id] of [['todos', 'gone'], ['headings', 'h'], ['checklistItems', 'c']] as [EntityName, string][]) {
      expect(await v4.table(table).get(id)).toEqual({ id, deletedAt: at, modifiedAt: at });
    }
    expect(await v4.todos.get('live')).toMatchObject({ title: 'keep me', notes: 'my notes', deletedAt: null });
    v4.close();
    await Dexie.delete(name);
  });
});
