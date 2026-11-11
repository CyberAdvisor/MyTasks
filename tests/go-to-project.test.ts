/** Tests for the open card's project link (FR-1.2): where it points and when it shows. */
import { describe, expect, it } from 'vitest';
import { containerLink } from '../src/lib/actions';
import { todo } from './helpers';

const scheduled = { kind: 'list', list: 'scheduled' } as const;

describe('card link to project or area', () => {
  it('points to the project, or to the area for a to-do with no project', () => {
    expect(containerLink(todo({ projectId: 'p1' }), scheduled)).toEqual({ kind: 'project', id: 'p1' });
    expect(containerLink(todo({ areaId: 'a1' }), scheduled)).toEqual({ kind: 'area', id: 'a1' });
  });

  it('is hidden for a to-do with no project or area', () => {
    expect(containerLink(todo(), scheduled)).toBeNull();
  });

  it('is hidden on the page it would link to', () => {
    expect(containerLink(todo({ projectId: 'p1' }), { kind: 'project', id: 'p1' })).toBeNull();
    expect(containerLink(todo({ areaId: 'a1' }), { kind: 'area', id: 'a1' })).toBeNull();
    expect(containerLink(todo({ projectId: 'p1' }), { kind: 'project', id: 'p2' })).toEqual({ kind: 'project', id: 'p1' });
  });
});
