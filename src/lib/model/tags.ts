/**
 * Tag and checklist helpers (design doc, Sections 5.4 and 5.5).
 *
 * Pure functions over the snapshot, used by the tag filter bar and by rows.
 */
import type { Snapshot } from './lists';
import { bySortKey } from './order';
import type { ChecklistItem, ID, Project, Tag, Todo } from './types';

/**
 * A to-do's own tags plus those it inherits from its project and area, for
 * filtering (FR-6.2).
 */
export function effectiveTagIds(todo: Todo, s: Snapshot): Set<ID> {
  const ids = new Set(todo.tagIds);
  const project = todo.projectId ? s.projects.find((p) => p.id === todo.projectId) : undefined;
  project?.tagIds.forEach((id) => ids.add(id));
  const areaId = project ? project.areaId : todo.areaId;
  const area = areaId ? s.areas.find((a) => a.id === areaId) : undefined;
  area?.tagIds.forEach((id) => ids.add(id));
  return ids;
}

/** A project's own tags plus its area's. */
export function projectTagIds(project: Project, s: Snapshot): Set<ID> {
  const ids = new Set(project.tagIds);
  const area = project.areaId ? s.areas.find((a) => a.id === project.areaId) : undefined;
  area?.tagIds.forEach((id) => ids.add(id));
  return ids;
}

/** The selected tag if it is still offered in the bar, otherwise no filter. */
export function activeTag(selected: ID | null, offered: Tag[]): ID | null {
  return selected !== null && offered.some((t) => t.id === selected) ? selected : null;
}

/** Keep the to-dos that carry `tagId`, directly or inherited. `null` keeps all. */
export function filterByTag(todos: Todo[], tagId: ID | null, s: Snapshot): Todo[] {
  if (tagId === null) return todos;
  return todos.filter((t) => effectiveTagIds(t, s).has(tagId));
}

/** Tags used by any of `todos`, in Manage Tags order, for the tag bar (FR-6.3). */
export function tagsInUse(todos: Todo[], s: Snapshot): Tag[] {
  const used = new Set<ID>();
  for (const t of todos) effectiveTagIds(t, s).forEach((id) => used.add(id));
  return bySortKey(s.tags.filter((tag) => used.has(tag.id)));
}

/** Tag titles for a list of ids, in Manage Tags order. Unknown ids are skipped. */
export function tagTitles(ids: ID[], s: Snapshot): string[] {
  const wanted = new Set(ids);
  return bySortKey(s.tags.filter((t) => wanted.has(t.id))).map((t) => t.title || 'Untitled');
}

/** A to-do's checklist in order. */
export function checklistFor(todoId: ID, s: Snapshot): ChecklistItem[] {
  return bySortKey(s.checklistItems.filter((c) => c.todoId === todoId));
}

/** Checklist progress for the collapsed row (FR-7.3). */
export function checklistProgress(todoId: ID, s: Snapshot): { done: number; total: number } {
  const items = s.checklistItems.filter((c) => c.todoId === todoId);
  return { done: items.filter((c) => c.completed).length, total: items.length };
}

/**
 * Split pasted text into checklist titles, one per non-empty line (FR-7.2).
 * Leading list markers such as "- ", "* " or "[ ] " are removed.
 */
export function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]\s+|\[[ xX]?\]\s*)?/, '').trim())
    .filter(Boolean);
}
