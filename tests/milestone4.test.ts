/**
 * Tests for Milestone 4: placing items after a drag or keyboard move, undo,
 * the drop calculation and the keyboard bindings.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/lib/db/database';
import * as repo from '../src/lib/db/repo';
import { clearUndo, undo, undoGroup } from '../src/lib/db/history';
import { today } from '../src/lib/model/dates';
import { bySortKey, placementKeys } from '../src/lib/model/order';
import { projectSections, todayTodos } from '../src/lib/model/lists';
import { snap } from './helpers';

const reset = async () => {
  await db.delete();
  await db.open();
  clearUndo();
};

/** Ids of rows in their stored order. */
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

  it('reorders to-dos and moves them between headings (FR-10.3, FR-10.6)', async () => {
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

describe('undo (FR-1.6)', () => {
  beforeEach(reset);

  it('has nothing to undo at first', async () => {
    expect(await undo()).toBe(false);
  });

  it('restores a trashed to-do', async () => {
    const t = await repo.createTodo({ title: 'a' });
    await repo.setTodoTrashed(t, true);
    expect(await undo()).toBe(true);
    expect((await db.todos.get(t))?.trashedAt).toBeNull();
    expect(await undo()).toBe(false);
  });

  it('removes a record the step created', async () => {
    const t = await repo.createTodo({ title: 'a' });
    await undo();
    expect(await db.todos.get(t)).toBeUndefined();
  });

  it('undoes only the last change, with every record it touched', async () => {
    const p = await repo.createProject({ title: 'P' });
    const h = await repo.createHeading(p, 'H');
    const a = await repo.createTodo({ projectId: p, headingId: h, title: 'a' });
    await repo.deleteHeading(h);
    await undo();
    expect((await db.headings.get(h))?.deletedAt).toBeNull();
    expect((await db.todos.get(a))?.headingId).toBe(h);
    expect(await db.projects.get(p)).toBeDefined();
  });

  it('undoes a drag', async () => {
    const a = await repo.createTodo({ title: 'a' });
    const b = await repo.createTodo({ title: 'b' });
    await repo.placeTodo(b, { order: [b, a] });
    await undo();
    expect(ids((await snap()).todos)).toEqual([a, b]);
  });

  it('ignores the automatic priority sweep and settings', async () => {
    const t = await repo.createTodo({ title: 'a' });
    await repo.setTodoTrashed(t, true);
    await repo.sweepPriorities();
    await repo.setSetting('todayGrouping', 'project');
    await undo();
    expect((await db.todos.get(t))?.trashedAt).toBeNull();
  });

  it('merges a group of changes into one step', async () => {
    const a = await repo.createTodo({ title: 'a' });
    const b = await undoGroup(async () => {
      const id = await repo.createTodo({ title: 'b' });
      await repo.placeTodo(id, { order: [id, a] });
      return id;
    });
    await undo();
    expect(await db.todos.get(b)).toBeUndefined();
    expect(await db.todos.get(a)).toBeDefined();
  });

  it('logs the restore for future sync', async () => {
    const t = await repo.createTodo({ title: 'a' });
    await repo.updateTodoText(t, { title: 'b' });
    const before = await db.changeLog.count();
    await undo();
    expect((await db.todos.get(t))?.title).toBe('a');
    expect(await db.changeLog.count()).toBe(before + 1);
  });
});

describe('drop calculation', async () => {
  const { insertionIndex, orderWith, sameOrder, shiftedOrder } = await import('../src/lib/drag/plan');
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

describe('keyboard bindings (Section 7)', async () => {
  const { KeyResolver, BINDINGS, formatKeys, keysFor } = await import('../src/lib/shortcuts');
  type Ctx = Parameters<InstanceType<typeof KeyResolver>['resolve']>[1];

  /** A key event; letters and digits get their physical code. */
  const key = (k: string, mods: Partial<KeyboardEvent> = {}) => ({
    key: k,
    code: /^[a-z]$/i.test(k) ? `Key${k.toUpperCase()}` : /^\d$/.test(k) ? `Digit${k}` : k === ' ' ? 'Space' : k === '/' || k === '?' ? 'Slash' : '',
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...mods,
  });
  const app: Ctx = { focus: 'none', standalone: true, mac: true, now: 0 };
  const tab: Ctx = { ...app, standalone: false };
  const run = (e: ReturnType<typeof key>, ctx: Ctx) => new KeyResolver().resolve(e, ctx);
  const cmd = (c: string) => ({ command: c });

  it('uses the Things bindings in the installed app', () => {
    expect(run(key('n', { metaKey: true }), app)).toEqual(cmd('new-todo'));
    expect(run(key('k', { metaKey: true }), app)).toEqual(cmd('complete'));
    expect(run(key('k', { metaKey: true, altKey: true, code: 'KeyK' }), app)).toEqual(cmd('cancel'));
    expect(run(key('N', { metaKey: true, shiftKey: true }), app)).toEqual(cmd('new-heading'));
    expect(run(key('2', { metaKey: true }), app)).toEqual(cmd('go-today'));
    expect(run(key('g', { metaKey: true }), app)).toEqual(cmd('cycle-grouping'));
  });

  it('uses Ctrl for Mod away from Apple devices', () => {
    const win = { ...app, mac: false };
    expect(run(key('n', { ctrlKey: true }), win)).toEqual(cmd('new-todo'));
    expect(run(key('n', { metaKey: true }), win)).toBeNull();
  });

  it('uses the fallback keys in a browser tab', () => {
    expect(run(key('n', { metaKey: true }), tab)).toBeNull();
    expect(run(key('n'), tab)).toEqual(cmd('new-todo'));
    expect(run(key('x'), tab)).toEqual(cmd('complete'));
    expect(run(key('X', { shiftKey: true }), tab)).toEqual(cmd('cancel'));
    expect(run(key('#', { shiftKey: true }), tab)).toEqual(cmd('tags'));
    // Opt+H types a character on a Mac; the physical key still counts.
    expect(run(key('˙', { altKey: true, code: 'KeyH' }), tab)).toEqual(cmd('new-heading'));
  });

  it('keeps Quick Entry on Ctrl+Space and Cmd+Shift+Space, freeing Cmd+Shift+N', () => {
    expect(run(key(' ', { ctrlKey: true }), { ...app, focus: 'text' })).toEqual(cmd('quick-entry'));
    expect(run(key(' ', { metaKey: true, shiftKey: true }), tab)).toEqual(cmd('quick-entry'));
  });

  it('runs "G then letter" sequences in a tab', () => {
    const r = new KeyResolver();
    expect(r.resolve(key('g'), { ...tab, now: 0 })).toEqual({ pending: true });
    expect(r.resolve(key('i'), { ...tab, now: 500 })).toEqual(cmd('go-inbox'));
    expect(r.resolve(key('g'), { ...tab, now: 1000 })).toEqual({ pending: true });
    expect(r.resolve(key('g'), { ...tab, now: 1200 })).toEqual(cmd('cycle-grouping'));
    // Too slow: the second key is read on its own (T is Today for the selection).
    expect(r.resolve(key('g'), { ...tab, now: 3000 })).toEqual({ pending: true });
    expect(r.resolve(key('t'), { ...tab, now: 9000 })).toEqual(cmd('today'));
  });

  it('reads the key after G as part of the sequence, even when it is a command itself', () => {
    const pairs: [string, string][] = [
      ['i', 'go-inbox'],
      ['t', 'go-today'],
      ['s', 'go-scheduled'],
      ['u', 'go-unscheduled'],
      ['d', 'go-deferred'],
      ['l', 'go-logbook'],
      ['g', 'cycle-grouping'],
    ];
    const r = new KeyResolver();
    let now = 0;
    for (const [second, command] of pairs) {
      expect(r.resolve(key('g'), { ...tab, now: (now += 2000) })).toEqual({ pending: true });
      expect(r.resolve(key(second), { ...tab, now: now + 300 })).toEqual(cmd(command));
    }
    // Without G first, T, U and D are still the item commands.
    expect(run(key('t'), tab)).toEqual(cmd('today'));
    expect(run(key('u'), tab)).toEqual(cmd('unscheduled'));
    expect(run(key('d'), tab)).toEqual(cmd('deadline'));
  });

  it('starts Quick Find by typing in the installed app only', () => {
    expect(run(key('a'), app)).toEqual({ find: 'a' });
    expect(run(key('T', { shiftKey: true }), { ...app, focus: 'row' })).toEqual({ find: 'T' });
    expect(run(key('a'), tab)).toBeNull();
    expect(run(key('/'), tab)).toEqual(cmd('find'));
    expect(run(key('f', { metaKey: true }), { ...tab, focus: 'text' })).toEqual(cmd('find'));
  });

  it('never fires single keys or Alt chords while typing (FR-7.2k, FR-14.6)', () => {
    const text = { ...tab, focus: 'text' as const };
    expect(run(key('x'), text)).toBeNull();
    expect(run(key('/'), text)).toBeNull();
    expect(run(key('1', { altKey: true }), { ...app, focus: 'text' })).toBeNull();
    expect(run(key('z', { metaKey: true }), { ...app, focus: 'text' })).toBeNull();
    expect(run(key('ArrowUp', { metaKey: true }), { ...app, focus: 'text' })).toBeNull();
    // Command chords still work, as in Things.
    expect(run(key('k', { metaKey: true }), { ...app, focus: 'text' })).toEqual(cmd('complete'));
  });

  it('leaves Space, Enter and the arrows to other focused controls', () => {
    const other = { ...app, focus: 'other' as const };
    expect(run(key(' '), other)).toBeNull();
    expect(run(key('Enter'), other)).toBeNull();
    expect(run(key('ArrowDown'), other)).toBeNull();
    expect(run(key('ArrowDown'), { ...app, focus: 'row' })).toEqual(cmd('select-next'));
    expect(run(key(' '), app)).toEqual(cmd('new-todo'));
  });

  it('sets priority with Opt+digit and moves items with Cmd+arrows', () => {
    expect(run(key('¡', { altKey: true, code: 'Digit1' }), app)).toEqual(cmd('priority-1'));
    expect(run(key('º', { altKey: true, code: 'Digit0' }), tab)).toEqual(cmd('priority-0'));
    expect(run(key('ArrowUp', { metaKey: true }), app)).toEqual(cmd('move-up'));
    expect(run(key('z', { metaKey: true }), tab)).toEqual(cmd('undo'));
    expect(run(key('?', { metaKey: true, shiftKey: true }), app)).toEqual(cmd('help'));
    expect(run(key('?', { shiftKey: true }), tab)).toEqual(cmd('help'));
  });

  it('gives every command a key in both modes, except Trash in a tab', () => {
    for (const b of BINDINGS) {
      expect(keysFor(b, true).length, b.command).toBeGreaterThan(0);
      if (b.command !== 'go-trash') expect(keysFor(b, false).length, b.command).toBeGreaterThan(0);
    }
  });

  it('shows keys the way each platform writes them', () => {
    expect(formatKeys('Mod+Shift+N', true)).toBe('⇧⌘N');
    expect(formatKeys('Mod+Shift+N', false)).toBe('Ctrl+Shift+N');
    expect(formatKeys('Mod+Shift+/', true)).toBe('⌘?');
    expect(formatKeys('G I', false)).toBe('G then I');
    expect(formatKeys('Alt+1', true)).toBe('⌥1');
  });
});

describe('inline New To-Do (FR-1.1)', async () => {
  const { inlineStart } = await import('../src/lib/actions');
  const { todo } = await import('./helpers');
  const ref = '2026-11-09';

  it('starts in the view, with no selection', () => {
    expect(inlineStart({ kind: 'list', list: 'today' }, ref)).toEqual({ startDate: ref });
    expect(inlineStart({ kind: 'project', id: 'p' }, ref)).toEqual({ projectId: 'p' });
  });

  it('joins the selected to-do\'s container, and its day in Scheduled', () => {
    const sel = todo({ projectId: 'p', headingId: 'h', startDate: '2026-11-12' });
    expect(inlineStart({ kind: 'list', list: 'today' }, ref, sel)).toMatchObject({ projectId: 'p', headingId: 'h', startDate: ref });
    expect(inlineStart({ kind: 'list', list: 'scheduled' }, ref, sel)).toMatchObject({ projectId: 'p', startDate: '2026-11-12' });
  });
});

describe('dropping a to-do onto a project or area (FR-10.11)', async () => {
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
    expect(targetAt(label, 'todo', 't1')).toBe(a);
    expect(targetAt(a, 'todo', 't1')).toBe(a);
  });

  it('ignores other drag types, to-dos already there, and plain elements', () => {
    const { label } = link('t1');
    expect(targetAt(label, 'project', 't2')).toBeNull();
    expect(targetAt(label, 'todo', 't1')).toBeNull();
    expect(targetAt(document.body, 'todo', 't2')).toBeNull();
  });
});
