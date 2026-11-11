/**
 * Tests for Milestone 3: search and Quick Find, saved searches, Today
 * grouping and Quick Entry saving.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/lib/db/database';
import * as repo from '../src/lib/db/repo';
import { today } from '../src/lib/model/dates';
import { todayGroups, groupByContainer, type BuiltInList } from '../src/lib/model/lists';
import {
  deadlineTodos,
  defaultSearchName,
  fold,
  openMatchCount,
  quickFind,
  searchResults,
  searchTodos,
} from '../src/lib/model/search';
import { DEFAULT_SETTINGS, readSettings } from '../src/lib/model/settings';
import { filterByTag } from '../src/lib/model/tags';
import { project, snap, snapshotOf, todo } from './helpers';

const LABELS = ['Urgent', 'High', 'P3', 'P4', 'P5'];
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

  it('skips the Trash and lists logged matches apart, newest first', () => {
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
  it('lists named items first, then to-dos (open before logged), then a search row', () => {
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

describe('Today grouping', () => {
  const area = { ...todo(), title: 'Work', tagIds: [], collapsed: false };
  const p = project({ title: 'Launch', areaId: area.id });
  const a = todo({ title: 'a', projectId: p.id, priority: 2, todaySortKey: 'a2' });
  const b = todo({ title: 'b', priority: 1, todaySortKey: 'a1' });
  const c = todo({ title: 'c', areaId: area.id, todaySortKey: 'a3' });
  const d = todo({ title: 'd', projectId: p.id, priority: 2, todaySortKey: 'a0' });
  const s = snapshotOf({ areas: [area], projects: [p], todos: [a, b, c, d] });
  const inOrder = [d, b, a, c]; // Today's manual order

  it('None is one list in manual order', () => {
    expect(todayGroups(inOrder, 'none', s, LABELS)).toEqual([{ key: 'all', title: '', todos: inOrder }]);
    expect(todayGroups([], 'none', s, LABELS)).toEqual([]);
  });

  it('Project groups by area and project, keeps manual order, and puts No project last', () => {
    const g = todayGroups(inOrder, 'project', s, LABELS);
    expect(g.map((x) => [x.title, x.subtitle, x.todos.map((t) => t.title)])).toEqual([
      ['Work', undefined, ['c']],
      ['Launch', 'Work', ['d', 'a']],
      ['No project', undefined, ['b']],
    ]);
  });

  it('Priority groups by the user labels, hides empty groups, and ends with No priority', () => {
    const g = todayGroups(inOrder, 'priority', s, LABELS);
    expect(g.map((x) => [x.title, x.todos.map((t) => t.title)])).toEqual([
      ['Urgent', ['b']],
      ['High', ['d', 'a']],
      ['No priority', ['c']],
    ]);
  });

  it('applies after the tag filter, hiding groups with no matches', () => {
    const tagged = { ...b, tagIds: ['x'] };
    const s2 = snapshotOf({ areas: [area], projects: [p], todos: [a, tagged, c, d] });
    const filtered = filterByTag([d, tagged, a, c], 'x', s2);
    expect(todayGroups(filtered, 'project', s2, LABELS).map((x) => x.title)).toEqual(['No project']);
  });

  it('keeps container order for other lists', () => {
    expect(groupByContainer([c, b], s)[0].title).toBe('No project');
  });

  it('reads the grouping setting, falling back to None', () => {
    expect(readSettings([{ key: 'todayGrouping', value: 'priority' }]).todayGrouping).toBe('priority');
    expect(readSettings([{ key: 'todayGrouping', value: 'bogus' }]).todayGrouping).toBe('none');
    expect(DEFAULT_SETTINGS.todayGrouping).toBe('none');
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

  it('logs every change for sync', async () => {
    const id = await repo.createSavedSearch({ title: 'x', query: 'x', tagIds: [] });
    await repo.updateSavedSearch(id, { title: 'y' });
    const rows = await db.changeLog.where('entityId').equals(id).toArray();
    expect(rows.map((r) => r.fields)).toEqual([['*'], ['title']]);
  });
});

describe('Quick Entry save', () => {
  beforeEach(reset);

  it('writes the to-do and its checklist together', async () => {
    const tag = await repo.createTag('Home');
    const id = await repo.createTodo({
      title: 'Pack',
      notes: 'for Denver',
      startDate: today(),
      deadline: '2030-01-01',
      tagIds: [tag],
      priority: 3,
      checklist: [
        { title: 'Charger', completed: false },
        { title: 'Boots', completed: true },
      ],
    });
    const t = (await db.todos.get(id))!;
    expect(t).toMatchObject({
      title: 'Pack',
      notes: 'for Denver',
      start: 'unscheduled',
      deadline: '2030-01-01',
      tagIds: [tag],
      priority: 3,
      prioritySource: 'user',
    });
    const items = (await snap()).checklistItems.sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1));
    expect(items.map((c) => [c.title, c.completed, c.todoId])).toEqual([
      ['Charger', false, id],
      ['Boots', true, id],
    ]);
  });

  it('lets the automatic rules set a priority when none was chosen', async () => {
    const auto = await repo.createTodo({ title: 'a', startDate: today() });
    expect((await db.todos.get(auto))!).toMatchObject({ priority: 2, prioritySource: 'auto' });
    const none = await repo.createTodo({ title: 'b', startDate: today(), priority: null });
    expect((await db.todos.get(none))!).toMatchObject({ priority: null, prioritySource: 'user' });
  });

  it('writes nothing when the transaction fails', async () => {
    const before = await db.todos.count();
    // A checklist entry with no title field breaks the write after the to-do is added.
    await expect(
      repo.createTodo({ title: 'x', checklist: [null as unknown as { title: string; completed: boolean }] }),
    ).rejects.toThrow();
    expect(await db.todos.count()).toBe(before);
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

describe('Quick Entry draft', async () => {
  const { TodoDraft } = await import('../src/lib/state/draft.svelte');
  const { draftStartFor, homeOf } = await import('../src/lib/actions');
  beforeEach(reset);

  it('starts in the view it was opened from', () => {
    expect(draftStartFor({ kind: 'project', id: 'p' }, '2026-11-09')).toEqual({ placement: { projectId: 'p' } });
    expect(draftStartFor({ kind: 'list', list: 'today' }, '2026-11-09')).toEqual({ startDate: '2026-11-09' });
    expect(draftStartFor({ kind: 'list', list: 'scheduled' }, '2026-11-09')).toEqual({ startDate: '2026-11-10' });
    expect(draftStartFor({ kind: 'list', list: 'deferred' }, '2026-11-09')).toEqual({ deferred: true });
    expect(draftStartFor({ kind: 'saved', id: 'x' }, '2026-11-09')).toEqual({});
  });

  it('keeps When, tags, priority and checklist until saved', async () => {
    const d = new TodoDraft();
    d.title = '  Pack ';
    d.setWhen({ kind: 'deferred' }, '2026-11-09');
    expect([d.deferred, d.startDate]).toEqual([true, null]);
    d.setWhen({ kind: 'today' }, '2026-11-09');
    expect([d.deferred, d.startDate]).toEqual([false, '2026-11-09']);
    d.toggleTag('a', true);
    d.toggleTag('b', true);
    d.toggleTag('a', false);
    const [first] = await d.checklist.add(['one', ''], null);
    const [zero] = await d.checklist.add(['zero'], null);
    await d.checklist.move(zero, 'up');
    await d.checklist.move(zero, 'up');
    await d.checklist.update(first, { completed: true });
    expect(d.checklist.items.map((c) => c.title)).toEqual(['zero', 'one', '']);
    expect(d.toNewTodo()).toMatchObject({
      title: 'Pack',
      startDate: '2026-11-09',
      tagIds: ['b'],
      checklist: [
        { title: 'zero', completed: false },
        { title: 'one', completed: true },
      ],
    });
    expect('priority' in d.toNewTodo()).toBe(false);
    d.priority = null;
    expect(d.toNewTodo().priority).toBeNull();
  });

  it('saves a draft into a project as one to-do', async () => {
    const pid = await repo.createProject({ title: 'Trip' });
    const d = new TodoDraft(draftStartFor({ kind: 'project', id: pid }, today()));
    d.title = 'Book hotel';
    await d.checklist.add(['Compare prices'], null);
    const id = await repo.createTodo(d.toNewTodo());
    const s = await snap();
    expect(s.todos.find((t) => t.id === id)).toMatchObject({ projectId: pid, start: 'unscheduled' });
    expect(s.checklistItems.map((c) => c.title)).toEqual(['Compare prices']);
  });

  it('finds the view a to-do lives in', () => {
    const ref = '2026-11-09';
    expect(homeOf(todo({ start: 'inbox' }), ref)).toEqual({ kind: 'list', list: 'inbox' });
    expect(homeOf(todo({ projectId: 'p' }), ref)).toEqual({ kind: 'project', id: 'p' });
    expect(homeOf(todo({ startDate: ref }), ref)).toEqual({ kind: 'list', list: 'today' });
    expect(homeOf(todo({ startDate: '2026-12-01' }), ref)).toEqual({ kind: 'list', list: 'scheduled' });
    expect(homeOf(todo({ start: 'deferred' }), ref)).toEqual({ kind: 'list', list: 'deferred' });
    expect(homeOf(todo({ status: 'completed', loggedAt: 'x' }), ref)).toEqual({ kind: 'list', list: 'logbook' });
    // Completed but still waiting to move: found where it was (FR-12.2).
    expect(homeOf(todo({ status: 'completed', startDate: ref }), ref)).toEqual({ kind: 'list', list: 'today' });
    expect(homeOf(todo(), ref)).toEqual({ kind: 'list', list: 'unscheduled' });
  });
});
