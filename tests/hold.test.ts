/**
 * Holding a task in place (v1.2.6, src/lib/model/hold.ts): a held task is
 * listed where it was, with its other fields as saved; a trashed one isn't
 * brought back.
 */
import { describe, expect, it } from 'vitest';
import { holdPlacement } from '../src/lib/model/hold';
import { inboxTodos, scheduledGroups, type Snapshot } from '../src/lib/model/lists';
import type { Todo } from '../src/lib/model/types';

const REF = '2026-11-16';

function task(over: Partial<Todo>): Todo {
  return {
    id: 't1', createdAt: '2026-11-16T10:00:00.000Z', modifiedAt: '2026-11-16T10:00:00.000Z', deletedAt: null,
    sortKey: 'a0', title: 'Book flights', notes: '', status: 'open', start: 'inbox', startDate: null,
    todaySortKey: null, deadline: null, priority: null, prioritySource: null, priorityBeforeAuto: null,
    tagIds: [], contextId: null, areaId: null, projectId: null, headingId: null, completedAt: null,
    loggedAt: null, trashedAt: null, releasedBy: null, releasedFrom: null, repeatRule: null,
    ...over,
  } as Todo;
}

const snap = (todos: Todo[]): Snapshot => ({
  areas: [], projects: [], headings: [], todos, tags: [], contexts: [], checklistItems: [], savedSearches: [],
});

describe('holdPlacement', () => {
  const before = task({});
  const after = task({ start: 'unscheduled', startDate: '2026-11-17', title: 'Book flights to Rome', priority: 3 });

  it('lists a held task where it was, with its other fields as saved', () => {
    const s = holdPlacement(snap([after]), new Map([[before.id, before]]));
    const inbox = inboxTodos(s);
    expect(inbox.map((t) => t.title)).toEqual(['Book flights to Rome']);
    expect(inbox[0].priority).toBeNull(); // priority is placement (Today's groups)
    expect(scheduledGroups(s, REF).flatMap((g) => g.todos)).toEqual([]);
  });

  it('changes nothing with nothing held, and lets a trashed task go', () => {
    const s = snap([after]);
    expect(holdPlacement(s, new Map())).toBe(s);
    const trashed = { ...after, trashedAt: '2026-11-16T11:00:00.000Z' };
    expect(inboxTodos(holdPlacement(snap([trashed]), new Map([[before.id, before]])))).toEqual([]);
  });
});
