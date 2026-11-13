/**
 * Tests for contexts (FR-18): storage and migration, Settings management,
 * to-do context, the filter, search and saved searches, and Today grouping
 * by context.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { db, MyTasksDB, SCHEMA_VERSION } from '../src/lib/db/database';
import * as repo from '../src/lib/db/repo';
import { clearUndo, undo } from '../src/lib/db/history';
import { contextTitle, contextsInUse, filterByContext, activeContext } from '../src/lib/model/contexts';
import { todayGroups } from '../src/lib/model/lists';
import { defaultSearchName, isEmptyFilter, openMatchCount, searchTodos } from '../src/lib/model/search';
import { readSettings } from '../src/lib/model/settings';
import { snap, snapshotOf, todo } from './helpers';

beforeEach(async () => {
  await db.delete();
  await db.open();
  clearUndo();
});

describe('storage', () => {
  it('upgrades a version 1 database: existing to-dos and saved searches get no context', async () => {
    const name = 'mytasks-migration-test';
    await Dexie.delete(name);
    const v1 = new Dexie(name);
    v1.version(1).stores({
      areas: 'id, sortKey',
      projects: 'id, areaId, status, sortKey',
      headings: 'id, projectId, sortKey',
      todos: 'id, projectId, areaId, headingId, status, startDate, deadline, sortKey',
      checklistItems: 'id, todoId, sortKey',
      tags: 'id, parentTagId, sortKey',
      savedSearches: 'id, sortKey',
      changeLog: '++seq, entity, entityId, at',
      settings: 'key',
    });
    await v1.table('todos').add({ id: 't1', title: 'old', sortKey: 'a0' });
    await v1.table('savedSearches').add({ id: 's1', title: 'old', query: 'x', tagIds: [], sortKey: 'a0' });
    v1.close();

    const v2 = new MyTasksDB(name);
    await v2.open();
    expect(v2.verno).toBe(SCHEMA_VERSION); // upgraded to the latest version
    expect((await v2.todos.get('t1'))?.contextId).toBeNull();
    expect((await v2.savedSearches.get('s1'))?.contextId).toBeNull();
    expect(await v2.contexts.count()).toBe(0);
    v2.close();
    await Dexie.delete(name);
  });
});

describe('managing contexts in Settings (FR-18.2)', () => {
  it('creates, renames and reorders contexts', async () => {
    const home = await repo.createContext(' Home ');
    const phone = await repo.createContext('Phone');
    let s = await snap();
    expect(s.contexts.map((c) => c.title)).toEqual(['Home', 'Phone']);

    await repo.renameContext(home, 'House');
    await repo.moveContext(phone, 'up');
    s = await snap();
    expect(contextsInUse([todo({ contextId: home }), todo({ contextId: phone })], s).map((c) => c.title)).toEqual([
      'Phone',
      'House',
    ]);
  });

  it('deleting a context clears it from to-dos and saved searches, as one undo step', async () => {
    const home = await repo.createContext('Home');
    const t = await repo.createTodo({ title: 'x', contextId: home });
    const saved = await repo.createSavedSearch({ title: 'At home', query: '', tagIds: [], contextId: home });

    await repo.deleteContext(home);
    expect((await db.todos.get(t))?.contextId).toBeNull();
    expect((await db.savedSearches.get(saved))?.contextId).toBeNull();
    expect((await snap()).contexts).toHaveLength(0);

    await undo();
    expect((await db.todos.get(t))?.contextId).toBe(home);
    expect((await db.savedSearches.get(saved))?.contextId).toBe(home);
    expect((await snap()).contexts).toHaveLength(1);
  });
});

describe('a to-do’s context (FR-18.1, FR-18.3)', () => {
  it('is set, changed and cleared, and kept by Duplicate', async () => {
    const home = await repo.createContext('Home');
    const phone = await repo.createContext('Phone');
    const t = await repo.createTodo({ title: 'Call', contextId: home });
    expect((await db.todos.get(t))?.contextId).toBe(home);

    await repo.setContext(t, phone);
    expect((await db.todos.get(t))?.contextId).toBe(phone);
    const copy = await repo.duplicateTodo(t);
    expect((await db.todos.get(copy!))?.contextId).toBe(phone);

    await repo.setContext(t, null);
    expect((await db.todos.get(t))?.contextId).toBeNull();
  });

  it('is not inherited from a project or area', async () => {
    const t = await repo.createTodo({ title: 'x' });
    expect((await db.todos.get(t))?.contextId).toBeNull();
    const s = await snap();
    expect(contextTitle(null, s)).toBe('');
  });
});

describe('filter bar (FR-18.5)', () => {
  const s = snapshotOf({
    contexts: [
      { id: 'c2', title: 'Phone', sortKey: 'a1', createdAt: '', modifiedAt: '', deletedAt: null },
      { id: 'c1', title: 'Home', sortKey: 'a0', createdAt: '', modifiedAt: '', deletedAt: null },
    ],
  });
  const a = todo({ contextId: 'c1' });
  const b = todo({ contextId: 'c2' });
  const c = todo();

  it('offers the contexts in use, in Settings order', () => {
    expect(contextsInUse([b, c, a], s).map((x) => x.id)).toEqual(['c1', 'c2']);
  });

  it('keeps only to-dos in the chosen context; null keeps all', () => {
    expect(filterByContext([a, b, c], 'c2')).toEqual([b]);
    expect(filterByContext([a, b, c], null)).toEqual([a, b, c]);
  });

  it('drops a selection that the view no longer offers', () => {
    expect(activeContext('c2', contextsInUse([a], s))).toBeNull();
    expect(activeContext('c1', contextsInUse([a], s))).toBe('c1');
  });
});

describe('search and saved searches (FR-18.6)', () => {
  it('matches context names and filters by context', async () => {
    const home = await repo.createContext('Home');
    await repo.createTodo({ title: 'Fix the tap', contextId: home });
    await repo.createTodo({ title: 'Fix the bike' });
    const s = await snap();

    expect(searchTodos(s, { query: 'home', tagIds: [] }).open.map((t) => t.title)).toEqual(['Fix the tap']);
    expect(searchTodos(s, { query: 'fix', tagIds: [], contextId: home }).open.map((t) => t.title)).toEqual([
      'Fix the tap',
    ]);
    expect(isEmptyFilter({ query: '', tagIds: [], contextId: home })).toBe(false);
    expect(defaultSearchName({ query: '', tagIds: [], contextId: home }, s)).toBe('Home');
  });

  it('a saved search keeps its context and counts only matching to-dos', async () => {
    const home = await repo.createContext('Home');
    await repo.createTodo({ title: 'a', contextId: home });
    await repo.createTodo({ title: 'b' });
    const id = await repo.createSavedSearch({ title: 'Home', query: '', tagIds: [], contextId: home });
    const s = await snap();
    const saved = s.savedSearches.find((x) => x.id === id)!;
    expect(saved.contextId).toBe(home);
    expect(openMatchCount(s, saved)).toBe(1);

    await repo.updateSavedSearch(id, { contextId: null, query: 'b' });
    expect((await db.savedSearches.get(id))?.contextId).toBeNull();
  });
});

describe('Today grouping by context (FR-18.7)', () => {
  const s = snapshotOf({
    contexts: [
      { id: 'c1', title: 'Home', sortKey: 'a1', createdAt: '', modifiedAt: '', deletedAt: null },
      { id: 'c2', title: 'Phone', sortKey: 'a0', createdAt: '', modifiedAt: '', deletedAt: null },
      { id: 'c3', title: 'Office', sortKey: 'a2', createdAt: '', modifiedAt: '', deletedAt: null },
    ],
  });

  it('groups by context in Settings order, then No context; empty groups are hidden', () => {
    const x = todo({ title: 'x', contextId: 'c1' });
    const y = todo({ title: 'y' });
    const z = todo({ title: 'z', contextId: 'c2' });
    const w = todo({ title: 'w', contextId: 'gone' });
    const groups = todayGroups([x, y, z, w], 'context', s, []);
    expect(groups.map((g) => g.title)).toEqual(['Phone', 'Home', 'No context']);
    expect(groups[2].todos.map((t) => t.title)).toEqual(['y', 'w']); // keeps Today's order
  });

  it('is a stored Today grouping choice', () => {
    expect(readSettings([{ key: 'todayGrouping', value: 'context' }]).todayGrouping).toBe('context');
  });
});
