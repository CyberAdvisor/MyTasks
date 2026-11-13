/** Tests for the to-do right-click menu (FR-1.7). */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/lib/db/database';
import * as repo from '../src/lib/db/repo';
import { clearUndo, undo } from '../src/lib/db/history';
import { formatTimestamp, today } from '../src/lib/model/dates';
import { completeChoices, todoMenuItems, type TodoMenuItem } from '../src/lib/model/todoMenu';

beforeEach(async () => {
  await db.delete();
  await db.open();
  clearUndo();
});

/** The menu as text: labels, "›" for submenus, "(off)" when disabled, "—" for separators. */
const show = (items: TodoMenuItem[]) =>
  items.map((i) => (i.kind === 'separator' ? '—' : i.kind === 'submenu' ? `${i.label} ›` : i.label + (i.disabled ? ' (off)' : '')));

describe('menu items', () => {
  const open = { mode: 'open' as const, link: null, waiting: false };

  it('a to-do in a project, opened elsewhere, matches Things’ order', () => {
    expect(show(todoMenuItems({ projectId: 'p', areaId: null }, { ...open, link: 'project', waiting: true }))).toEqual([
      'When…', 'Move…', 'Tags…', 'Deadline…', 'Priority ›', 'Context ›', 'Complete ›', '—',
      'Get Info', 'Duplicate Task', 'Convert to Project…', 'Delete Task', '—',
      'Remove From Project', '—', 'Show in Project', 'Move to Completed',
    ]);
  });

  it('an area to-do offers Remove From Area and Show in Area', () => {
    const items = show(todoMenuItems({ projectId: null, areaId: 'a' }, { ...open, link: 'area' }));
    expect(items).toContain('Remove From Area');
    expect(items).toContain('Show in Area');
  });

  it('a loose to-do on its own page: no Remove, no Show, and Move to Completed is off with nothing waiting', () => {
    const items = show(todoMenuItems({ projectId: null, areaId: null }, open));
    expect(items.slice(-3)).toEqual(['Delete Task', '—', 'Move to Completed (off)']);
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
  it('Remove From Project keeps the When date; an undated to-do goes to the Inbox', async () => {
    const p = await repo.createProject({ title: 'P' });
    const dated = await repo.createTodo({ projectId: p, startDate: today() });
    const undated = await repo.createTodo({ projectId: p });
    await repo.moveTodo(dated, {});
    await repo.moveTodo(undated, {});
    const [d, u] = [await db.todos.get(dated), await db.todos.get(undated)];
    expect([d?.projectId, d?.startDate, d?.start]).toEqual([null, today(), 'unscheduled']);
    expect([u?.projectId, u?.start]).toEqual([null, 'inbox']);
  });

  it('Delete Immediately removes the to-do and its checklist, and is not an undo step', async () => {
    const id = await repo.createTodo({ title: 'x', checklist: [{ title: 'a', completed: false }] });
    await repo.setTodoTrashed(id, true);
    await repo.deleteTodoForever(id);
    expect((await db.todos.get(id))?.deletedAt).not.toBeNull();
    expect((await db.checklistItems.toArray()).every((c) => c.deletedAt)).toBe(true);
    expect(await undo()).toBe(false); // nothing left to undo, so it cannot come back
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
