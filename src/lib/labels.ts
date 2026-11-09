/** Display helpers that need the data snapshot. */
import type { Snapshot } from './model/lists';
import type { Todo } from './model/types';

/** The project or area a to-do belongs to, for the line under its title. */
export function containerLabel(todo: Todo, s: Snapshot): string {
  if (todo.projectId) return s.projects.find((p) => p.id === todo.projectId)?.title || 'New Project';
  if (todo.areaId) return s.areas.find((a) => a.id === todo.areaId)?.title || 'New Area';
  return '';
}
