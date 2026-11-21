/**
 * Checklist operations (FR-7), and Duplicate Project, which copies checklists (FR-2.1).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/lib/db/database';
import * as repo from '../src/lib/db/repo';
import { checklistFor, checklistProgress } from '../src/lib/model/tags';
import { droppedOrder } from '../src/lib/state/checklist.svelte';
import { undo } from '../src/lib/db/history';
import { snap } from './helpers';

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

  it('puts a dragged item where it was dropped, as one undo step', async () => {
    const t = await repo.createTodo({ title: 'x' });
    const [a, b, c] = await repo.addChecklistItems(t, ['a', 'b', 'c']);
    await repo.placeChecklistItem(c, [c, a, b]);
    expect(await titles(t)).toEqual(['c', 'a', 'b']);
    await repo.placeChecklistItem(c, [a, c, b]);
    expect(await titles(t)).toEqual(['a', 'c', 'b']);
    await undo();
    expect(await titles(t)).toEqual(['c', 'a', 'b']);
  });

  it('copies the checklist when duplicating a task', async () => {
    const t = await repo.createTodo({ title: 'x' });
    await repo.addChecklistItems(t, ['a', 'b']);
    const copy = (await repo.duplicateTodo(t))!;
    expect(await titles(copy)).toEqual(['a', 'b']);
    expect(await titles(t)).toEqual(['a', 'b']);
  });

  it('turns checklist items into tasks when converting to a project', async () => {
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

  it('copies headings, open tasks and checklists, right after the original', async () => {
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

describe('the stored order after a drop (droppedOrder)', () => {
  it('follows the shown order when nothing is moved for display', () => {
    expect(droppedOrder(['a', 'b', 'c'], ['c', 'a', 'b'], 'c')).toEqual(['c', 'a', 'b']);
    expect(droppedOrder(['a', 'b', 'c'], ['b', 'c', 'a'], 'a')).toEqual(['b', 'c', 'a']);
    expect(droppedOrder(['a', 'b', 'c'], ['a', 'c', 'b'], 'c')).toEqual(['a', 'c', 'b']);
  });

  it('with checked items at the bottom, places the item among its own part', () => {
    // Stored a✓ b✓ c; shown c, a✓, b✓. Dragging b above a: shown c, b, a.
    const done = new Map([['a', true], ['b', true], ['c', false]]);
    const together = (x: string) => done.get(x) === done.get('b');
    expect(droppedOrder(['a', 'b', 'c'], ['c', 'b', 'a'], 'b', together)).toEqual(['b', 'a', 'c']);
    // Dragging c (unchecked, alone in its part) anywhere keeps the stored order.
    const alone = (x: string) => done.get(x) === done.get('c');
    expect(droppedOrder(['a', 'b', 'c'], ['a', 'c', 'b'], 'c', alone)).toEqual(['a', 'b', 'c']);
  });
});
