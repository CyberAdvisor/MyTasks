/**
 * List membership rules (design doc, Section 3, "List membership rules").
 *
 * Pure functions: given a snapshot of the data and today's date, decide which
 * list each item appears in and how lists are grouped. No storage access here,
 * so the rules are easy to unit-test.
 */
import type { Area, ChecklistItem, Context, Heading, ID, LocalDate, Priority, Project, SavedSearch, Tag, Todo } from './types';
import { bySortKey, compareKeys } from './order';
import { addDays, formatMonth, formatRelative, localDay } from './dates';

/** Everything the list rules need, as loaded from the database (deleted records removed). */
export interface Snapshot {
  areas: Area[];
  projects: Project[];
  headings: Heading[];
  todos: Todo[];
  tags: Tag[];
  contexts: Context[];
  checklistItems: ChecklistItem[];
  savedSearches: SavedSearch[];
}

/** The seven built-in sidebar lists. */
export type BuiltInList =
  | 'inbox'
  | 'today'
  | 'scheduled'
  | 'unscheduled'
  | 'deferred'
  | 'logbook'
  | 'trash';

/** A titled group of to-dos inside a list (e.g. a project or a date). */
export interface TodoGroup {
  key: string;
  title: string;
  /** Secondary label, e.g. the Area of a project group. */
  subtitle?: string;
  todos: Todo[];
}

// ---------------------------------------------------------------------------
// Basic predicates
// ---------------------------------------------------------------------------

/** Not deleted and not in Trash. */
export function isLive(item: { deletedAt: string | null; trashedAt: string | null }): boolean {
  return item.deletedAt === null && item.trashedAt === null;
}

/** Live and still open. */
export function isOpen(item: Todo | Project): boolean {
  return isLive(item) && item.status === 'open';
}

/** Live and completed or canceled. */
export function isClosed(item: Todo | Project): boolean {
  return isLive(item) && item.status !== 'open';
}

/**
 * Closed but not yet moved to Completed (FR-12.2): it stays in its list,
 * struck through, until it is moved.
 */
export function isWaiting(item: Todo | Project): boolean {
  return isClosed(item) && item.loggedAt === null;
}

/** Closed and moved to Completed: shown in the Completed list. */
export function isLogged(item: Todo | Project): boolean {
  return isClosed(item) && item.loggedAt !== null;
}

/** Shown in the lists: open, or closed and still waiting to move. */
export function isListed(item: Todo | Project): boolean {
  return isOpen(item) || isWaiting(item);
}

/** Index projects by id for quick lookup. */
export function projectIndex(projects: Project[]): Map<ID, Project> {
  return new Map(projects.map((p) => [p.id, p]));
}

/**
 * A to-do inside a project inherits that project's availability: when the
 * project is deferred or scheduled for later, its to-dos wait with it unless
 * their own dates bring them forward.
 */
function projectHolds(todo: Todo, projects: Map<ID, Project>, ref: LocalDate): boolean {
  if (!todo.projectId) return false;
  const p = projects.get(todo.projectId);
  if (!p || !isOpen(p)) return false;
  return p.start === 'deferred' || (p.startDate !== null && p.startDate > ref);
}

/**
 * To-dos that can appear in lists: those whose project is not in Trash or
 * deleted. (Trashing a project hides its to-dos with it.)
 */
export function visibleTodos(s: Snapshot): Todo[] {
  const hidden = new Set(
    s.projects.filter((p) => p.trashedAt !== null || p.deletedAt !== null).map((p) => p.id),
  );
  return s.todos.filter((t) => !t.projectId || !hidden.has(t.projectId));
}

/** Due today or overdue. */
export function isDue(todo: Todo, ref: LocalDate): boolean {
  return todo.deadline !== null && todo.deadline <= ref;
}

// ---------------------------------------------------------------------------
// Membership
//
// The date rules apply to listed items: open ones, and closed ones still
// waiting to move to Completed, which stay where they were (FR-12.2). Counts
// and the automatic rules look at open items only.
// ---------------------------------------------------------------------------

/** Inbox: open to-dos with no container and no When date. */
export function inInbox(todo: Todo): boolean {
  return isListed(todo) && todo.start === 'inbox';
}

/** Today: When date today or earlier, or deadline today or past. */
export function inToday(todo: Todo, ref: LocalDate): boolean {
  if (!isListed(todo)) return false;
  if (isDue(todo, ref)) return true;
  // A to-do's own When date brings it into Today even inside a held project.
  return todo.start !== 'deferred' && todo.startDate !== null && todo.startDate <= ref;
}

/** Scheduled: When date after today, and not already in Today. */
export function inScheduled(todo: Todo, ref: LocalDate): boolean {
  return isListed(todo) && todo.startDate !== null && todo.startDate > ref && !inToday(todo, ref);
}

/** Unscheduled: open, not Inbox, not Deferred, not scheduled for later. */
export function inUnscheduled(todo: Todo, projects: Map<ID, Project>, ref: LocalDate): boolean {
  if (!isListed(todo) || todo.start !== 'unscheduled') return false;
  if (todo.startDate !== null && todo.startDate > ref) return false;
  if (projectHolds(todo, projects, ref) && !inToday(todo, ref)) return false;
  return true;
}

/** Deferred: to-dos set to Deferred (and not pulled into Today by a deadline). */
export function inDeferred(todo: Todo, ref: LocalDate): boolean {
  return isListed(todo) && todo.start === 'deferred' && !inToday(todo, ref);
}

/** Today items also listed in Unscheduled get a star (design doc, Section 3). */
export function isStarred(todo: Todo, ref: LocalDate): boolean {
  return inToday(todo, ref);
}

/**
 * `items` with the done ones moved below the rest, keeping the order within
 * each part. Display only: the stored order does not change.
 */
export function sinkDone<T>(items: T[], done: (item: T) => boolean): T[] {
  return [...items.filter((x) => !done(x)), ...items.filter(done)];
}

/** Closed to-dos below the open ones (FR-12.7). */
export function sinkClosed<T extends { status: Todo['status'] }>(items: T[]): T[] {
  return sinkDone(items, (t) => t.status !== 'open');
}

// ---------------------------------------------------------------------------
// List builders
// ---------------------------------------------------------------------------

/** Manual order in Today: `todaySortKey`, falling back to `sortKey`. */
function todayOrder(a: Todo, b: Todo): number {
  return compareKeys(a.todaySortKey ?? a.sortKey, b.todaySortKey ?? b.sortKey);
}

export function inboxTodos(s: Snapshot): Todo[] {
  return bySortKey(visibleTodos(s).filter(inInbox));
}

export function todayTodos(s: Snapshot, ref: LocalDate): Todo[] {
  return visibleTodos(s).filter((t) => inToday(t, ref)).sort(todayOrder);
}

/** How the Today list is grouped (FR-16.1). */
export type TodayGrouping = 'none' | 'project' | 'priority' | 'context';

/**
 * Group Today's to-dos (FR-16.2 to FR-16.5, FR-18.7). `todos` must already be
 * in Today's manual order and filtered (FR-16.6); every group keeps that
 * order. `none` (All) returns one untitled group. Empty groups are left out.
 */
export function todayGroups(
  todos: Todo[],
  grouping: TodayGrouping,
  s: Snapshot,
  priorityLabels: string[],
): TodoGroup[] {
  if (grouping === 'project') return groupByContainer(todos, s, { order: todayOrder, noneLast: true });
  if (grouping === 'priority') {
    const levels: (Priority | null)[] = [1, 2, 3, 4, 5, null];
    return levels
      .map((p) => ({
        key: `priority:${p ?? 'none'}`,
        title: p === null ? 'No priority' : (priorityLabels[p - 1] ?? `P${p}`),
        todos: todos.filter((t) => t.priority === p),
      }))
      .filter((g) => g.todos.length);
  }
  if (grouping === 'context') {
    // One group per context in Settings order, then "No context".
    const groups: TodoGroup[] = bySortKey(s.contexts).map((c) => ({
      key: `context:${c.id}`,
      title: c.title || 'Untitled',
      todos: todos.filter((t) => t.contextId === c.id),
    }));
    const known = new Set(s.contexts.map((c) => c.id));
    groups.push({
      key: 'context:none',
      title: 'No context',
      todos: todos.filter((t) => t.contextId === null || !known.has(t.contextId)),
    });
    return groups.filter((g) => g.todos.length);
  }
  return todos.length ? [{ key: 'all', title: '', todos }] : [];
}

/** Scheduled: one group per day for the next 7 days, then one per month. */
export function scheduledGroups(s: Snapshot, ref: LocalDate): TodoGroup[] {
  const items = visibleTodos(s)
    .filter((t) => inScheduled(t, ref))
    .sort((a, b) =>
      a.startDate! === b.startDate! ? compareKeys(a.sortKey, b.sortKey) : a.startDate! < b.startDate! ? -1 : 1,
    );
  const weekEnd = addDays(ref, 7);
  const groups = new Map<string, TodoGroup>();
  for (const t of items) {
    const d = t.startDate!;
    const byDay = d <= weekEnd;
    const key = byDay ? d : d.slice(0, 7);
    if (!groups.has(key)) {
      groups.set(key, { key, title: byDay ? formatRelative(d, ref) : formatMonth(d), todos: [] });
    }
    groups.get(key)!.todos.push(t);
  }
  return [...groups.values()];
}

/** Options for `groupByContainer`. */
interface ContainerGrouping {
  /** Order inside each group; defaults to manual container order (`sortKey`). */
  order?: (a: Todo, b: Todo) => number;
  /** Put the "No project" group last instead of first (Today, FR-16.3). */
  noneLast?: boolean;
}

/**
 * Group to-dos by Area, then Project, following sidebar order: loose to-dos
 * with no container first (or last), then each area's loose to-dos and
 * projects, then projects with no area. Empty groups are left out.
 */
export function groupByContainer(todos: Todo[], s: Snapshot, opts: ContainerGrouping = {}): TodoGroup[] {
  const order = opts.order ?? ((a: Todo, b: Todo) => compareKeys(a.sortKey, b.sortKey));
  const groups: TodoGroup[] = [];
  const areas = bySortKey(s.areas.filter((a) => a.deletedAt === null));
  const projects = bySortKey(s.projects.filter((pr) => pr.deletedAt === null));
  const areaName = new Map(areas.map((a) => [a.id, a.title]));

  const push = (key: string, title: string, list: Todo[], subtitle?: string) => {
    if (list.length) groups.push({ key, title, subtitle, todos: [...list].sort(order) });
  };
  const pushNone = () => push('none', 'No project', todos.filter((t) => !t.projectId && !t.areaId));

  if (!opts.noneLast) pushNone();
  for (const a of areas) {
    push(`area:${a.id}`, a.title || 'New Area', todos.filter((t) => !t.projectId && t.areaId === a.id));
    for (const pr of projects.filter((x) => x.areaId === a.id)) {
      push(`project:${pr.id}`, pr.title || 'New Project', todos.filter((t) => t.projectId === pr.id), a.title || 'New Area');
    }
  }
  for (const pr of projects.filter((x) => !x.areaId || !areaName.has(x.areaId))) {
    push(`project:${pr.id}`, pr.title || 'New Project', todos.filter((t) => t.projectId === pr.id));
  }
  if (opts.noneLast) pushNone();
  return groups;
}

export function unscheduledGroups(s: Snapshot, ref: LocalDate): TodoGroup[] {
  const p = projectIndex(s.projects);
  return groupByContainer(visibleTodos(s).filter((t) => inUnscheduled(t, p, ref)), s);
}

export function deferredGroups(s: Snapshot, ref: LocalDate): TodoGroup[] {
  return groupByContainer(visibleTodos(s).filter((t) => inDeferred(t, ref)), s);
}

/** Projects set to Deferred, shown at the top of the Deferred list. */
export function deferredProjects(s: Snapshot): Project[] {
  return bySortKey(s.projects.filter((pr) => isOpen(pr) && pr.start === 'deferred'));
}

/** Completed list: moved to-dos grouped by local completion date, newest first. */
export function logbookGroups(s: Snapshot, ref: LocalDate): TodoGroup[] {
  const items = visibleTodos(s)
    .filter(isLogged)
    .sort((a, b) => ((a.completedAt ?? '') < (b.completedAt ?? '') ? 1 : -1));
  const groups = new Map<string, TodoGroup>();
  for (const t of items) {
    const day = t.completedAt ? localDay(t.completedAt) : 'earlier';
    if (!groups.has(day)) {
      groups.set(day, { key: day, title: day === 'earlier' ? 'Earlier' : formatRelative(day, ref), todos: [] });
    }
    groups.get(day)!.todos.push(t);
  }
  return [...groups.values()];
}

/** Moved projects for the Completed list. */
export function loggedProjects(s: Snapshot): Project[] {
  return s.projects
    .filter(isLogged)
    .sort((a, b) => ((a.completedAt ?? '') < (b.completedAt ?? '') ? 1 : -1));
}

/** Trash: trashed (not yet emptied) to-dos and projects, most recent first. */
export function trashTodos(s: Snapshot): Todo[] {
  return s.todos
    .filter((t) => t.deletedAt === null && t.trashedAt !== null)
    .sort((a, b) => (a.trashedAt! < b.trashedAt! ? 1 : -1));
}

export function trashProjects(s: Snapshot): Project[] {
  return s.projects
    .filter((pr) => pr.deletedAt === null && pr.trashedAt !== null)
    .sort((a, b) => (a.trashedAt! < b.trashedAt! ? 1 : -1));
}

// ---------------------------------------------------------------------------
// Containers
// ---------------------------------------------------------------------------

/**
 * Listed to-dos of a project (open, or waiting to move to Completed) with no
 * heading, then one group per heading.
 */
export function projectSections(
  s: Snapshot,
  projectId: ID,
): { loose: Todo[]; headings: { heading: Heading; todos: Todo[] }[] } {
  const open = s.todos.filter((t) => t.projectId === projectId && isListed(t));
  const heads = bySortKey(
    s.headings.filter((h) => h.projectId === projectId && h.deletedAt === null && !h.archived),
  );
  const headIds = new Set(heads.map((h) => h.id));
  return {
    loose: bySortKey(open.filter((t) => !t.headingId || !headIds.has(t.headingId))),
    headings: heads.map((heading) => ({
      heading,
      todos: bySortKey(open.filter((t) => t.headingId === heading.id)),
    })),
  };
}

/** Share of a project's live to-dos that are closed, 0 to 1 (FR-2.2). */
export function projectProgress(s: Snapshot, projectId: ID): number {
  const all = s.todos.filter((t) => t.projectId === projectId && isLive(t));
  if (!all.length) return 0;
  return all.filter((t) => t.status !== 'open').length / all.length;
}

/**
 * Open projects of an area, or of no area when `areaId` is null. With
 * `waiting`, closed projects not yet moved to Completed are included, as the
 * sidebar and area pages show them (FR-12.2).
 */
export function areaProjects(s: Snapshot, areaId: ID | null, waiting = false): Project[] {
  const shown = waiting ? isListed : isOpen;
  return bySortKey(
    s.projects.filter((pr) => shown(pr) && (areaId === null ? !pr.areaId : pr.areaId === areaId)),
  );
}

/** Listed to-dos sitting directly in an area (no project). */
export function areaLooseTodos(s: Snapshot, areaId: ID): Todo[] {
  return bySortKey(visibleTodos(s).filter((t) => isListed(t) && t.areaId === areaId && !t.projectId));
}

/**
 * Badge counts for the sidebar. As in Things, Today's two numbers add up to
 * the list: `due` (red) counts due and overdue to-dos, `today` (grey) the rest.
 */
export function sidebarCounts(s: Snapshot, ref: LocalDate): { inbox: number; today: number; due: number } {
  const todos = visibleTodos(s).filter(isOpen);
  const today = todos.filter((t) => inToday(t, ref));
  const due = today.filter((t) => isDue(t, ref)).length;
  return {
    inbox: todos.filter(inInbox).length,
    today: today.length - due,
    due,
  };
}

// ---------------------------------------------------------------------------
// Move to Completed (FR-12.2)
// ---------------------------------------------------------------------------

/** A view with its own Move to Completed button: a built-in list, a project or an area. */
export type ViewRef = { kind: 'list'; list: BuiltInList } | { kind: 'project'; id: ID } | { kind: 'area'; id: ID };

/** The to-dos and projects that a Move to Completed command moves. */
export interface WaitingItems {
  todos: ID[];
  projects: ID[];
}

/**
 * Items shown in `view` that are closed and still waiting to move to
 * Completed. Move to Completed moves just these, so the button shows only
 * when there are some.
 */
export function waitingInView(s: Snapshot, view: ViewRef, ref: LocalDate): WaitingItems {
  const ids = (items: (Todo | Project)[]) => items.filter(isWaiting).map((x) => x.id);
  if (view.kind === 'project') {
    const pr = s.projects.find((p) => p.id === view.id);
    const sec = projectSections(s, view.id);
    return {
      todos: ids([...sec.loose, ...sec.headings.flatMap((h) => h.todos)]),
      projects: pr ? ids([pr]) : [],
    };
  }
  if (view.kind === 'area') {
    return { todos: ids(areaLooseTodos(s, view.id)), projects: ids(areaProjects(s, view.id, true)) };
  }
  const p = projectIndex(s.projects);
  const todos = visibleTodos(s);
  const inList: Record<BuiltInList, (t: Todo) => boolean> = {
    inbox: inInbox,
    today: (t) => inToday(t, ref),
    scheduled: (t) => inScheduled(t, ref),
    unscheduled: (t) => inUnscheduled(t, p, ref),
    deferred: (t) => inDeferred(t, ref),
    logbook: () => false,
    trash: () => false,
  };
  return { todos: ids(todos.filter(inList[view.list])), projects: [] };
}
