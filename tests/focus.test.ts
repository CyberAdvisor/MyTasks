import { describe, expect, it } from 'vitest';
import { activeFocus, focusSnapshot, outsideFocus } from '../src/lib/model/focus';
import { sidebarCounts } from '../src/lib/model/lists';
import type { Area, ChecklistItem, Heading } from '../src/lib/model/types';
import { project, snapshotOf, todo } from './helpers';

const REF = '2026-11-16';
const area = (id: string) => ({ id, title: id, tagIds: [], collapsed: false, sortKey: 'a0', deletedAt: null }) as unknown as Area;

/** Work and Home areas, a project in each and one with no area, and tasks everywhere. */
function sample() {
  return snapshotOf({
    areas: [area('work'), area('home')],
    projects: [project({ id: 'q4', areaId: 'work' }), project({ id: 'garden', areaId: 'home' }), project({ id: 'loose', areaId: null })],
    headings: [{ id: 'h', projectId: 'q4' } as Heading, { id: 'h2', projectId: 'garden' } as Heading],
    todos: [
      todo({ id: 'inbox', start: 'inbox' }),
      todo({ id: 'inQ4', projectId: 'q4', start: 'unscheduled', startDate: REF }),
      todo({ id: 'inWork', areaId: 'work', start: 'unscheduled', startDate: REF }),
      todo({ id: 'inGarden', projectId: 'garden', start: 'unscheduled', startDate: REF }),
      todo({ id: 'inLoose', projectId: 'loose', start: 'unscheduled', startDate: REF }),
      todo({ id: 'noArea', start: 'unscheduled', startDate: REF }),
    ],
    checklistItems: [{ id: 'c1', todoId: 'inWork' } as ChecklistItem, { id: 'c2', todoId: 'noArea' } as ChecklistItem],
  });
}

describe('focus on an area (FR-22.1)', () => {
  it('keeps the area, its projects, their tasks and the Inbox; hides the rest', () => {
    const f = focusSnapshot(sample(), 'work');
    expect(f.areas.map((a) => a.id)).toEqual(['work']);
    expect(f.projects.map((p) => p.id)).toEqual(['q4']);
    expect(f.headings.map((h) => h.id)).toEqual(['h']);
    expect(f.todos.map((t) => t.id)).toEqual(['inbox', 'inQ4', 'inWork']);
    expect(f.checklistItems.map((c) => c.id)).toEqual(['c1']);
  });

  it('leaves everything when no area is focused', () => {
    const s = sample();
    expect(focusSnapshot(s, null)).toBe(s);
  });

  it('ends the focus when the area no longer exists', () => {
    const s = sample();
    expect(activeFocus(s, 'gone')).toBeNull();
    expect(focusSnapshot(s, 'gone')).toBe(s);
  });

  it('counts only what the focus shows', () => {
    expect(sidebarCounts(sample(), REF).today).toBe(5);
    expect(sidebarCounts(focusSnapshot(sample(), 'work'), REF)).toMatchObject({ inbox: 1, today: 2 });
  });

  it('finds pages outside the focus: another area, or a project not in it', () => {
    const s = sample();
    expect(outsideFocus(s, 'work', { kind: 'area', id: 'home' })).toBe(true);
    expect(outsideFocus(s, 'work', { kind: 'project', id: 'loose' })).toBe(true);
    expect(outsideFocus(s, 'work', { kind: 'project', id: 'q4' })).toBe(false);
    expect(outsideFocus(s, 'work', { kind: 'area', id: 'work' })).toBe(false);
    expect(outsideFocus(s, 'work', { kind: 'list', list: 'today' })).toBe(false);
    expect(outsideFocus(s, null, { kind: 'area', id: 'home' })).toBe(false);
  });
});
