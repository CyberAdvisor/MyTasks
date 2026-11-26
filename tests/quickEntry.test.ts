/**
 * Quick Entry: its draft and saving it (FR-8.1).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/lib/db/database';
import * as repo from '../src/lib/db/repo';
import { today } from '../src/lib/model/dates';
import { snap, todo } from './helpers';

const reset = async () => {
  await db.delete();
  await db.open();
};

describe('Quick Entry save', () => {
  beforeEach(reset);

  it('writes the task and its checklist together', async () => {
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
    // While an area is focused, a new task in a date list goes in that area; the Inbox stays the Inbox (FR-22.1).
    expect(draftStartFor({ kind: 'list', list: 'today' }, '2026-11-09', 'a')).toEqual({ placement: { areaId: 'a' }, startDate: '2026-11-09' });
    expect(draftStartFor({ kind: 'list', list: 'inbox' }, '2026-11-09', 'a')).toEqual({});
  });

  it('keeps When, tags, priority, reminder and checklist until saved', async () => {
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
    expect(d.toNewTodo().reminder).toBeNull();
    d.reminder = '2026-11-10T09:00';
    expect(d.toNewTodo().reminder).toBe('2026-11-10T09:00');
  });

  it('saves a draft into a project as one task', async () => {
    const pid = await repo.createProject({ title: 'Trip' });
    const d = new TodoDraft(draftStartFor({ kind: 'project', id: pid }, today()));
    d.title = 'Book hotel';
    await d.checklist.add(['Compare prices'], null);
    const id = await repo.createTodo(d.toNewTodo());
    const s = await snap();
    expect(s.todos.find((t) => t.id === id)).toMatchObject({ projectId: pid, start: 'unscheduled' });
    expect(s.checklistItems.map((c) => c.title)).toEqual(['Compare prices']);
  });

  it('finds the view a task lives in', () => {
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
