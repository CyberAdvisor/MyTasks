/**
 * Search matching, Quick Find, saved searches and search routes (FR-9, FR-15).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/lib/db/database';
import * as repo from '../src/lib/db/repo';
import { type BuiltInList } from '../src/lib/model/lists';
import { deadlineTodos, defaultSearchName, fold, openMatchCount, quickFind, searchResults, searchTodos } from '../src/lib/model/search';
import { project, snap, snapshotOf, todo } from './helpers';

const LIST_TITLES: Record<BuiltInList, string> = {
  inbox: 'Inbox',
  today: 'Today',
  scheduled: 'Scheduled',
  unscheduled: 'Unscheduled',
  deferred: 'Deferred',
  logbook: 'Completed',
  trash: 'Trash',
};

const reset = async () => {
  await db.delete();
  await db.open();
};

describe('search matching', () => {
  it('ignores case and accents', () => {
    expect(fold('Café ÉTÉ')).toBe('cafe ete');
    const s = snapshotOf({ todos: [todo({ title: 'Book the Café' })] });
    expect(searchTodos(s, { query: 'cafe book', tagIds: [] }).open).toHaveLength(1);
  });

  it('needs every word, found in title, notes or checklist', () => {
    const t = todo({ title: 'Plan trip', notes: 'flights to Denver' });
    const c = { ...todo(), todoId: t.id, title: 'Pack boots', completed: false };
    const s = snapshotOf({ todos: [t], checklistItems: [c] });
    expect(searchTodos(s, { query: 'trip denver boots', tagIds: [] }).open).toEqual([t]);
    expect(searchTodos(s, { query: 'trip paris', tagIds: [] }).open).toEqual([]);
  });

  it('matches nothing for an empty search', () => {
    const s = snapshotOf({ todos: [todo({ title: 'x' })] });
    expect(searchTodos(s, { query: '  ', tagIds: [] }).open).toEqual([]);
  });

  it('skips the Trash and lists completed matches apart, newest first', () => {
    const open = todo({ title: 'milk' });
    const old = todo({ title: 'milk', status: 'completed', completedAt: '2026-11-01T10:00:00Z' });
    const recent = todo({ title: 'milk', status: 'canceled', completedAt: '2026-11-08T10:00:00Z' });
    const trashed = todo({ title: 'milk', trashedAt: '2026-11-08T10:00:00Z' });
    const s = snapshotOf({ todos: [old, trashed, open, recent] });
    expect(searchTodos(s, { query: 'milk', tagIds: [] })).toEqual({ open: [open], logged: [recent, old] });
  });

  it('requires every tag, including inherited ones', () => {
    const p = project({ tagIds: ['work'] });
    const both = todo({ title: 'a', projectId: p.id, tagIds: ['urgent'] });
    const one = todo({ title: 'a', tagIds: ['urgent'] });
    const s = snapshotOf({ projects: [p], todos: [both, one] });
    expect(searchTodos(s, { query: '', tagIds: ['urgent', 'work'] }).open).toEqual([both]);
    expect(openMatchCount(s, { query: 'a', tagIds: ['urgent'] })).toBe(2);
  });

  it('groups results by Area and Project', () => {
    const p = project({ title: 'Home' });
    const loose = todo({ title: 'paint' });
    const inP = todo({ title: 'paint', projectId: p.id });
    const s = snapshotOf({ projects: [p], todos: [inP, loose] });
    const r = searchResults(s, { query: 'paint', tagIds: [] });
    expect(r.groups.map((g) => g.title)).toEqual(['No project', 'Home']);
  });

  it('names a new saved search after its text, else its tags', () => {
    const tag = { ...todo(), title: 'Errands', shortcut: null, parentTagId: null };
    const s = snapshotOf({ tags: [tag] });
    expect(defaultSearchName({ query: ' milk ', tagIds: [] }, s)).toBe('milk');
    expect(defaultSearchName({ query: '', tagIds: [tag.id] }, s)).toBe('Errands');
  });

  it('lists open deadlines soonest first', () => {
    const late = todo({ deadline: '2026-12-01' });
    const soon = todo({ deadline: '2026-11-10' });
    const s = snapshotOf({ todos: [late, todo(), soon, todo({ deadline: '2026-11-01', status: 'completed' })] });
    expect(deadlineTodos(s)).toEqual([soon, late]);
  });
});

describe('Quick Find', () => {
  it('lists named items first, then tasks (open before completed), then a search row', () => {
    const p = project({ title: 'Garden' });
    const done = todo({ title: 'Garden hose', status: 'completed', completedAt: '2026-11-01T00:00:00Z' });
    const open = todo({ title: 'Garden seeds' });
    const s = snapshotOf({ projects: [p], todos: [done, open] });
    const kinds = quickFind(s, 'garden', LIST_TITLES).map((r) => (r.kind === 'todo' ? `todo:${r.logged}` : r.kind));
    expect(kinds).toEqual(['project', 'todo:false', 'todo:true', 'search']);
  });

  it('finds built-in lists and filters by name', () => {
    const titles = quickFind(snapshotOf(), 'dead', LIST_TITLES).map((r) => ('title' in r ? r.title : r.kind));
    expect(titles).toEqual(['Deadlines', 'search']);
    expect(quickFind(snapshotOf(), 'tod', LIST_TITLES)[0]).toMatchObject({ kind: 'list', list: 'today' });
  });

  it('returns nothing for an empty query', () => {
    expect(quickFind(snapshotOf(), ' ', LIST_TITLES)).toEqual([]);
  });
});

describe('saved search operations', () => {
  beforeEach(reset);

  it('creates, edits, reorders and deletes saved searches', async () => {
    const a = await repo.createSavedSearch({ title: ' Milk ', query: ' milk ', tagIds: [] });
    const b = await repo.createSavedSearch({ title: 'B', query: 'b', tagIds: ['t1'] });
    let s = await snap();
    expect(s.savedSearches.map((x) => [x.title, x.query])).toEqual([
      ['Milk', 'milk'],
      ['B', 'b'],
    ]);

    await repo.updateSavedSearch(a, { title: 'Dairy', query: 'milk cheese', tagIds: ['t2'] });
    expect(await db.savedSearches.get(a)).toMatchObject({ title: 'Dairy', query: 'milk cheese', tagIds: ['t2'] });

    await repo.placeSavedSearch(b, [b, a]);
    s = await snap();
    expect([...s.savedSearches].sort((x, y) => (x.sortKey < y.sortKey ? -1 : 1)).map((x) => x.id)).toEqual([b, a]);

    const t = await repo.createTodo({ title: 'milk cheese' });
    await repo.deleteSavedSearch(a);
    s = await snap();
    expect(s.savedSearches.map((x) => x.id)).toEqual([b]);
    expect(await db.todos.get(t)).toBeDefined();
  });

  it('stores a reactive tag list from the edit dialog as plain data', async () => {
    const id = await repo.createSavedSearch({ title: 'x', query: 'x', tagIds: [] });
    // Svelte state arrays are proxies, which IndexedDB cannot clone.
    await repo.updateSavedSearch(id, { tagIds: new Proxy(['t1'], {}) });
    expect((await db.savedSearches.get(id))!.tagIds).toEqual(['t1']);
  });

  it('removes a deleted tag from saved searches', async () => {
    const tag = await repo.createTag('Errands');
    const id = await repo.createSavedSearch({ title: 'x', query: '', tagIds: [tag] });
    await repo.deleteTag(tag);
    expect((await db.savedSearches.get(id))!.tagIds).toEqual([]);
  });

});

describe('search routes', () => {
  it('round-trips search, saved search and filter routes', async () => {
    const { hrefFor, parseHash } = await import('../src/lib/state/route');
    const search = { kind: 'search' as const, query: 'milk & eggs', tagIds: ['t1', 't2'] };
    expect(parseHash(hrefFor(search))).toEqual(search);
    expect(parseHash('#/saved/abc')).toEqual({ kind: 'saved', id: 'abc' });
    expect(parseHash('#/filter/deadlines')).toEqual({ kind: 'filter', filter: 'deadlines' });
    expect(parseHash('#/filter/toString')).toEqual({ kind: 'home' });
  });
});
