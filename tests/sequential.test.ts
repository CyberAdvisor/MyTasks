/**
 * Sequential projects (FR-17): release, priority, context, take-back, Reset
 * Other Tasks, the place label, and the synced setting.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, db } from '../src/lib/db/database';
import * as repo from '../src/lib/db/repo';
import { clearUndo, undo } from '../src/lib/db/history';
import { addDays, today } from '../src/lib/model/dates';
import { inToday } from '../src/lib/model/lists';
import { placeLabel, projectOrder, rowSubtitle, sequentialRule } from '../src/lib/model/sequential';
import { DEFAULT_SETTINGS, cleanSequentialTags } from '../src/lib/model/settings';
import { isValidRecord, isValidSetting } from '../src/lib/sync/validate';
import { upgradeList } from '../src/lib/db/migrations';
import { snap } from './helpers';
import { containerLabel, headingLabel } from '../src/lib/labels';

const row = async (id: string) => (await db.todos.get(id))!;

/** A project tagged with a listed tag, and its tasks in order. */
async function setup(titles: string[], priority: 1 | 2 | 3 | 4 | 5 | null = 3, withContext = true) {
  const tag = await repo.createTag('Next Up');
  const contextId = withContext ? await repo.createContext('Home') : null;
  await repo.setSetting('sequentialTags', [{ tagId: tag, priority, contextId }]);
  const projectId = await repo.createProject({ title: 'Vacation' });
  const ids: string[] = [];
  for (const title of titles) ids.push(await repo.createTodo({ title, projectId }));
  await repo.toggleTag('projects', projectId, tag, true);
  return { tag, contextId, projectId, ids };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  clearUndo();
});

describe('rules', () => {
  it('uses the highest priority of the listed tags and the first tag’s context', () => {
    const rows = [
      { tagId: 'a', priority: 4 as const, contextId: 'home' },
      { tagId: 'b', priority: 2 as const, contextId: 'office' },
      { tagId: 'c', priority: null, contextId: null },
    ];
    expect(sequentialRule({ tagIds: ['b', 'a'] }, rows)).toEqual({ priority: 2, contextId: 'home' });
    expect(sequentialRule({ tagIds: ['c'] }, rows)).toEqual({ priority: null, contextId: null });
    expect(sequentialRule({ tagIds: ['x'] }, rows)).toBeNull();
  });

  it('keeps only well-formed setting rows, each tag once, and syncs them', () => {
    expect(cleanSequentialTags([{ tagId: 'a', priority: 9, contextId: 3 }, { tagId: 'a' }, 'x'])).toEqual([
      { tagId: 'a', priority: null, contextId: null },
    ]);
    expect(isValidSetting({ key: 'sequentialTags', value: [{ tagId: 'a', priority: 2, contextId: null }] })).toBe(true);
    expect(isValidSetting({ key: 'sequentialTags', value: [{ tagId: 'a', priority: 2 }] })).toBe(false);
  });
});

describe('release (FR-17.2 to FR-17.4)', () => {
  it('moves the first task into Today with the tag’s priority and context', async () => {
    const { contextId, ids } = await setup(['Book flights', 'Pack bags', 'Renew passport']);
    const first = await row(ids[0]);
    expect(inToday(first, today())).toBe(true);
    expect(first.priority).toBe(3);
    expect(first.contextId).toBe(contextId);
    expect(inToday(await row(ids[1]), today())).toBe(false);
  });

  it('releases the next task on completion, and unchecking takes it back', async () => {
    const { ids } = await setup(['a', 'b', 'c']);
    await repo.setTodoStatus(ids[0], 'completed');
    const b = await row(ids[1]);
    expect(inToday(b, today())).toBe(true);
    expect(b.releasedBy).toBe(ids[0]);
    await repo.setTodoStatus(ids[1], 'completed');
    expect((await row(ids[2])).startDate).toBe(today());
    expect((await row(ids[2])).priority).toBe(3);
    // Unchecking b takes c back to where it was (no start date), without the priority and context it was given.
    await repo.setTodoStatus(ids[1], 'open');
    const c = await row(ids[2]);
    expect(c.startDate).toBeNull();
    expect(c.releasedBy).toBeNull();
    expect(c.priority).toBeNull();
    expect(c.contextId).toBeNull();
  });

  it('keeps a priority and context the user chose when returning a task', async () => {
    const { ids } = await setup(['a', 'b']);
    await repo.setTodoStatus(ids[0], 'completed');
    const office = await repo.createContext('Office');
    await repo.setPriority(ids[1], 1);
    await repo.setContext(ids[1], office);
    await repo.setTodoStatus(ids[0], 'open');
    const b = await row(ids[1]);
    expect(inToday(b, today())).toBe(false);
    expect(b.priority).toBe(1);
    expect(b.contextId).toBe(office);
  });

  it('undo after completing restores both tasks', async () => {
    const { contextId, ids } = await setup(['a', 'b']);
    await repo.setTodoStatus(ids[0], 'completed');
    expect((await row(ids[1])).contextId).toBe(contextId);
    await undo();
    expect((await row(ids[0])).status).toBe('open');
    const b = await row(ids[1]);
    expect(b.startDate).toBeNull();
    expect(b.priority).toBeNull();
    expect(b.contextId).toBeNull();
  });

  it('with no priority on the tag, follows Default P2; a chosen priority is kept', async () => {
    const { ids } = await setup(['a', 'b'], null, false);
    expect((await row(ids[0])).priority).toBe(2);
    await repo.setPriority(ids[1], 5);
    await repo.setTodoStatus(ids[0], 'completed');
    expect((await row(ids[1])).priority).toBe(5);
  });

  it('releases in the launch check, and not in a deferred project', async () => {
    const { projectId, ids } = await setup(['a', 'b']);
    await db.todos.update(ids[0], { startDate: null }); // as if another device had changed it
    await repo.sweepRules();
    expect(inToday(await row(ids[0]), today())).toBe(true);
    await repo.setProjectWhen(projectId, { kind: 'deferred' });
    await db.todos.update(ids[0], { status: 'completed' });
    await repo.sweepRules();
    expect(inToday(await row(ids[1]), today())).toBe(false);
  });
});

describe('the next task given a later date or Deferred (FR-17.2)', () => {
  it('stays where it was put: the project waits for it, then it enters Today on its date', async () => {
    // However it got its date: given while next up (here), or before its turn (the project then waits when its turn comes).
    const { ids } = await setup(['Book flights', 'Pack bags']);
    const tomorrow = addDays(today(), 1);
    await repo.setWhen(ids[0], { kind: 'date', date: tomorrow });
    await repo.sweepRules();
    expect((await row(ids[0])).startDate).toBe(tomorrow);
    // The project waits: nothing else goes into Today meanwhile.
    expect(inToday(await row(ids[1]), today())).toBe(false);
    // On its date it is in Today, and it is still the only one.
    expect(inToday(await row(ids[0]), tomorrow)).toBe(true);
    expect(inToday(await row(ids[1]), tomorrow)).toBe(false);
  });

  it('holds the project when its turn comes, if it was dated later before its turn', async () => {
    const { ids } = await setup(['a', 'b']);
    const later = addDays(today(), 9);
    await repo.setWhen(ids[1], { kind: 'date', date: later });
    await repo.setTodoStatus(ids[0], 'completed');
    expect((await row(ids[1])).startDate).toBe(later);
    expect(inToday(await row(ids[1]), today())).toBe(false);
  });

  it('stays deferred, and the project waits', async () => {
    const { ids } = await setup(['Book flights', 'Pack bags']);
    await repo.setWhen(ids[0], { kind: 'deferred' });
    await repo.sweepRules();
    expect((await row(ids[0])).start).toBe('deferred');
    expect(inToday(await row(ids[0]), today())).toBe(false);
    expect(inToday(await row(ids[1]), today())).toBe(false);
  });
});

describe('Reset Other Tasks (FR-17.6) and the place label', () => {
  it('returns the others, leaving tasks with a deadline', async () => {
    const { ids } = await setup(['a', 'b', 'c']);
    await repo.setWhen(ids[1], { kind: 'today' });
    await repo.setWhen(ids[2], { kind: 'today' });
    await repo.setDeadline(ids[2], addDays(today(), 3));
    const s = await snap();
    const a = s.todos.find((t) => t.id === ids[0])!;
    const settings = { ...DEFAULT_SETTINGS, sequentialTags: [{ tagId: s.tags[0].id, priority: 3 as const, contextId: null }] };
    const others = repo.tasksToReset(a, s, settings);
    expect(others.map((t) => t.id)).toEqual([ids[1]]);
    await repo.resetOtherTasks(others.map((t) => t.id));
    const b = await row(ids[1]);
    expect(b.startDate).toBeNull();
    expect(b.priority).toBeNull(); // the automatic P3 it got in Today is gone
    expect(inToday(await row(ids[0]), today())).toBe(true);
  });

  it('shows the place with the project name, and alone under a project group heading', () => {
    expect(rowSubtitle('Vacation', 'task 2 of 3', 'today')).toBe('Vacation · task 2 of 3');
    expect(rowSubtitle('', 'task 2 of 3', 'today')).toBe('task 2 of 3'); // Today grouped by project
    expect(rowSubtitle('', 'task 2 of 3', null)).toBe(''); // the project's own page
    expect(rowSubtitle('Home', '', null)).toBe('Home');
  });

  it('names the heading after the project, and leaves off an untitled one (FR-1.9)', async () => {
    const { projectId, ids } = await setup(['a']);
    const packing = await repo.createHeading(projectId, 'Packing');
    const untitled = await repo.createHeading(projectId);
    const under = await repo.createTodo({ title: 'b', projectId, headingId: packing });
    const blank = await repo.createTodo({ title: 'c', projectId, headingId: untitled });
    const areaId = await repo.createArea('Home');
    const inArea = await repo.createTodo({ title: 'd', areaId });
    const s = await snap();
    const label = async (id: string) => containerLabel(await row(id), s);
    expect(await label(ids[0])).toBe('Vacation');
    expect(await label(under)).toBe('Vacation : Packing');
    expect(await label(blank)).toBe('Vacation');
    expect(await label(inArea)).toBe('Home');
    expect(rowSubtitle(await label(under), 'task 2 of 3', 'today')).toBe('Vacation : Packing · task 2 of 3');
    // Under a project's group heading in Today, the heading alone.
    expect(headingLabel(await row(under), s)).toBe('Packing');
    expect(headingLabel(await row(blank), s)).toBe('');
    expect(headingLabel(await row(ids[0]), s)).toBe('');
  });

  it('labels a task with its place in the project', async () => {
    const { projectId, ids } = await setup(['a', 'b', 'c']);
    const s = await snap();
    expect(placeLabel({ id: ids[1] }, projectOrder(projectId, s.todos, s.headings))).toBe('task 2 of 3');
  });
});

describe('schema 7', () => {
  it('upgrades a schema-6 list whose release data lacks the given context', () => {
    const at = '2026-11-14T00:00:00.000Z';
    const t = {
      id: 't', createdAt: at, modifiedAt: at, deletedAt: null, sortKey: 'a0', title: 'x', notes: '', status: 'open',
      start: 'unscheduled', startDate: '2026-11-14', todaySortKey: null, deadline: null, priority: 3, prioritySource: 'auto',
      priorityBeforeAuto: null, tagIds: [], contextId: null, areaId: null, projectId: 'p', headingId: null,
      completedAt: null, loggedAt: null, trashedAt: null, releasedBy: null, releasedFrom: { start: 'unscheduled', startDate: null },
    };
    const gone = { id: 'g', deletedAt: at, modifiedAt: at };
    const old = { schema: 6, tables: { areas: [], projects: [], headings: [], todos: [t, gone], checklistItems: [], tags: [], contexts: [], savedSearches: [] } };
    const list = upgradeList(old, 7);
    expect(isValidRecord('todos', t)).toBe(false);
    // Valid once brought to the current schema (later versions add other fields).
    expect(isValidRecord('todos', upgradeList(old, SCHEMA_VERSION).tables.todos[0])).toBe(true);
    expect(list.tables.todos[0]).toMatchObject({ releasedFrom: { start: 'unscheduled', startDate: null, givenContextId: null } });
    expect(list.tables.todos[1]).toEqual(gone);
  });
});

describe('schema 6', () => {
  it('upgrades a schema-5 list: tasks weren’t released', () => {
    const at = '2026-11-01T00:00:00.000Z';
    const t = {
      id: 't', createdAt: at, modifiedAt: at, deletedAt: null, sortKey: 'a0', title: 'x', notes: '', status: 'open',
      start: 'inbox', startDate: null, todaySortKey: null, deadline: null, priority: null, prioritySource: null,
      priorityBeforeAuto: null, tagIds: [], contextId: null, areaId: null, projectId: null, headingId: null,
      completedAt: null, loggedAt: null, trashedAt: null,
    };
    const old = { schema: 5, tables: { areas: [], projects: [], headings: [], todos: [t], checklistItems: [], tags: [], contexts: [], savedSearches: [] } };
    const list = upgradeList(old, 6);
    expect(isValidRecord('todos', t)).toBe(false);
    expect(list.tables.todos[0]).toMatchObject({ releasedBy: null, releasedFrom: null });
    // Checked at the current schema (later versions add other fields).
    const current = upgradeList(old, SCHEMA_VERSION).tables.todos[0];
    expect(isValidRecord('todos', current)).toBe(true);
    const released = { ...current, releasedFrom: { start: 'unscheduled', startDate: null, givenContextId: null } };
    expect(isValidRecord('todos', released)).toBe(true);
    expect(isValidRecord('todos', { ...released, releasedFrom: { start: 'unscheduled', startDate: null } })).toBe(false);
  });
});

describe('transactions', () => {
  it('stay open across awaits in nested helpers', async () => {
    const { tx } = await import('../src/lib/db/history');
    const a = await repo.createTodo({ title: 'a' });
    const b = await repo.createTodo({ title: 'b' });
    const patch = async (id: string) => { await db.todos.update(id, { notes: 'x' }); await db.changeLog.add({ entity: 'todos', entityId: id, fields: ['notes'], at: '' }); };
    const apply = async (id: string) => { await db.todos.get(id); await patch(id); };
    await tx(async () => { for (const id of [a, b, a, b]) await apply(id); });
    expect((await row(b)).notes).toBe('x');
  });
});

describe('a chosen None and a release (FR-14.15)', () => {
  it('a task released into Today gets the tag’s priority even with a None chosen earlier', async () => {
    const tag = await repo.createTag('Next Up');
    const projectId = await repo.createProject({ title: 'Home Maintenance' });
    const first = await repo.createTodo({ title: 'Clean household guns', projectId });
    await db.todos.update(first, { priority: null, prioritySource: 'user' });
    await repo.toggleTag('projects', projectId, tag, true);
    await repo.setSetting('sequentialTags', [{ tagId: tag, priority: 3, contextId: null }]);
    expect(inToday(await row(first), today())).toBe(true);
    expect(await row(first)).toMatchObject({ priority: 3, prioritySource: 'auto' });
  });
});
