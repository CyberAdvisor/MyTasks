/**
 * Selecting several tasks (FR-10.1): Cmd/Ctrl-click, Shift-click,
 * Shift+arrows and Select All, and what several selected tasks share in the
 * menu (lib/bulk.ts).
 */
import { describe, expect, it } from 'vitest';
import { NO_SELECTION, extend, inOrder, rangeTo, selectAll, single, toggle } from '../src/lib/model/selection';
import { earliestDeadline, latestStart, shared, tagsOf } from '../src/lib/bulk';
import type { Todo } from '../src/lib/model/types';
import { ui } from '../src/lib/state/ui.svelte';

const order = ['a', 'b', 'c', 'd', 'e'];

describe('selection gestures', () => {
  it('Cmd-click adds a task and removes it again', () => {
    let s = single('b');
    s = toggle(s, 'd');
    expect(s).toEqual({ ids: ['b', 'd'], active: 'd', anchor: 'd' });
    s = toggle(s, 'b');
    expect(s).toEqual({ ids: ['d'], active: 'd', anchor: 'd' });
    expect(toggle(s, 'd')).toEqual({ ids: [], active: null, anchor: null });
  });

  it('Shift-click selects from the last task chosen, either way', () => {
    expect(rangeTo(single('b'), order, 'd').ids).toEqual(['b', 'c', 'd']);
    expect(rangeTo(single('d'), order, 'a').ids).toEqual(['a', 'b', 'c', 'd']);
    // The anchor stays: a second Shift-click replaces the range.
    const s = rangeTo(rangeTo(single('c'), order, 'e'), order, 'a');
    expect(s).toEqual({ ids: ['a', 'b', 'c'], active: 'a', anchor: 'c' });
    // With nothing selected it selects just that task.
    expect(rangeTo(NO_SELECTION, order, 'c').ids).toEqual(['c']);
  });

  it('Shift+Down and Shift+Up grow and shrink from the anchor', () => {
    let s = single('b');
    s = extend(s, order, 1);
    s = extend(s, order, 1);
    expect(s.ids).toEqual(['b', 'c', 'd']);
    s = extend(s, order, -1);
    expect(s.ids).toEqual(['b', 'c']);
    s = extend(extend(s, order, -1), order, -1);
    expect(s).toEqual({ ids: ['a', 'b'], active: 'a', anchor: 'b' });
    // It stops at the ends, and starts at an end when nothing is selected.
    expect(extend(single('e'), order, 1).ids).toEqual(['e']);
    expect(extend(NO_SELECTION, order, -1)).toEqual(single('e'));
  });

  it('Select All takes every task, and actions go in screen order', () => {
    expect(selectAll(single('c'), order)).toEqual({ ids: order, active: 'c', anchor: 'a' });
    expect(inOrder(toggle(toggle(single('d'), 'a'), 'x'), order)).toEqual(['a', 'd']);
  });
});

describe('what several tasks share', () => {
  const t = (fields: Partial<Todo>) => ({ priority: null, contextId: null, tagIds: [], deadline: null, startDate: null, ...fields }) as Todo;

  it('shows a priority or context only when every task has it', () => {
    expect(shared([t({ priority: 2 }), t({ priority: 2 })], (x) => x.priority)).toBe(2);
    expect(shared([t({ priority: 2 }), t({ priority: null })], (x) => x.priority)).toBeUndefined();
  });

  it('splits tags into those every task has and those only some have', () => {
    expect(tagsOf([t({ tagIds: ['home', 'x'] }), t({ tagIds: ['home'] })])).toEqual({ all: ['home'], some: ['x'] });
  });

  it('limits a start date by the earliest deadline, and warns from the latest start date (FR-3.6)', () => {
    const todos = [t({ deadline: '2026-12-10', startDate: '2026-11-20' }), t({ deadline: '2026-12-01', startDate: '2026-11-25' }), t({})];
    expect(earliestDeadline(todos)).toBe('2026-12-01');
    expect(latestStart(todos)).toBe('2026-11-25');
    expect(earliestDeadline([t({})])).toBeNull();
  });
});

describe('the selection in the app (NFR-7)', () => {
  it('checks a row and lists the selected tasks from the selection, in the order chosen', () => {
    const task = (id: string) => ({ id, title: id }) as Todo;
    const byId = new Map(['a', 'b', 'c'].map((id) => [id, task(id)]));
    ui.selection = { ids: ['c', 'a', 'gone'], active: 'a', anchor: 'c' };
    expect(ui.isSelected('a')).toBe(true);
    expect(ui.isSelected('b')).toBe(false);
    expect(ui.selectedTodos(byId).map((t) => t.id)).toEqual(['c', 'a']);
    ui.selection = NO_SELECTION;
    expect(ui.isSelected('a')).toBe(false);
  });
});
