/**
 * Ticks in Apple Reminders complete tasks (FR-21.11): the helper's
 * ticks.json, read and checked, and the tasks it completes. The fixture
 * helper/testdata/ticks-envelope.json was written by helper/calendar_sync.py,
 * whose own tests check it still writes that file byte for byte.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../helper/testdata/ticks-envelope.json?raw';
import { db } from '../src/lib/db/database';
import * as repo from '../src/lib/db/repo';
import { clearUndo, undo } from '../src/lib/db/history';
import { addDays, today } from '../src/lib/model/dates';
import { copyId } from '../src/lib/model/repeat';
import type { RepeatRule } from '../src/lib/model/types';
import { KDF_ITERATIONS, deriveKey, parseEnvelope, seal, unseal } from '../src/lib/sync/crypto';
import { onTicked, readTicks, receiveTicks, tickedMessage } from '../src/lib/reminders/ticks';

/** The template id in the fixture, and its copy for 2026-11-27 (also checked in helper/test_reminders.py). */
const TEMPLATE = '0193a4b2-7c11-7000-8000-000000000001';
const COPY = '6f55af28-0313-854e-b4ba-7a14201cb326';

const row = async (id: string) => (await db.todos.get(id))!;
/** A time a minute ago: ticked in Reminders before anything happens here. */
const ago = (minutes = 1) => new Date(Date.now() - minutes * 60_000).toISOString();
const daily = (over: Partial<RepeatRule> = {}): RepeatRule => ({
  mode: 'fixed', unit: 'day', interval: 1, weekdays: [], days: [], month: null,
  endCount: null, endDate: null, made: 0, deadlineDays: null, paused: false, ...over,
});

beforeEach(async () => {
  await db.delete();
  await db.open();
  clearUndo();
});

afterEach(() => vi.useRealTimers());

describe('ticks.json from the helper', () => {
  it('opens with the gist passphrase as the ticks file, never as the tasks or the calendar', async () => {
    const env = parseEnvelope(fixture, 'mytasks-ticks')!;
    expect(env).not.toBeNull();
    expect(parseEnvelope(fixture)).toBeNull();
    expect(parseEnvelope(fixture, 'mytasks-calendar')).toBeNull();
    const ticks = readTicks(JSON.parse(await unseal(await deriveKey('correct horse battery staple', env.kdf.salt), env)));
    expect(ticks).toEqual([
      { task: 't1', at: '2026-11-25T17:05:00.000Z' },
      { task: TEMPLATE, at: '2026-11-25T17:06:00.000Z', day: '2026-11-27' },
    ]);
    expect(copyId(TEMPLATE, '2026-11-27')).toBe(COPY); // the helper works out the same copy
  });

  it('keeps only entries that pass the checks', () => {
    const good = { task: 't1', at: '2026-11-25T17:05:00.000Z' };
    expect(readTicks({ format: 1, ticks: [good, { ...good, at: '2026-11-25 17:05' }, { ...good, task: '' }, { ...good, day: '2026-02-30' }, null] })).toEqual([good]);
    expect(readTicks({ format: 2, ticks: [good] })).toEqual([]);
    expect(readTicks(null)).toEqual([]);
  });

  it('says what was completed', () => {
    expect(tickedMessage(['Call Sam'])).toBe('Completed in Reminders: Call Sam');
    expect(tickedMessage(['a', 'b', 'c'])).toBe('3 tasks completed in Reminders');
  });
});

describe('completing ticked tasks', () => {
  it('completes an open task at the time it was ticked, as one undo step that holds', async () => {
    const a = await repo.createTodo({ title: 'Call Sam' });
    const b = await repo.createTodo({ title: 'Pay rent' });
    const at = ago();
    expect(await repo.completeTicked([{ task: a, at }, { task: b, at }])).toEqual(['Call Sam', 'Pay rent']);
    expect(await row(a)).toMatchObject({ status: 'completed', completedAt: at });
    await undo();
    expect((await row(a)).status).toBe('open');
    expect((await row(b)).status).toBe('open');
    // The same ticks again, as at the next sync: the reopening is later, so they stay open.
    expect(await repo.completeTicked([{ task: a, at }])).toEqual([]);
    expect((await row(a)).status).toBe('open');
  });

  it('leaves closed, trashed and deleted tasks, those in a trashed project, and unknown ids alone', async () => {
    const at = ago();
    const done = await repo.createTodo({ title: 'Done' });
    await repo.setTodoStatus(done, 'canceled');
    const trashed = await repo.createTodo({ title: 'Trashed' });
    await repo.setTodoTrashed(trashed, true);
    const projectId = await repo.createProject({ title: 'Old' });
    const inside = await repo.createTodo({ title: 'Inside', projectId });
    await repo.setProjectTrashed(projectId, true);
    expect(await repo.completeTicked(['nope', done, trashed, inside].map((task) => ({ task, at })))).toEqual([]);
    expect((await row(done)).status).toBe('canceled');
    expect((await row(inside)).status).toBe('open');
  });

  it("ignores a tick made before the task was last reopened here", async () => {
    const id = await repo.createTodo({ title: 'Call Sam' });
    const at = ago(5);
    await repo.setTodoStatus(id, 'completed');
    await repo.setTodoStatus(id, 'open'); // reopened after the tick
    expect(await repo.completeTicked([{ task: id, at }])).toEqual([]);
  });

  it("completes a repeating task's copy for the day, made first when it's the next one", async () => {
    const ref = today();
    const id = await repo.createTodo({ title: 'Water plants' });
    await repo.setRepeat(id, daily(), addDays(ref, 1)); // the first copy is tomorrow's: none yet
    const tomorrow = addDays(ref, 1);
    expect(await db.todos.get(copyId(id, tomorrow))).toBeUndefined();
    const at = ago();
    // Two days on hasn't been reached; yesterday's was never made: both left.
    expect(await repo.completeTicked([{ task: id, at, day: addDays(ref, 2) }, { task: id, at, day: addDays(ref, -1) }])).toEqual([]);
    expect(await repo.completeTicked([{ task: id, at, day: tomorrow }])).toEqual(['Water plants']);
    expect(await row(copyId(id, tomorrow))).toMatchObject({ status: 'completed', completedAt: at, repeatOf: id });
    expect((await row(id)).startDate).toBe(addDays(ref, 2)); // the template moved on
    // Undo takes back the copy and the move; the tick then finds the copy deleted.
    await undo();
    expect((await row(id)).startDate).toBe(tomorrow);
    expect(await repo.completeTicked([{ task: id, at, day: tomorrow }])).toEqual([]);
  });

  it("completes a copy that's already there, today's", async () => {
    const id = await repo.createTodo({ title: 'Water plants' });
    await repo.setRepeat(id, daily(), today()); // today's copy is made at once
    expect(await repo.completeTicked([{ task: id, at: ago(), day: today() }])).toEqual(['Water plants']);
    expect((await row(copyId(id, today()))).status).toBe('completed');
    expect((await row(id)).status).toBe('open'); // the template itself is never completed by a tick
    expect(await repo.completeTicked([{ task: id, at: ago() }])).toEqual([]);
  });

  it('from the gist file, says so to the listener', async () => {
    const id = await repo.createTodo({ title: 'Call Sam' });
    const salt = 'AAAAAAAAAAAAAAAAAAAAAA==';
    const key = await deriveKey('a passphrase', salt);
    const env = await seal(key, { salt, iterations: KDF_ITERATIONS }, JSON.stringify({ format: 1, ticks: [{ task: id, at: ago() }] }), ago());
    const said: string[] = [];
    const stop = onTicked((m) => said.push(m));
    await receiveTicks({ key }, JSON.stringify({ ...env, app: 'mytasks-ticks' }));
    await receiveTicks({ key }, JSON.stringify({ ...env, app: 'mytasks-ticks' })); // read again at the next sync: nothing to do
    await receiveTicks({ key }, JSON.stringify(env)); // not a ticks file
    await receiveTicks({ key }, null);
    stop();
    expect(said).toEqual(['Completed in Reminders: Call Sam']);
    expect((await row(id)).status).toBe('completed');
  });
});
