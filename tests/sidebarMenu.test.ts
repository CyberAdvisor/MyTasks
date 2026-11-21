/** Tests for the sidebar's right-click menus and the commands they share with the ⋯ menus. */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/lib/db/database';
import * as repo from '../src/lib/db/repo';
import { clearUndo } from '../src/lib/db/history';
import { openTaskCount } from '../src/lib/model/lists';
import { sidebarMenuItems, type SidebarMenuItem } from '../src/lib/model/sidebarMenu';
import { snap } from './helpers';

beforeEach(async () => {
  await db.delete();
  await db.open();
  clearUndo();
});

/** The menu as text: labels, "(off)" when disabled, "!" when red, "✓" when checked, "—" for separators. */
const text = (items: SidebarMenuItem[]) =>
  items.map((i) =>
    i.kind === 'separator' ? '—' : `${i.label}${i.disabled ? ' (off)' : ''}${i.danger ? ' !' : ''}${i.checked ? ' ✓' : ''}`,
  );

describe('sidebarMenuItems', () => {
  it('gives an open project its ⋯ menu commands', () => {
    expect(text(sidebarMenuItems({ kind: 'project', id: 'p' }, { status: 'open', waiting: true }))).toEqual([
      'Complete Project',
      'Start Date…',
      'Add Tags…',
      'Add Deadline…',
      'Repeat…',
      '—',
      'Move…',
      'Duplicate Project',
      'Sort by Date',
      'Move Completed Items',
      'Print…',
      '—',
      'Delete Project !',
    ]);
  });

  it('checks Sort by Date when the project sorts by date (FR-2.8)', () => {
    expect(text(sidebarMenuItems({ kind: 'project', id: 'p' }, { status: 'open', sortByDate: true }))).toContain('Sort by Date ✓');
  });

  it('offers Reopen, Edit Tags and Change Deadline when they apply', () => {
    const labels = text(
      sidebarMenuItems({ kind: 'project', id: 'p' }, { status: 'completed', hasTags: true, hasDeadline: true }),
    );
    expect(labels.slice(0, 4)).toEqual(['Reopen Project', 'Start Date…', 'Edit Tags…', 'Change Deadline…']);
    expect(labels).toContain('Move Completed Items (off)');
  });

  it('gives an area Tags, New Project, Focus, Move Completed Items, Print and Delete Area', () => {
    expect(text(sidebarMenuItems({ kind: 'area', id: 'a' }))).toEqual([
      'Add Tags…',
      'New Project',
      'Focus on this Area',
      'Move Completed Items (off)',
      'Print…',
      '—',
      'Delete Area… !',
    ]);
    // The focused area offers the way out (FR-22.1).
    expect(text(sidebarMenuItems({ kind: 'area', id: 'a' }, { focused: true }))[2]).toBe('Leave Focus');
  });

  it('gives a saved search Edit Search, Print and Delete', () => {
    expect(text(sidebarMenuItems({ kind: 'saved', id: 's' }))).toEqual(['Edit Search…', 'Print…', '—', 'Delete… !']);
  });
});

describe('openTaskCount', () => {
  it("counts a project's open tasks, under headings or not", async () => {
    const projectId = await repo.createProject({ title: 'P' });
    const headingId = await repo.createHeading(projectId, 'H');
    await repo.createTodo({ projectId, title: 'loose' });
    await repo.createTodo({ projectId, headingId, title: 'under heading' });
    const done = await repo.createTodo({ projectId, title: 'done' });
    await repo.setTodoStatus(done, 'completed');
    expect(openTaskCount(await snap(), projectId)).toBe(2);
  });
});
