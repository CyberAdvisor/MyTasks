/**
 * Today grouping: All, Projects and Priorities (FR-16).
 */
import { describe, expect, it } from 'vitest';
import { todayGroupChange, todayGroups, groupByContainer } from '../src/lib/model/lists';
import { DEFAULT_SETTINGS, readSettings } from '../src/lib/model/settings';
import { filterByTag } from '../src/lib/model/tags';
import { project, snapshotOf, todo } from './helpers';

const LABELS = ['Urgent', 'High', 'P3', 'P4', 'P5'];

describe('Today grouping', () => {
  const area = { ...todo(), title: 'Work', tagIds: [], collapsed: false };
  const p = project({ title: 'Launch', areaId: area.id });
  const a = todo({ title: 'a', projectId: p.id, priority: 2, todaySortKey: 'a2' });
  const b = todo({ title: 'b', priority: 1, todaySortKey: 'a1' });
  const c = todo({ title: 'c', areaId: area.id, todaySortKey: 'a3' });
  const d = todo({ title: 'd', projectId: p.id, priority: 2, todaySortKey: 'a0' });
  const s = snapshotOf({ areas: [area], projects: [p], todos: [a, b, c, d] });
  const inOrder = [d, b, a, c]; // Today's manual order

  it('All is one list in manual order', () => {
    expect(todayGroups(inOrder, 'none', s, LABELS)).toEqual([{ key: 'all', title: '', todos: inOrder }]);
    expect(todayGroups([], 'none', s, LABELS)).toEqual([]);
  });

  it('Project groups by area and project, keeps manual order, and puts No project last', () => {
    const g = todayGroups(inOrder, 'project', s, LABELS);
    expect(g.map((x) => [x.title, x.subtitle, x.todos.map((t) => t.title)])).toEqual([
      ['Work', undefined, ['c']],
      ['Launch', 'Work', ['d', 'a']],
      ['No project', undefined, ['b']],
    ]);
  });

  it('Priority groups by the user labels, hides empty groups, and ends with No priority', () => {
    const g = todayGroups(inOrder, 'priority', s, LABELS);
    expect(g.map((x) => [x.title, x.todos.map((t) => t.title)])).toEqual([
      ['Urgent', ['b']],
      ['High', ['d', 'a']],
      ['No priority', ['c']],
    ]);
  });

  it('applies after the tag filter, hiding groups with no matches', () => {
    const tagged = { ...b, tagIds: ['x'] };
    const s2 = snapshotOf({ areas: [area], projects: [p], todos: [a, tagged, c, d] });
    const filtered = filterByTag([d, tagged, a, c], 'x', s2);
    expect(todayGroups(filtered, 'project', s2, LABELS).map((x) => x.title)).toEqual(['No project']);
  });

  it('keeps container order for other lists', () => {
    expect(groupByContainer([c, b], s)[0].title).toBe('No project');
  });

  it('reads the grouping setting, falling back to All', () => {
    expect(readSettings([{ key: 'todayGrouping', value: 'priority' }]).todayGrouping).toBe('priority');
    expect(readSettings([{ key: 'todayGrouping', value: 'bogus' }]).todayGrouping).toBe('none');
    expect(DEFAULT_SETTINGS.todayGrouping).toBe('none');
  });

  it('says what a task takes on when dragged into another group (FR-16.7)', () => {
    // Priority groups set the priority; No priority clears it.
    expect(todayGroupChange('priority:1', a)).toEqual({ kind: 'priority', priority: 1 });
    expect(todayGroupChange('priority:none', a)).toEqual({ kind: 'priority', priority: null });
    expect(todayGroupChange('priority:2', a)).toBeNull();
    // Project grouping moves it to the project or area; No project takes it out.
    expect(todayGroupChange(`project:${p.id}`, b)).toEqual({ kind: 'place', to: { projectId: p.id } });
    expect(todayGroupChange(`area:${area.id}`, a)).toEqual({ kind: 'place', to: { areaId: area.id } });
    expect(todayGroupChange('none', a)).toEqual({ kind: 'place', to: {} });
    expect(todayGroupChange(`project:${p.id}`, a)).toBeNull();
    expect(todayGroupChange(`area:${area.id}`, c)).toBeNull();
    expect(todayGroupChange('none', b)).toBeNull();
    // Context groups set the context.
    expect(todayGroupChange('context:ctx1', b)).toEqual({ kind: 'context', contextId: 'ctx1' });
    expect(todayGroupChange('context:none', { ...b, contextId: 'ctx1' })).toEqual({ kind: 'context', contextId: null });
    expect(todayGroupChange('context:none', b)).toBeNull();
  });
});
