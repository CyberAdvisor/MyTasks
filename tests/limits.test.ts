/**
 * The task limit (NFR-7, conversation 2026-11-17-C): 5,000 tasks that aren't
 * deleted, counting Completed and the Trash. Adding past it is refused, all or
 * nothing; a repeating task's next copy is not; the sidebar warns from 4,500.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/lib/db/database';
import * as repo from '../src/lib/db/repo';
import * as bulk from '../src/lib/bulk';
import { clearUndo } from '../src/lib/db/history';
import { today, weekday } from '../src/lib/model/dates';
import { MAX_TASKS, TaskLimitError, WARN_FILE_CHARS, WARN_TASKS, hasRoom, limitRefusal, limitWarning, nearLimit, roomWarning } from '../src/lib/model/limits';
import { todo } from './helpers';
import { seed } from '../perf/seed';
import { SCHEMA_VERSION } from '../src/lib/db/database';
import { toSeconds } from '../src/lib/model/parts';
import { MAX_FILE_CHARS } from '../src/lib/sync/crypto';

beforeEach(async () => {
  await db.delete();
  await db.open();
  clearUndo();
});

/** Fill the list to `count` tasks: half open, then completed, trashed and deleted ones (which don't count). */
async function fill(count: number): Promise<void> {
  const rows = Array.from({ length: count }, (_, i) =>
    todo({
      sortKey: `a${i}`,
      ...(i % 3 === 1 ? { status: 'completed' as const, completedAt: 'x', loggedAt: 'x' } : {}),
      ...(i % 3 === 2 ? { trashedAt: 'x' } : {}),
    }),
  );
  await db.todos.bulkAdd([...rows, todo({ deletedAt: '2026-01-01T00:00:00.000Z' })]);
}

/** The error a promise rejects with, or null. */
async function refusal(p: Promise<unknown>): Promise<TaskLimitError | null> {
  try {
    await p;
    return null;
  } catch (e) {
    if (e instanceof TaskLimitError) return e;
    throw e;
  }
}

describe('counting and wording', () => {
  it('has room up to the limit, warns from 4,500, and always allows changes that add nothing', () => {
    expect(hasRoom(MAX_TASKS - 1)).toBe(true);
    expect(hasRoom(MAX_TASKS)).toBe(false);
    expect(hasRoom(MAX_TASKS - 2, 3)).toBe(false);
    expect(hasRoom(MAX_TASKS + 10, 0)).toBe(true); // over by sync: converting a task with one item still works
    expect(nearLimit(WARN_TASKS - 1)).toBe(false);
    expect(nearLimit(WARN_TASKS)).toBe(true);
    expect(limitWarning(4612)).toBe('4,612 of 5,000 tasks.');
    expect(limitRefusal(5000, 1)).toMatch(/^Another task would take you past 5,000.*you have 5,000\)\. Empty the Trash/);
    expect(limitRefusal(4999, 3)).toMatch(/^3 more tasks would/);
  });

  it('warns from 4,500 tasks or 4.5 MB, whichever comes first (v1.11.6)', () => {
    const mb = 1024 * 1024;
    expect(WARN_FILE_CHARS).toBe(Math.floor(4.5 * mb));
    expect(roomWarning(4499, undefined)).toBeNull(); // before a first sync, no size
    expect(roomWarning(4499, WARN_FILE_CHARS - 1)).toBeNull();
    expect(roomWarning(4612, 1 * mb)).toBe('4,612 of 5,000 tasks.');
    expect(roomWarning(1200, 4.6 * mb)).toBe('Your gist is 4.6 MB of 5 MB.');
    expect(roomWarning(4612, 4.6 * mb)).toBe('4,612 of 5,000 tasks · 4.6 MB of 5 MB.');
  });

  it('counts every task not deleted: open, completed and trashed', async () => {
    await fill(10);
    expect(await repo.taskCount()).toBe(10);
  });
});

describe('adding at the limit', () => {
  it('refuses a new task, a duplicate, a duplicated project and a selection duplicated together, changing nothing', async () => {
    await fill(MAX_TASKS - 2);
    const projectId = await repo.createProject({ title: 'P' });
    const a = await repo.createTodo({ title: 'a', projectId }); // 4,999
    const b = await repo.createTodo({ title: 'b', projectId }); // 5,000

    expect(await refusal(repo.createTodo({ title: 'c' }))).toMatchObject({ count: MAX_TASKS, adding: 1 });
    expect(await refusal(repo.duplicateTodo(a))).toMatchObject({ adding: 1 });
    expect(await refusal(repo.duplicateProject(projectId))).toMatchObject({ adding: 2 });
    expect(await refusal(bulk.duplicate([a, b]))).toMatchObject({ adding: 2 });
    expect(await repo.taskCount()).toBe(MAX_TASKS);
    expect(await db.projects.count()).toBe(1);
  });

  it('duplicates a selection only when all of it fits', async () => {
    await fill(MAX_TASKS - 3);
    const a = await repo.createTodo({ title: 'a' });
    const b = await repo.createTodo({ title: 'b' }); // 4,999
    expect(await refusal(bulk.duplicate([a, b]))).toMatchObject({ count: MAX_TASKS - 1, adding: 2 });
    expect(await repo.taskCount()).toBe(MAX_TASKS - 1);
    expect(await bulk.duplicate([a])).toHaveLength(1);
  });

  it('converts a task to a project when its checklist items fit, counting the task itself as freed', async () => {
    await fill(MAX_TASKS - 1);
    const id = await repo.createTodo({ title: 'Trip' }); // 5,000
    await repo.addChecklistItems(id, ['one']);
    expect(await repo.convertTodoToProject(id)).toBeDefined(); // one item replaces the task: still 5,000
    const other = await repo.createTodo({ title: 'x' }).catch((e) => e);
    expect(other).toBeInstanceOf(TaskLimitError);
  });

  it('still makes a repeating task’s copy at the limit, so a repeat never stops', async () => {
    await fill(MAX_TASKS - 1);
    const id = await repo.createTodo({ title: 'Water plants' }); // 5,000
    await repo.setRepeat(
      id,
      { mode: 'fixed', unit: 'week', interval: 1, weekdays: [weekday(today())], days: [], month: null, endCount: null, endDate: null, made: 0, deadlineDays: null, paused: false },
      today(),
    );
    expect((await db.todos.toArray()).filter((t) => t.repeatOf === id)).toHaveLength(1);
    expect(await repo.taskCount()).toBe(MAX_TASKS + 1);
  });
});

describe('room in the gist file with part times (FR-19.10)', () => {
  it('still fits 5,000 typical tasks, each with four parts changed, under 5 MB', () => {
    const s = seed(4000, 1000);
    const now = toSeconds(new Date().toISOString());
    // The worst ordinary case: every task with four parts changed at different times.
    const todos = s.todos.map((t, i) => ({ ...t, ft: { s: now - i, t: now - 2 * i, d: now - 3 * i, p: now - 4 * i } }));
    const rest = (rows: object[]) => rows.map((r) => ({ ...r, ft: {} }));
    const list = {
      app: 'mytasks',
      schema: SCHEMA_VERSION,
      tables: { areas: rest(s.areas), projects: rest(s.projects), headings: [], todos, checklistItems: rest(s.checklistItems), tags: rest(s.tags), contexts: rest(s.contexts), savedSearches: [] },
      settings: [],
    };
    // Encrypted, the list is base64: four characters for every three bytes, plus a small envelope.
    const fileChars = Math.ceil((new TextEncoder().encode(JSON.stringify(list)).length * 4) / 3) + 400;
    expect(todos.length).toBe(MAX_TASKS);
    expect(fileChars).toBeLessThan(MAX_FILE_CHARS);
  });
});
