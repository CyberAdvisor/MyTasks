/**
 * Scheduled's order (FR-21.7): by date, then on each date by priority, P1 first
 * and tasks with no priority last, then in their own order.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/lib/db/database';
import * as repo from '../src/lib/db/repo';
import { addDays, today } from '../src/lib/model/dates';
import { scheduledGroups } from '../src/lib/model/lists';
import type { Priority } from '../src/lib/model/types';
import { snap } from './helpers';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

/** A task on `days` from today, with `priority` set by hand. */
async function on(title: string, days: number, priority: Priority | null): Promise<void> {
  const id = await repo.createTodo({ title });
  await repo.setWhen(id, { kind: 'date', date: addDays(today(), days) });
  if (priority !== null) await repo.setPriority(id, priority);
}

describe('Scheduled order', () => {
  it('goes by priority on each date, no priority last, ties in their own order', async () => {
    await on('None first', 2, null);
    await on('P3', 2, 3);
    await on('P1', 2, 1);
    await on('None second', 2, null);
    await on('P3 later', 2, 3);
    await on('Tomorrow P5', 1, 5);
    const titles = scheduledGroups(await snap(), today()).flatMap((g) => g.todos.map((t) => t.title));
    expect(titles).toEqual(['Tomorrow P5', 'P1', 'P3', 'P3 later', 'None first', 'None second']);
  });

  it('keeps dates first in a group of several dates', async () => {
    await on('Day 40, P1', 40, 1);
    await on('Day 35, none', 35, null);
    const later = scheduledGroups(await snap(), today()).flatMap((g) => g.todos.map((t) => t.title));
    expect(later).toEqual(['Day 35, none', 'Day 40, P1']);
  });
});
