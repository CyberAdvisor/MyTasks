/**
 * Archive (FR-12.11; v1.4.2): which completed items are picked, the CSV
 * file (which imports back to the same items), and the final removal.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/lib/db/database';
import * as repo from '../src/lib/db/repo';
import { canUndo, clearUndo } from '../src/lib/db/history';
import { archiveCounts, archiveCsv, archiveCutoff, longDate, selectArchive } from '../src/lib/archive';
import { parseCsv } from '../src/lib/import/csv';
import { readRows } from '../src/lib/import/rows';

/** Completed items from 2026-01-10 and 2026-11-01, and open ones, seeded through import. */
const SEED = [
  'type,id,parent_id,title,area,project,heading,tags,status,completed_date,repeat,repeat_unit,notes',
  'area,a,,Home,,,,,,,,,',
  'project,old,a,Old project,,,,Errand/Shop,completed,2026-01-10,,,Its notes',
  'heading,h,old,Phase one,,,,,,,,,',
  'task,t1,h,Inside old,,,,,completed,2026-01-10,,,',
  'checklist,,t1,A step,,,,,,,,,',
  'project,live,a,Live project,,,,,,,,,',
  'heading,h2,live,Doing,,,,,,,,,',
  'task,t2,h2,Old task in live project,,,,,completed,2026-01-05,,,"line one\nline, two"',
  'task,t3,h2,Recent task,,,,,completed,2026-11-01,,,',
  'task,t4,h2,Open task,,,,,,,,,',
  'task,t5,a,Canceled long ago,,,,,canceled,2025-12-01,,,',
  'task,t6,,Repeats,,,,,,,regularly,week,',
].join('\n');

const live = () => repo.importExisting();
const titles = (rows: { title: string }[]) => rows.map((r) => r.title).sort();

beforeEach(async () => {
  await db.delete();
  await db.open();
  clearUndo();
  await repo.importRows(readRows(parseCsv(SEED)));
});

describe('picking items', () => {
  it('takes closed items finished before the cutoff, a closed project with all of its contents', async () => {
    const sel = selectArchive(await live(), '2026-08-21');
    expect(titles(sel.projects)).toEqual(['Old project']);
    expect(titles(sel.headings)).toEqual(['Phase one']);
    expect(titles(sel.todos)).toEqual(['Canceled long ago', 'Inside old', 'Old task in live project']);
    expect(titles(sel.checklistItems)).toEqual(['A step']);
    expect(archiveCounts(sel)).toBe('3 tasks and 1 project');
  });

  it('leaves open items, recent ones, repeating tasks, and items in the Trash', async () => {
    const before = selectArchive(await live(), '2026-08-21');
    await repo.setTodoTrashed(before.todos.find((t) => t.title === 'Canceled long ago')!.id, true);
    const sel = selectArchive(await live(), '2026-08-21');
    expect(titles(sel.todos)).not.toContain('Canceled long ago');
    expect(titles(sel.todos)).not.toContain('Recent task');
    expect(titles(sel.todos)).not.toContain('Open task');
    expect(sel.todos.some((t) => t.repeat)).toBe(false);
  });

  it('counts days back from today: 90 days before Nov 19 is Aug 21', () => {
    expect(archiveCutoff('2026-11-19', 90)).toBe('2026-08-21');
    expect(longDate('2026-08-21')).toBe('Aug 21, 2026');
  });
});

describe('the file', () => {
  it('is in the import format and imports back to the same items, in their places', async () => {
    const existing = await live();
    const sel = selectArchive(existing, '2026-08-21');
    const csv = archiveCsv(sel, existing);
    await repo.archiveItems(sel);

    await repo.importRows(readRows(parseCsv(csv)));
    const back = await live();
    const project = back.projects.find((p) => p.title === 'Old project')!;
    expect(project.status).toBe('completed');
    expect(project.notes).toBe('Its notes');
    expect(project.areaId).toBe(back.areas.find((a) => a.title === 'Home')!.id);
    const tag = back.tags.find((t) => t.id === project.tagIds[0])!;
    expect([tag.title, back.tags.find((t) => t.id === tag.parentTagId)?.title]).toEqual(['Shop', 'Errand']);
    const inside = back.todos.find((t) => t.title === 'Inside old')!;
    expect(inside.projectId).toBe(project.id);
    expect(back.headings.find((h) => h.id === inside.headingId)?.title).toBe('Phase one');
    expect(back.checklistItems.filter((c) => c.todoId === inside.id).map((c) => c.title)).toEqual(['A step']);
    const moved = back.todos.find((t) => t.title === 'Old task in live project')!;
    expect(back.projects.find((p) => p.id === moved.projectId)?.title).toBe('Live project');
    expect(moved.notes).toBe('line one\nline, two');
    expect(moved.loggedAt).not.toBeNull();
    // Live project and its heading were matched by name, not duplicated.
    expect(back.projects.filter((p) => p.title === 'Live project').length).toBe(1);
  });
});

describe('removing', () => {
  it('removes the items for good, everywhere, and clears undo', async () => {
    await repo.renameArea((await live()).areas[0].id, 'Home'); // an undoable change before
    expect(canUndo()).toBe(true);
    const sel = selectArchive(await live(), '2026-08-21');
    expect(await repo.archiveItems(sel)).toBe(3);
    const after = await live();
    expect(after.todos.map((t) => t.title)).not.toContain('Inside old');
    expect(titles(after.todos)).toContain('Recent task');
    expect(after.projects.map((p) => p.title)).toEqual(['Live project']);
    expect((await db.todos.toArray()).filter((t) => t.deletedAt).length).toBe(3);
    expect(canUndo()).toBe(false);
  });

  it('leaves an item changed since it was picked', async () => {
    const sel = selectArchive(await live(), '2026-08-21');
    const t = sel.todos.find((x) => x.title === 'Canceled long ago')!;
    await db.todos.update(t.id, { modifiedAt: new Date(Date.now() + 1000).toISOString() });
    expect(await repo.archiveItems(sel)).toBe(2);
    expect((await live()).todos.some((x) => x.id === t.id)).toBe(true);
  });
});
