/**
 * Focus on an area (FR-22.1).
 *
 * While an area is focused, every list, count, Quick Find and saved search
 * works on a narrowed snapshot: that area, its projects and their headings,
 * the tasks in the area or its projects (with their checklist items), and the
 * Inbox's tasks, which stay for capture. Tasks in other areas, in projects with
 * no area, or with no area at all are left out. Tags, contexts and saved
 * searches are kept whole: a saved search then matches only what is left.
 *
 * Pure functions, so the rule is easy to unit-test.
 */
import type { Snapshot } from './lists';
import type { ID, Project, Todo } from './types';
import type { Route } from '../state/route';

/** The focused area, if it still exists; a deleted area (here or on another device) ends the focus. */
export function activeFocus(s: Snapshot, areaId: ID | null): ID | null {
  if (!areaId) return null;
  return s.areas.some((a) => a.id === areaId) ? areaId : null;
}

/**
 * Whether a task belongs to the focused area: it's in the area, in one of the
 * area's projects, or in the Inbox. `projects` is every project, by id.
 */
export function todoInFocus(todo: Todo, focus: ID, projects: Map<ID, Project>): boolean {
  if (todo.projectId) return projects.get(todo.projectId)?.areaId === focus;
  if (todo.areaId) return todo.areaId === focus;
  return todo.start === 'inbox';
}

/** The snapshot narrowed to one area, or the snapshot itself when no area is focused. */
export function focusSnapshot(s: Snapshot, areaId: ID | null): Snapshot {
  const focus = activeFocus(s, areaId);
  if (!focus) return s;
  const projects = s.projects.filter((p) => p.areaId === focus);
  const projectIds = new Set(projects.map((p) => p.id));
  const byId = new Map(s.projects.map((p) => [p.id, p]));
  const todos = s.todos.filter((t) => todoInFocus(t, focus, byId));
  const todoIds = new Set(todos.map((t) => t.id));
  return {
    ...s,
    areas: s.areas.filter((a) => a.id === focus),
    projects,
    headings: s.headings.filter((h) => projectIds.has(h.projectId)),
    todos,
    checklistItems: s.checklistItems.filter((c) => todoIds.has(c.todoId)),
  };
}

/**
 * Whether a page lies outside the focus: another area, or a project that isn't
 * in the focused area. Opening one (with Back or a link) ends the focus, so
 * the page shows normally rather than empty.
 */
export function outsideFocus(s: Snapshot, areaId: ID | null, r: Route): boolean {
  const focus = activeFocus(s, areaId);
  if (!focus) return false;
  if (r.kind === 'area') return r.id !== focus;
  if (r.kind === 'project') {
    const p = s.projects.find((x) => x.id === r.id);
    return !!p && p.areaId !== focus;
  }
  return false;
}
