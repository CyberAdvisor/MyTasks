/** Tests for the to-do right-click menu (FR-1.7). */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/lib/db/database';
import * as repo from '../src/lib/db/repo';
import { clearUndo, undo } from '../src/lib/db/history';
import { formatTimestamp, today } from '../src/lib/model/dates';
import { completeChoices, completeChoicesFor, repeatSubmenuItems, selectModeMenuItems, severalMenuItems, todoMenuItems, type TodoMenuItem } from '../src/lib/model/todoMenu';
import type { Todo } from '../src/lib/model/types';

beforeEach(async () => {
  await db.delete();
  await db.open();
  clearUndo();
});

/** The menu as text: labels, "›" for submenus, "(off)" when disabled, "—" for separators. */
const show = (items: TodoMenuItem[]) =>
  items.map((i) => (i.kind === 'separator' ? '—' : i.kind === 'submenu' ? `${i.label} ›` : i.label + (i.disabled ? ' (off)' : '')));

describe('menu for several selected tasks (FR-10.1)', () => {
  it('counts in the labels, no Get Info, Convert or Show', () => {
    const inProject = { projectId: 'p', areaId: null };
    expect(show(severalMenuItems([inProject, inProject, inProject], { waiting: false }))).toEqual([
      'Start Date…', 'Move…', 'Tags…', 'Deadline…', 'Priority ›', 'Context ›', 'Complete ›', '—',
      'Duplicate 3 Tasks', 'Delete 3 Tasks', '—', 'Remove From Project', '—', 'Move Completed Items (off)',
    ]);
  });

  it('offers Remove From only when every task is in a project, or every task in an area', () => {
    const area = { projectId: null, areaId: 'a' };
    expect(show(severalMenuItems([area, area], { waiting: true }))).toContain('Remove From Area');
    expect(show(severalMenuItems([area, { projectId: null, areaId: null }], { waiting: true })).join()).not.toContain('Remove From');
  });

  it('completes, cancels or reopens: their shared choices, or all three when they differ', () => {
    expect(completeChoicesFor(['open', 'open'])).toEqual(completeChoices('open'));
    expect(completeChoicesFor(['open', 'completed']).map((c) => c.status)).toEqual(['open', 'completed', 'canceled']);
  });
});

describe('Select mode ⋯ menu on touch (FR-10.2)', () => {
  it("has what the floating bar doesn't; Mark as Open when all are done", () => {
    expect(show(selectModeMenuItems(['open', 'completed']))).toEqual([
      'Priority ›', 'Context ›', 'Tags…', 'Deadline…', '—', 'Mark as Completed', 'Duplicate',
    ]);
    expect(show(selectModeMenuItems(['completed', 'canceled']))).toContain('Mark as Open');
  });
});

describe('menu items', () => {
  const open = { mode: 'open' as const, link: null, waiting: false };

  it('a task in a project, opened elsewhere, keeps its order', () => {
    expect(show(todoMenuItems({ projectId: 'p', areaId: null }, { ...open, link: 'project', waiting: true }))).toEqual([
      'Start Date…', 'Move…', 'Tags…', 'Deadline…', 'Priority ›', 'Context ›', 'Complete ›', 'Repeat…', '—',
      'Get Info', 'Duplicate Task', 'Convert to Project…', 'Delete Task', '—',
      'Remove From Project', '—', 'Show in Project', 'Move Completed Items',
    ]);
  });

  it('a repeating task’s template keeps Complete and adds a Repeat submenu, without its dates (FR-4.4)', () => {
    const rule = { paused: false } as NonNullable<Todo['repeat']>;
    expect(show(todoMenuItems({ projectId: 'p', areaId: null, repeat: rule }, open)).slice(0, 7)).toEqual([
      'Move…', 'Tags…', 'Priority ›', 'Context ›', 'Complete ›', 'Repeat ›', '—',
    ]);
    expect(show(repeatSubmenuItems(false))).toEqual([
      'Edit Rule…', '—', 'Show Previous Copy', 'Create Next Copy', '—', 'Pause', 'Stop…',
    ]);
    expect(show(repeatSubmenuItems(true))).toContain('Resume');
  });

  it('an area task offers Remove From Area and Show in Area', () => {
    const items = show(todoMenuItems({ projectId: null, areaId: 'a' }, { ...open, link: 'area' }));
    expect(items).toContain('Remove From Area');
    expect(items).toContain('Show in Area');
  });

  it('a loose task on its own page: no Remove, no Show, and Move Completed Items is off with nothing waiting', () => {
    const items = show(todoMenuItems({ projectId: null, areaId: null }, open));
    expect(items.slice(-3)).toEqual(['Delete Task', '—', 'Move Completed Items (off)']);
  });

  it('in Trash: Put Back and Delete Immediately', () => {
    expect(show(todoMenuItems({ projectId: 'p', areaId: null }, { ...open, mode: 'trash' }))).toEqual([
      'Put Back', '—', 'Delete Immediately…',
    ]);
  });

  it('Complete › offers what the status can become', () => {
    const labels = (s: Parameters<typeof completeChoices>[0]) => completeChoices(s).map((c) => c.label);
    expect(labels('open')).toEqual(['Mark as Completed', 'Mark as Canceled']);
    expect(labels('completed')).toEqual(['Mark as Open', 'Mark as Canceled']);
    expect(labels('canceled')).toEqual(['Mark as Open', 'Mark as Completed']);
  });
});

describe('menu actions', () => {
  it('Remove From Project keeps the When date; an undated task goes to the Inbox', async () => {
    const p = await repo.createProject({ title: 'P' });
    const dated = await repo.createTodo({ projectId: p, startDate: today() });
    const undated = await repo.createTodo({ projectId: p });
    await repo.moveTodo(dated, {});
    await repo.moveTodo(undated, {});
    const [d, u] = [await db.todos.get(dated), await db.todos.get(undated)];
    expect([d?.projectId, d?.startDate, d?.start]).toEqual([null, today(), 'unscheduled']);
    expect([u?.projectId, u?.start]).toEqual([null, 'inbox']);
  });

  it('Delete Immediately removes the task and its checklist, and is not an undo step', async () => {
    const id = await repo.createTodo({ title: 'x', checklist: [{ title: 'a', completed: false }] });
    await repo.setTodoTrashed(id, true);
    await repo.deleteTodoForever(id);
    expect((await db.todos.get(id))?.deletedAt).not.toBeNull();
    expect((await db.checklistItems.toArray()).every((c) => c.deletedAt)).toBe(true);
    expect(await undo()).toBe('none'); // nothing left to undo, so it cannot come back
    expect((await db.todos.get(id))?.deletedAt).not.toBeNull();
  });
});

describe('Get Info times', () => {
  const now = new Date(2026, 10, 12, 9, 0);
  it('says Today, Yesterday, or the date', () => {
    expect(formatTimestamp(new Date(2026, 10, 12, 6, 2).toISOString(), now)).toMatch(/^Today at 6:02/);
    expect(formatTimestamp(new Date(2026, 10, 11, 21, 14).toISOString(), now)).toMatch(/^Yesterday at 9:14/);
    expect(formatTimestamp(new Date(2026, 10, 10, 9, 14).toISOString(), now)).toMatch(/^Nov 10, 2026 at 9:14/);
  });
});
