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

// ---------------------------------------------------------------------------
// Nested tags (FR-6.1b). A tag's parent is `parentTagId`; a parent that no
// longer exists counts as none. Every walk keeps a visited set, so a loop
// made by two devices nesting tags under each other at once can't hang.
// ---------------------------------------------------------------------------

/** The tag's parent among `tags`, or null at the top level. */
function parentOf(tag: Tag, tags: Tag[]): Tag | null {
  return tag.parentTagId === null ? null : (tags.find((t) => t.id === tag.parentTagId) ?? null);
}

/** A tag and everything nested under it, at any depth. */
export function descendantIds(tagId: ID, tags: Tag[]): Set<ID> {
  const ids = new Set<ID>([tagId]);
  for (let added = true; added; ) {
    added = false;
    for (const t of tags) {
      if (t.parentTagId !== null && ids.has(t.parentTagId) && !ids.has(t.id)) {
        ids.add(t.id);
        added = true;
      }
    }
  }
  return ids;
}

/** A tag and its parents, from the tag itself up to the top level. */
function ancestorIds(tagId: ID, tags: Tag[]): ID[] {
  const path: ID[] = [];
  let t = tags.find((x) => x.id === tagId) ?? null;
  while (t && !path.includes(t.id)) {
    path.push(t.id);
    t = parentOf(t, tags);
  }
  return path;
}

/**
 * Tags in tree order, for Settings and the tag picker: each tag followed by
 * those nested under it, siblings in Manage Tags order, with their depth.
 * Tags caught in a loop are listed at the top level, so none disappears.
 */
export function tagTree(tags: Tag[]): { tag: Tag; depth: number }[] {
  const out: { tag: Tag; depth: number }[] = [];
  const seen = new Set<ID>();
  const visit = (tag: Tag, depth: number) => {
    if (seen.has(tag.id)) return;
    seen.add(tag.id);
    out.push({ tag, depth });
    for (const child of bySortKey(tags.filter((t) => t.parentTagId === tag.id))) visit(child, depth + 1);
  };
  for (const root of bySortKey(tags.filter((t) => parentOf(t, tags) === null))) visit(root, 0);
  for (const t of bySortKey(tags)) visit(t, 0);
  return out;
}

/** Whether `tagId`, or anything nested under it, is among `used`. */
function familyInUse(tagId: ID, used: Set<ID>, tags: Tag[]): boolean {
  return [...descendantIds(tagId, tags)].some((id) => used.has(id));
}

/**
 * The selected tag if the view still has tasks it would show (it, or a tag
 * nested under it, is in `used`); otherwise no filter.
 */
export function activeTag(selected: ID | null, used: Tag[], tags: Tag[]): ID | null {
  if (selected === null || !tags.some((t) => t.id === selected)) return null;
  return familyInUse(selected, new Set(used.map((t) => t.id)), tags) ? selected : null;
}

/** One pill in the filter bar: `on` when it is the filter or a parent of it; `more` when it stands for nested tags not shown. */
interface TagPill {
  tag: Tag;
  on: boolean;
  more: boolean;
}

/**
 * The filter bar's tag pills (FR-6.1b): top-level tags whose
 * family is in use; a parent with nested tags in use is marked `more`.
 * Selecting a tag adds pills for the tags nested directly under it that are
 * in use, and the parents of the selected tag stay lit.
 */
export function tagPills(used: Tag[], active: ID | null, tags: Tag[]): TagPill[] {
  const usedIds = new Set(used.map((t) => t.id));
  const path = new Set(active === null ? [] : ancestorIds(active, tags));
  const out: TagPill[] = [];
  const emit = (tag: Tag) => {
    if (out.some((p) => p.tag.id === tag.id)) return;
    const children = bySortKey(tags.filter((t) => t.parentTagId === tag.id && familyInUse(t.id, usedIds, tags)));
    const open = path.has(tag.id);
    out.push({ tag, on: open, more: !open && children.length > 0 });
    if (open) children.forEach(emit);
  };
  for (const { tag, depth } of tagTree(tags)) {
    if (depth === 0 && familyInUse(tag.id, usedIds, tags)) emit(tag);
  }
  return out;
}

/** Whether a to-do carries `tagId` or a tag nested under it, directly or inherited. */
export function carriesTag(todo: Todo, tagId: ID, s: Snapshot): boolean {
  const family = descendantIds(tagId, s.tags);
  return [...effectiveTagIds(todo, s)].some((id) => family.has(id));
}

/**
 * The tag filter after choosing `id` (a pill or its filter key): that tag, or,
 * if it is already the filter, its parent, or no filter for a
 * top-level tag.
 */
export function nextTagFilter(current: ID | null, id: ID, tags: Tag[]): ID | null {
  if (current !== id) return id;
  return ancestorIds(id, tags)[1] ?? null;
}

/** Keep the to-dos that carry `tagId` (see `carriesTag`). `null` keeps all. */
export function filterByTag(todos: Todo[], tagId: ID | null, s: Snapshot): Todo[] {
  if (tagId === null) return todos;
  return todos.filter((t) => carriesTag(t, tagId, s));
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
