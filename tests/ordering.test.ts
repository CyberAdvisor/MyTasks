/**
 * Placing items after a drag or keyboard move, and the drop calculation (FR-10).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/lib/db/database';
import * as repo from '../src/lib/db/repo';
import { clearUndo } from '../src/lib/db/history';
import { today } from '../src/lib/model/dates';
import { bySortKey, placementKeys } from '../src/lib/model/order';
import { projectSections, todayTodos } from '../src/lib/model/lists';
import { snap } from './helpers';

const reset = async () => {
  await db.delete();
  await db.open();
  clearUndo();
};

const ids = <T extends { id: string; sortKey: string }>(rows: T[]) => bySortKey(rows).map((r) => r.id);

describe('placement keys', () => {
  const keys: Record<string, string | null> = { a: 'a0', b: 'a1', c: 'a2' };
  const keyOf = (id: string) => keys[id] ?? null;

  it('gives only the moved item a key between its new neighbours', () => {
    const m = placementKeys(['a', 'c', 'b'], 'c', keyOf);
    expect([...m.keys()]).toEqual(['c']);
    expect(m.get('c')! > 'a0' && m.get('c')! < 'a1').toBe(true);
  });

  it('handles the first and last positions', () => {
    expect(placementKeys(['c', 'a', 'b'], 'c', keyOf).get('c')! < 'a0').toBe(true);
    expect(placementKeys(['b', 'c', 'a'], 'a', keyOf).get('a')! > 'a2').toBe(true);
  });

  it('rekeys every item when neighbours share a key or have none', () => {
    const dup = (id: string) => (id === 'x' ? null : 'a0');
    const m = placementKeys(['p', 'x', 'q'], 'x', dup);
    expect([...m.keys()]).toEqual(['p', 'x', 'q']);
    const [p, x, q] = ['p', 'x', 'q'].map((k) => m.get(k)!);
    expect(p < x && x < q).toBe(true);
  });

  it('returns nothing when the item is not in the order', () => {
    expect(placementKeys(['a', 'b'], 'z', keyOf).size).toBe(0);
  });
});

describe('placing records', () => {
  beforeEach(reset);

  it('reorders tasks and moves them between headings (FR-10.3, FR-10.6)', async () => {
    const p = await repo.createProject({ title: 'P' });
    const h = await repo.createHeading(p, 'H');
    const a = await repo.createTodo({ projectId: p, title: 'a' });
    const b = await repo.createTodo({ projectId: p, title: 'b' });
    const c = await repo.createTodo({ projectId: p, headingId: h, title: 'c' });

    await repo.placeTodo(b, { order: [b, a], headingId: null });
    let sec = projectSections(await snap(), p);
    expect(sec.loose.map((t) => t.id)).toEqual([b, a]);

    // Under the heading, above its first to-do.
    await repo.placeTodo(a, { order: [a, c], headingId: h });
    sec = projectSections(await snap(), p);
    expect(sec.loose.map((t) => t.id)).toEqual([b]);
    expect(sec.headings[0].todos.map((t) => t.id)).toEqual([a, c]);

    // Back above the first heading removes it from any heading.
    await repo.placeTodo(c, { order: [b, c], headingId: null });
    sec = projectSections(await snap(), p);
    expect(sec.loose.map((t) => t.id)).toEqual([b, c]);
  });

  it('reorders Today by its own key, leaving project order alone', async () => {
    const p = await repo.createProject({ title: 'P' });
    const a = await repo.createTodo({ projectId: p, startDate: today(), title: 'a' });
    const b = await repo.createTodo({ projectId: p, startDate: today(), title: 'b' });
    const c = await repo.createTodo({ startDate: today(), title: 'c' });
    const before = ids((await snap()).todos.filter((t) => t.projectId === p));

    await repo.placeTodo(c, { order: [c, a, b], field: 'todaySortKey' });
    const s = await snap();
    expect(todayTodos(s, today()).map((t) => t.id)).toEqual([c, a, b]);
    expect(ids(s.todos.filter((t) => t.projectId === p))).toEqual(before);
  });

  it('reorders headings, areas and saved searches (FR-10.7, FR-10.8, FR-15.5)', async () => {
    const p = await repo.createProject();
    const h1 = await repo.createHeading(p, 'one');
    const h2 = await repo.createHeading(p, 'two');
    await repo.placeHeading(h2, [h2, h1]);
    expect(ids((await snap()).headings)).toEqual([h2, h1]);

    const a1 = await repo.createArea('A1');
    const a2 = await repo.createArea('A2');
    await repo.placeArea(a2, [a2, a1]);
    expect(ids((await snap()).areas)).toEqual([a2, a1]);

    const s1 = await repo.createSavedSearch({ title: 's1', query: 'x', tagIds: [] });
    const s2 = await repo.createSavedSearch({ title: 's2', query: 'y', tagIds: [] });
    await repo.placeSavedSearch(s1, [s2, s1]);
    expect(ids((await snap()).savedSearches)).toEqual([s2, s1]);
  });

  it('moves a project to another area or out of any area (FR-10.9)', async () => {
    const area1 = await repo.createArea('One');
    const area2 = await repo.createArea('Two');
    const p = await repo.createProject({ areaId: area1, title: 'P' });
    const q = await repo.createProject({ areaId: area2, title: 'Q' });
    const t = await repo.createTodo({ projectId: p, title: 't' });

    await repo.placeProject(p, { order: [p, q], areaId: area2 });
    let s = await snap();
    expect(s.projects.find((x) => x.id === p)?.areaId).toBe(area2);
    expect(ids(s.projects.filter((x) => x.areaId === area2))).toEqual([p, q]);
    expect(s.todos.find((x) => x.id === t)?.projectId).toBe(p);

    await repo.placeProject(p, { order: [p], areaId: null });
    s = await snap();
    expect(s.projects.find((x) => x.id === p)?.areaId).toBeNull();
  });
});

describe('drop calculation', async () => {
  const { insertionIndex, orderWith, orderWithAll, sameOrder, shiftedOrder } = await import('../src/lib/drag/plan');
  const rows = [
    { top: 0, bottom: 30 },
    { top: 30, bottom: 60 },
    { top: 60, bottom: 90 },
  ];

  it('drops before the first row whose middle is below the pointer', () => {
    expect(insertionIndex(rows, 5)).toBe(0);
    expect(insertionIndex(rows, 20)).toBe(1);
    expect(insertionIndex(rows, 70)).toBe(2);
    expect(insertionIndex(rows, 89)).toBe(3);
    expect(insertionIndex([], 10)).toBe(0);
  });

  it('builds the order after a drop', () => {
    expect(orderWith(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b']);
    expect(orderWith(['a', 'b'], 'x', 1)).toEqual(['a', 'x', 'b']);
    expect(orderWith(['a', 'b'], 'x', 9)).toEqual(['a', 'b', 'x']);
    // Several selected tasks land together, in the order given (FR-10.3b).
    expect(orderWithAll(['a', 'b', 'c', 'd'], ['d', 'a'], 1)).toEqual(['b', 'd', 'a', 'c']);
    expect(orderWithAll(['a', 'b'], ['x', 'y'], 0)).toEqual(['x', 'y', 'a', 'b']);
    expect(sameOrder(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameOrder(['a', 'b'], ['b', 'a'])).toBe(false);
  });

  it('moves one place up or down, not past the ends', () => {
    expect(shiftedOrder(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(shiftedOrder(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b']);
    expect(shiftedOrder(['a', 'b'], 'a', -1)).toBeNull();
    expect(shiftedOrder(['a', 'b'], 'b', 1)).toBeNull();
  });
});

describe('dropping a task onto a project or area (FR-10.11)', async () => {
  const { dropTarget, targetAt } = await import('../src/lib/drag/drag');

  /** A sidebar-like link that takes to-dos except `refused`. */
  function link(refused: string) {
    const a = document.createElement('a');
    const label = document.createElement('span');
    a.append(label);
    document.body.append(a);
    const drop = vi.fn();
    dropTarget(a, { type: 'todo', accepts: (id) => id !== refused, drop });
    return { a, label, drop };
  }

  it('finds the target under the pointer, from any element inside it', () => {
    const { a, label } = link('x');
    expect(targetAt(label, 'todo', ['t1'])).toBe(a);
    expect(targetAt(a, 'todo', ['t1'])).toBe(a);
  });

  it('ignores other drag types, tasks already there, and plain elements', () => {
    const { label } = link('t1');
    expect(targetAt(label, 'project', ['t2'])).toBeNull();
    expect(targetAt(label, 'todo', ['t1'])).toBeNull();
    expect(targetAt(document.body, 'todo', ['t2'])).toBeNull();
  });

  it('takes several tasks when it accepts at least one of them (FR-10.3b)', () => {
    const { a, label } = link('t1');
    expect(targetAt(label, 'todo', ['t1', 't2'])).toBe(a);
    expect(targetAt(label, 'todo', ['t1'])).toBeNull();
  });
});

describe('dropping tasks onto a sidebar list (FR-10.3b)', () => {
  beforeEach(reset);

  it('offers a list only where the task is not already, never Logbook, and only Trash for a repeating task', async () => {
    const { takesDrop } = await import('../src/lib/model/lists');
    const { todo } = await import('./helpers');
    const ref = today();
    const none = new Map();
    const inbox = todo({ start: 'inbox' });
    const inToday = todo({ startDate: ref });
    const later = todo({ startDate: '2999-01-01' });
    const deferred = todo({ start: 'deferred' });
    const anytime = todo();
    const repeating = todo({ repeat: {} as never });
    const done = todo({ status: 'completed' });
    const offered = (t: ReturnType<typeof todo>) =>
      (['inbox', 'today', 'scheduled', 'unscheduled', 'deferred', 'logbook', 'trash'] as const).filter((l) => takesDrop(l, t, none, ref));
    expect(offered(inbox)).toEqual(['today', 'scheduled', 'unscheduled', 'deferred', 'trash']);
    expect(offered(inToday)).toEqual(['inbox', 'scheduled', 'unscheduled', 'deferred', 'trash']);
    expect(offered(later)).toEqual(['inbox', 'today', 'scheduled', 'unscheduled', 'deferred', 'trash']);
    expect(offered(deferred)).toEqual(['inbox', 'today', 'scheduled', 'unscheduled', 'trash']);
    expect(offered(anytime)).toEqual(['inbox', 'today', 'scheduled', 'deferred', 'trash']);
    expect(offered(repeating)).toEqual(['trash']);
    expect(offered(done)).toEqual(['trash']);
  });

  it('Inbox takes a task out of its project and clears its start date, as one undo step', async () => {
    const bulk = await import('../src/lib/bulk');
    const { undo } = await import('../src/lib/db/history');
    const p = await repo.createProject({ title: 'P' });
    const a = await repo.createTodo({ projectId: p, title: 'a' });
    const b = await repo.createTodo({ projectId: p, title: 'b' });
    await repo.setWhen(a, { kind: 'today' });
    await repo.setWhen(b, { kind: 'deferred' });
    clearUndo();

    await bulk.toInbox([a, b]);
    for (const id of [a, b]) {
      const t = (await db.todos.get(id))!;
      expect([t.projectId, t.start, t.startDate]).toEqual([null, 'inbox', null]);
    }
    await undo();
    expect((await db.todos.get(a))!.projectId).toBe(p);
    expect((await db.todos.get(b))!.start).toBe('deferred');
  });

  it('places several dragged tasks together where they were dropped', async () => {
    const p = await repo.createProject({ title: 'P' });
    const t: string[] = [];
    for (const title of ['a', 'b', 'c', 'd']) t.push(await repo.createTodo({ projectId: p, title }));
    // d and a dragged together between b and c, each placed in turn as the drag does.
    const order = [t[1], t[3], t[0], t[2]];
    for (const id of [t[3], t[0]]) await repo.placeTodo(id, { order });
    expect(projectSections(await snap(), p).loose.map((x) => x.title)).toEqual(['b', 'd', 'a', 'c']);
  });
});
