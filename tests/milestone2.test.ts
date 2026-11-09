/**
 * Tests for Milestone 2: date helpers for the pickers, settings, automatic
 * priority, tags and checklists.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/lib/db/database';
import * as repo from '../src/lib/db/repo';
import { addDays, monthGrid, nextWeek, thisWeekend, today } from '../src/lib/model/dates';
import { priorityRules } from '../src/lib/model/priority';
import { DEFAULT_SETTINGS, readSettings, type AppSettings } from '../src/lib/model/settings';
import { checklistFor, checklistProgress, effectiveTagIds, filterByTag, splitLines, tagsInUse } from '../src/lib/model/tags';
import { project, snap, snapshotOf, todo } from './helpers';

const REF = '2026-11-09'; // a Monday
const ON = DEFAULT_SETTINGS;
const OFF: AppSettings = { ...DEFAULT_SETTINGS, autoP1: false, defaultP2: false };

describe('picker dates', () => {
  it('finds This Weekend and Next Week', () => {
    expect(thisWeekend(REF)).toBe('2026-11-14'); // Saturday
    expect(thisWeekend('2026-11-15')).toBe('2026-11-15'); // Sunday is already the weekend
    expect(nextWeek(REF)).toBe('2026-11-16'); // next Monday, not today
    expect(nextWeek('2026-11-15')).toBe('2026-11-16');
  });

  it('builds a Monday-first month grid', () => {
    const weeks = monthGrid('2026-11-20');
    expect(weeks[0]).toEqual([null, null, null, null, null, null, '2026-11-01']); // Nov 1 2026 is a Sunday
    expect(weeks.flat().filter(Boolean)).toHaveLength(30);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
  });
});

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
  it('gives P2 to a to-do entering Today with no priority', () => {
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

  it('restores the earlier value when the to-do is no longer due', () => {
    const wasP2 = todo({ startDate: REF, priority: 1, prioritySource: 'auto', priorityBeforeAuto: 2 });
    expect(priorityRules(wasP2, REF, ON)).toEqual({ priority: 2, prioritySource: 'auto', priorityBeforeAuto: null });
    const wasNone = todo({ priority: 1, prioritySource: 'auto', priorityBeforeAuto: null });
    expect(priorityRules(wasNone, REF, ON)).toEqual({ priority: null, prioritySource: null, priorityBeforeAuto: null });
  });

  it('never changes a user priority, including a chosen "None"', () => {
    expect(priorityRules(todo({ deadline: REF, priority: 4, prioritySource: 'user' }), REF, ON)).toBeNull();
    expect(priorityRules(todo({ startDate: REF, priority: null, prioritySource: 'user' }), REF, ON)).toBeNull();
  });

  it('freezes closed to-dos and leaves priorities when a rule is off', () => {
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

describe('tag and checklist helpers', () => {
  it('inherits tags from project and area for filtering', () => {
    const area = { id: 'area1', tagIds: ['home'] } as never;
    const p = project({ id: 'p1', areaId: 'area1', tagIds: ['errand'] });
    const t = todo({ projectId: 'p1', tagIds: ['quick'] });
    const loose = todo({ tagIds: [] });
    const s = snapshotOf({
      areas: [area],
      projects: [p],
      todos: [t, loose],
      tags: ['quick', 'errand', 'home', 'unused'].map((id, i) => ({ id, title: id, sortKey: `a${i}` }) as never),
    });
    expect([...effectiveTagIds(t, s)].sort()).toEqual(['errand', 'home', 'quick']);
    expect(filterByTag(s.todos, 'home', s)).toEqual([t]);
    expect(filterByTag(s.todos, null, s)).toHaveLength(2);
    expect(tagsInUse(s.todos, s).map((x) => x.id)).toEqual(['quick', 'errand', 'home']);
  });

  it('splits pasted text into checklist lines', () => {
    expect(splitLines('- Milk\r\n\n* Eggs\n[ ] Bread\n  Butter  ')).toEqual(['Milk', 'Eggs', 'Bread', 'Butter']);
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
    await repo.sweepPriorities();
    expect((await row(id)).priority).toBe(2);
  });

  it('turning a rule back on applies it to existing to-dos', async () => {
    await repo.setSetting('defaultP2', false);
    const id = await repo.createTodo({ title: 'x', startDate: today() });
    expect((await row(id)).priority).toBeNull();
    await repo.setSetting('defaultP2', true);
    expect((await row(id)).priority).toBe(2);
  });

  it('keeps the priority of completed to-dos', async () => {
    const id = await repo.createTodo({ title: 'x', startDate: today() });
    await repo.setTodoStatus(id, 'completed');
    await repo.setDeadline(id, today());
    expect((await row(id)).priority).toBe(2);
  });
});

describe('tag operations', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('creates, reorders, assigns and deletes tags', async () => {
    const a = await repo.createTag('Errand');
    const b = await repo.createTag(' Home ');
    await repo.moveTag(b, 'up');
    let s = await snap();
    expect([...s.tags].sort((x, y) => (x.sortKey < y.sortKey ? -1 : 1)).map((t) => t.title)).toEqual(['Home', 'Errand']);

    const t = await repo.createTodo({ title: 'x' });
    // Quick successive changes must not overwrite each other.
    await Promise.all([repo.toggleTag('todos', t, a, true), repo.toggleTag('todos', t, b, true)]);
    await repo.toggleTag('todos', t, a, true); // already on: no change
    expect((await db.todos.get(t))!.tagIds).toEqual([a, b]);

    await repo.deleteTag(a);
    s = await snap();
    expect(s.tags.map((x) => x.id)).toEqual([b]);
    expect((await db.todos.get(t))!.tagIds).toEqual([b]);
  });
});

describe('checklist operations', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  const titles = async (todoId: string) => checklistFor(todoId, await snap()).map((c) => c.title);

  it('adds items in order, after a given item, and from a paste', async () => {
    const t = await repo.createTodo({ title: 'x' });
    const [a] = await repo.addChecklistItems(t, ['a']);
    await repo.addChecklistItems(t, ['d']);
    await repo.addChecklistItems(t, ['b', 'c'], a);
    expect(await titles(t)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('checks, moves and deletes items', async () => {
    const t = await repo.createTodo({ title: 'x' });
    const [a, b, c] = await repo.addChecklistItems(t, ['a', 'b', 'c']);
    await repo.updateChecklistItem(b, { completed: true });
    await repo.moveChecklistItem(c, 'up');
    await repo.moveChecklistItem(a, 'down');
    expect(await titles(t)).toEqual(['c', 'a', 'b']);
    await repo.moveChecklistItem(c, 'up'); // already first: no change
    await repo.deleteChecklistItem(a);
    expect(await titles(t)).toEqual(['c', 'b']);
    expect(checklistProgress(t, await snap())).toEqual({ done: 1, total: 2 });
  });

  it('copies the checklist when duplicating a to-do', async () => {
    const t = await repo.createTodo({ title: 'x' });
    await repo.addChecklistItems(t, ['a', 'b']);
    const copy = (await repo.duplicateTodo(t))!;
    expect(await titles(copy)).toEqual(['a', 'b']);
    expect(await titles(t)).toEqual(['a', 'b']);
  });

  it('turns checklist items into to-dos when converting to a project', async () => {
    const tag = await repo.createTag('Work');
    const t = await repo.createTodo({ title: 'Plan trip' });
    await repo.toggleTag('todos', t, tag, true);
    const [, second] = await repo.addChecklistItems(t, ['Book flights', 'Pack']);
    await repo.updateChecklistItem(second, { completed: true });
    const projectId = (await repo.convertTodoToProject(t))!;
    const s = await snap();
    const inside = s.todos.filter((x) => x.projectId === projectId).sort((x, y) => (x.sortKey < y.sortKey ? -1 : 1));
    expect(inside.map((x) => [x.title, x.status])).toEqual([
      ['Book flights', 'open'],
      ['Pack', 'completed'],
    ]);
    expect(s.projects[0].tagIds).toEqual([tag]);
    expect(s.checklistItems).toHaveLength(0);
  });

  it('removes checklist items when the Trash is emptied', async () => {
    const t = await repo.createTodo({ title: 'x' });
    await repo.addChecklistItems(t, ['a']);
    await repo.setTodoTrashed(t, true);
    await repo.emptyTrash();
    expect((await snap()).checklistItems).toHaveLength(0);
  });
});

describe('project duplication', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('copies headings, open to-dos and checklists, right after the original', async () => {
    const tag = await repo.createTag('Home');
    const p = await repo.createProject({ title: 'Garden', tagIds: [tag] });
    const later = await repo.createProject({ title: 'Later' });
    const h = await repo.createHeading(p, 'Spring');
    const a = await repo.createTodo({ title: 'Seeds', projectId: p, headingId: h });
    await repo.addChecklistItems(a, ['Tomato', 'Basil']);
    const done = await repo.createTodo({ title: 'Old', projectId: p });
    await repo.setTodoStatus(done, 'completed');

    const copyId = (await repo.duplicateProject(p))!;
    const s = await snap();
    const order = [...s.projects].sort((x, y) => (x.sortKey < y.sortKey ? -1 : 1)).map((x) => x.id);
    expect(order).toEqual([p, copyId, later]);
    const copy = s.projects.find((x) => x.id === copyId)!;
    expect([copy.title, copy.tagIds]).toEqual(['Garden', [tag]]);

    const newHeading = s.headings.find((x) => x.projectId === copyId)!;
    expect(newHeading.title).toBe('Spring');
    const copied = s.todos.filter((t) => t.projectId === copyId);
    expect(copied.map((t) => [t.title, t.headingId])).toEqual([['Seeds', newHeading.id]]);
    expect(checklistFor(copied[0].id, s).map((c) => c.title)).toEqual(['Tomato', 'Basil']);
    expect(s.todos.filter((t) => t.projectId === p)).toHaveLength(2); // original untouched
  });
});
