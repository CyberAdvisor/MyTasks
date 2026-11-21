/**
 * A dated task or project is never Deferred (v1.5.3): a date makes it
 * scheduled, as choosing one in the When picker does. Records that break the
 * rule (from an older version, a backup or another device) are corrected at
 * launch, and a backup's as it is read. Import's side is in import.test.ts.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/lib/db/database';
import * as repo from '../src/lib/db/repo';
import { clearUndo } from '../src/lib/db/history';
import { addDays, today } from '../src/lib/model/dates';
import { datedOutOfDeferred, inDeferred, inScheduled } from '../src/lib/model/lists';
import { buildBackup, readBackup } from '../src/lib/backup';

beforeEach(async () => {
  await db.delete();
  await db.open();
  clearUndo();
});

const later = () => addDays(today(), 30);

describe('a dated task is never Deferred', () => {
  it('says what to correct, and only that', () => {
    expect(datedOutOfDeferred({ start: 'deferred', startDate: '2026-12-18' })).toEqual({ start: 'unscheduled' });
    expect(datedOutOfDeferred({ start: 'deferred', startDate: null })).toBeNull();
    expect(datedOutOfDeferred({ start: 'unscheduled', startDate: '2026-12-18' })).toBeNull();
  });

  it('moves such tasks and projects to Scheduled at launch, as a change that syncs', async () => {
    const task = await repo.createTodo({ title: 'Book a table', deferred: true });
    const plain = await repo.createTodo({ title: 'Someday', deferred: true });
    const project = await repo.createProject({ title: 'Trip' });
    // As an older version or another device could have left them.
    await db.todos.update(task, { startDate: later(), modifiedAt: '2026-01-01T00:00:00.000Z' });
    await db.projects.update(project, { start: 'deferred', startDate: later(), modifiedAt: '2026-01-01T00:00:00.000Z' });

    await repo.sweepRules();
    const t = (await db.todos.get(task))!;
    expect([t.start, t.startDate]).toEqual(['unscheduled', later()]);
    expect(inScheduled(t, today()) && !inDeferred(t)).toBe(true);
    expect(t.modifiedAt > '2026-01-01T00:00:00.000Z').toBe(true);
    expect((await db.projects.get(project))!.start).toBe('unscheduled');
    expect(inDeferred((await db.todos.get(plain))!)).toBe(true);
  });

  it('corrects them as a backup is read for Restore', async () => {
    const task = await repo.createTodo({ title: 'Book a table', deferred: true });
    await db.todos.update(task, { startDate: later() });
    const read = readBackup(await buildBackup()).list.tables.todos.find((r) => r.id === task) as unknown as { start: string; startDate: string };
    expect([read.start, read.startDate]).toEqual(['unscheduled', later()]);
  });
});
