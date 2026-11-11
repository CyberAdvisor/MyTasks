/**
 * Search (design doc, Sections 5.7 and 5.11: FR-9, FR-15).
 *
 * Pure functions over the snapshot. Quick Find, the search results page and
 * saved searches all use the same matching rule, so a saved search always
 * shows what the same search would show.
 *
 * Matching rule (FR-9.2): case and accents are ignored, and every word of the
 * query must appear in the to-do's title, notes, checklist text or context
 * name (FR-18.6). To-dos in the Trash never match.
 */
import {
  groupByContainer,
  isClosed,
  isOpen,
  visibleTodos,
  type BuiltInList,
  type Snapshot,
  type TodoGroup,
} from './lists';
import { bySortKey } from './order';
import { contextTitle } from './contexts';
import { effectiveTagIds } from './tags';
import type { ID, SavedSearch, Todo } from './types';

/** What to search for: words, tags a to-do must all carry, and an optional context. */
export interface SearchFilter {
  query: string;
  tagIds: ID[];
  contextId?: ID | null;
}

/** Built-in searches offered by Quick Find (FR-9.3). */
export type BuiltInFilter = 'deadlines' | 'projects' | 'logged-projects';

export const FILTER_TITLES: Record<BuiltInFilter, string> = {
  deadlines: 'Deadlines',
  projects: 'All Projects',
  'logged-projects': 'Logged Projects',
};

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/** Lower-case text with accents removed, for comparing. */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** The words of a query, folded. An empty query has no words. */
function queryWords(query: string): string[] {
  return fold(query).split(/\s+/).filter(Boolean);
}

/** Does every word appear in `text`? (`text` must already be folded.) */
function hasAll(text: string, words: string[]): boolean {
  return words.every((w) => text.includes(w));
}

/** Folded searchable text of each to-do: title, notes, checklist and context name. */
function searchText(todos: Todo[], s: Snapshot): Map<ID, string> {
  const checklist = new Map<ID, string[]>();
  for (const c of s.checklistItems) {
    if (!checklist.has(c.todoId)) checklist.set(c.todoId, []);
    checklist.get(c.todoId)!.push(c.title);
  }
  return new Map(
    todos.map((t) => [
      t.id,
      fold([t.title, t.notes, ...(checklist.get(t.id) ?? []), contextTitle(t.contextId, s)].join('\n')),
    ]),
  );
}

/** Is the filter empty (no words, tags or context)? An empty filter matches nothing. */
export function isEmptyFilter(f: SearchFilter): boolean {
  return !queryWords(f.query).length && !f.tagIds.length && !f.contextId;
}

/**
 * To-dos matching a filter: open ones first (in container order, for
 * grouping), then completed and canceled ones, newest first (FR-9.2).
 */
export function searchTodos(s: Snapshot, f: SearchFilter): { open: Todo[]; logged: Todo[] } {
  if (isEmptyFilter(f)) return { open: [], logged: [] };
  const words = queryWords(f.query);
  const candidates = visibleTodos(s).filter((t) => isOpen(t) || isClosed(t));
  const text = searchText(candidates, s);
  const matches = candidates.filter(
    (t) =>
      hasAll(text.get(t.id)!, words) &&
      (!f.tagIds.length || f.tagIds.every((id) => effectiveTagIds(t, s).has(id))) &&
      (!f.contextId || t.contextId === f.contextId),
  );
  return {
    open: bySortKey(matches.filter(isOpen)),
    logged: matches
      .filter(isClosed)
      .sort((a, b) => ((a.completedAt ?? '') < (b.completedAt ?? '') ? 1 : -1)),
  };
}

/** Search results grouped by Area and Project, with logged matches apart (FR-15.4). */
export function searchResults(s: Snapshot, f: SearchFilter): { groups: TodoGroup[]; logged: Todo[] } {
  const { open, logged } = searchTodos(s, f);
  return { groups: groupByContainer(open, s), logged };
}

/** Count of open to-dos matching a saved search, for the sidebar (FR-15.3). */
export function openMatchCount(s: Snapshot, f: SearchFilter): number {
  return searchTodos(s, f).open.length;
}

/** Saved searches in sidebar order. */
export function savedSearchesInOrder(s: Snapshot): SavedSearch[] {
  return bySortKey(s.savedSearches);
}

/** Default name for a new saved search: the search text, else the tag and context names (FR-15.1). */
export function defaultSearchName(f: SearchFilter, s: Snapshot): string {
  const text = f.query.trim();
  if (text) return text;
  const names = bySortKey(s.tags.filter((t) => f.tagIds.includes(t.id))).map((t) => t.title || 'Untitled');
  const context = contextTitle(f.contextId ?? null, s);
  if (context) names.push(context);
  return names.join(', ') || 'Search';
}

// ---------------------------------------------------------------------------
// Built-in filters (FR-9.3)
// ---------------------------------------------------------------------------

/** Open to-dos with a deadline, soonest first. */
export function deadlineTodos(s: Snapshot): Todo[] {
  return visibleTodos(s)
    .filter((t) => isOpen(t) && t.deadline !== null)
    .sort((a, b) => (a.deadline! === b.deadline! ? 0 : a.deadline! < b.deadline! ? -1 : 1));
}

// ---------------------------------------------------------------------------
// Quick Find (FR-9.1)
// ---------------------------------------------------------------------------

/** One Quick Find result. Lists come first and to-dos last, as in Things. */
export type FindResult =
  | { kind: 'list'; list: BuiltInList; title: string }
  | { kind: 'filter'; filter: BuiltInFilter; title: string }
  | { kind: 'saved'; id: ID; title: string }
  | { kind: 'area'; id: ID; title: string }
  | { kind: 'project'; id: ID; title: string; logged: boolean }
  | { kind: 'tag'; id: ID; title: string }
  | { kind: 'todo'; todo: Todo; logged: boolean }
  | { kind: 'search'; query: string };

/** The most to-dos Quick Find lists; the rest are on the full results page. */
const FIND_TODO_LIMIT = 30;

/**
 * Quick Find results for `query`: lists, built-in filters, saved searches,
 * areas, projects and tags whose name matches, then matching to-dos (open
 * first, logged last), then a row that opens the full results page.
 * `listTitles` gives the built-in lists' display names.
 */
export function quickFind(s: Snapshot, query: string, listTitles: Record<BuiltInList, string>): FindResult[] {
  const words = queryWords(query);
  if (!words.length) return [];
  const named = (title: string) => hasAll(fold(title), words);
  const results: FindResult[] = [];

  for (const [list, title] of Object.entries(listTitles) as [BuiltInList, string][]) {
    if (named(title)) results.push({ kind: 'list', list, title });
  }
  for (const [filter, title] of Object.entries(FILTER_TITLES) as [BuiltInFilter, string][]) {
    if (named(title)) results.push({ kind: 'filter', filter, title });
  }
  for (const x of savedSearchesInOrder(s)) if (named(x.title)) results.push({ kind: 'saved', id: x.id, title: x.title });
  for (const a of bySortKey(s.areas)) if (named(a.title)) results.push({ kind: 'area', id: a.id, title: a.title });
  // Open projects first, then logged ones.
  const projects = [...bySortKey(s.projects.filter(isOpen)), ...bySortKey(s.projects.filter(isClosed))];
  for (const p of projects.filter((x) => named(x.title))) {
    results.push({ kind: 'project', id: p.id, title: p.title, logged: isClosed(p) });
  }
  for (const t of bySortKey(s.tags)) if (named(t.title)) results.push({ kind: 'tag', id: t.id, title: t.title });

  const { open, logged } = searchTodos(s, { query, tagIds: [] });
  const todos = [
    ...open.map((todo) => ({ kind: 'todo' as const, todo, logged: false })),
    ...logged.map((todo) => ({ kind: 'todo' as const, todo, logged: true })),
  ];
  results.push(...todos.slice(0, FIND_TODO_LIMIT));
  results.push({ kind: 'search', query: query.trim() });
  return results;
}
