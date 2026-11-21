/** Display helpers that need the data snapshot. */
import type { Snapshot } from './model/lists';
import type { Todo } from './model/types';

/**
 * The project or area a task belongs to, for the line under its title.
 * A task under a heading shows the heading after its project, as
 * "Vacation : Packing" (FR-1.9); a heading with no title is left off.
 */
export function containerLabel(todo: Todo, s: Snapshot): string {
  if (todo.projectId) {
    const project = s.projects.find((p) => p.id === todo.projectId)?.title || 'New Project';
    const heading = headingLabel(todo, s);
    return heading ? `${project} : ${heading}` : project;
  }
  if (todo.areaId) return s.areas.find((a) => a.id === todo.areaId)?.title || 'New Area';
  return '';
}

/**
 * The title of a task's heading, or '' for none or an untitled one. Rows
 * under a project's group heading in Today show it alone (FR-1.9).
 */
export function headingLabel(todo: Todo, s: Snapshot): string {
  return (todo.headingId && s.headings.find((h) => h.id === todo.headingId)?.title) || '';
}
