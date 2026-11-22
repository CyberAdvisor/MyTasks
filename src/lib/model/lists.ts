/**
 * List membership rules (design doc, Section 3, "List membership rules").
 *
 * Pure functions: given a snapshot of the data and today's date, decide which
 * list each item appears in and how lists are grouped. No storage access here,
 * so the rules are easy to unit-test.
 */
import type { Area, ChecklistItem, Context, Heading, ID, LocalDate, Priority, Project, SavedSearch, Tag, Todo } from './types';
import { bySortKey, compareKeys } from './order';
import { addDays, addMonths, formatMonthName, formatRelative, formatShort, formatWeekday, localDay, monthEnd, whenLabel } from './dates';

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
  /** Scheduled only (FR-21.6): what the group is, and the dates it covers. */
  kind?: 'day' | 'range' | 'month' | 'year';
  from?: LocalDate;
  to?: LocalDate;
  /** Scheduled's day groups: the date's number, shown large before the title. */
  day?: string;
  /** Scheduled only: repeating projects' templates whose next copy falls in the group (FR-4.6). */
  projects?: Project[];
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
function isWaiting(item: Todo | Project): boolean {
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
 * deleted. (Trashing a project hides its to-dos with it.) A repeating
 * project's template hides its tasks too: they are the pattern for its
 * copies, shown only on the template's own page (FR-4.6).
 */
export function visibleTodos(s: Snapshot): Todo[] {
  const hidden = new Set(
    s.projects.filter((p) => p.trashedAt !== null || p.deletedAt !== null || p.repeat !== null).map((p) => p.id),
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

/** Inbox: open to-dos with no container and no When date. A repeating task's template never is. */
export function inInbox(todo: Todo): boolean {
  return isListed(todo) && todo.start === 'inbox' && !todo.repeat;
}

/**
 * Today: When date today or earlier. A deadline counts only through the When
 * date it sets (`deadlineWhen`, FR-3.7). A to-do's own When date brings it
 * into Today even inside a held project.
 */
export function inToday(todo: Todo, ref: LocalDate): boolean {
  if (todo.repeat) return false; // A template's copies go to Today, never the template (FR-4.1).
  return isListed(todo) && todo.start !== 'deferred' && todo.startDate !== null && todo.startDate <= ref;
}

/**
 * A dated task or project is never Deferred: a date makes it scheduled, as
 * choosing one in the When picker does. Records that break this (from an
 * older version, a backup or another device) get the change this returns,
 * or `null` when there is nothing to correct (sweepRules, readBackup).
 */
export function datedOutOfDeferred(r: Pick<Todo, 'start' | 'startDate'> | Pick<Project, 'start' | 'startDate'>): { start: 'unscheduled' } | null {
  return r.start === 'deferred' && r.startDate !== null ? { start: 'unscheduled' } : null;
}

/**
 * A deadline sets When (FR-3.7): an open to-do whose deadline is today or
 * past, and that isn't in Today by its When date (no When, Deferred, or a
 * When after today), gets When = today. Returns the change, or `null`.
 */
export function deadlineWhen(todo: Todo, ref: LocalDate): Pick<Todo, 'start' | 'startDate'> | null {
  if (!isOpen(todo) || todo.repeat || !isDue(todo, ref) || inToday(todo, ref)) return null;
  return { start: 'unscheduled', startDate: ref };
}

/**
 * Scheduled: When date after today. A repeating task's template shows here
 * on its next copy's date, unless it is paused (FR-4.3).
 */
export function inScheduled(todo: Todo, ref: LocalDate): boolean {
  return isListed(todo) && todo.startDate !== null && todo.startDate > ref && !todo.repeat?.paused;
}

/**
 * Unscheduled: open, not Inbox, not Deferred, not scheduled for later, and
 * not in Today. A task is in one or the other (decided 2026-11-14, conversation 2026-11-14-C).
 */
export function inUnscheduled(todo: Todo, projects: Map<ID, Project>, ref: LocalDate): boolean {
  if (!isListed(todo) || todo.start !== 'unscheduled') return false;
  // A template not in Scheduled (paused, or waiting for its copy to be done) is listed here, so it can always be found.
  if (todo.repeat) return !inScheduled(todo, ref) && !projectHolds(todo, projects, ref);
  if (todo.startDate !== null && todo.startDate > ref) return false;
  if (inToday(todo, ref) || projectHolds(todo, projects, ref)) return false;
  return true;
}

/**
 * A repeating project's template listed in Scheduled on its next copy's
 * date (FR-4.6), unless paused. Other projects aren't listed there.
 */
export function inScheduledProject(p: Project, ref: LocalDate): boolean {
  return p.repeat !== null && !p.repeat.paused && isOpen(p) && p.startDate !== null && p.startDate > ref;
}

/** Deferred: to-dos set to Deferred. */
export function inDeferred(todo: Todo): boolean {
  return isListed(todo) && todo.start === 'deferred';
}

/**
 * Whether dropping `todo` on the sidebar list `list` changes it (FR-10.3b): Inbox takes it out of its project with no date, Today,
 * Unscheduled and Deferred set its start, Scheduled asks for a date, and
 * Trash trashes it. A list isn't offered where the task already is. Logbook
 * takes no drop, and a
 * repeating task's template goes only to the Trash.
 */
export function takesDrop(list: BuiltInList, todo: Todo, projects: Map<ID, Project>, ref: LocalDate): boolean {
  if (list === 'trash') return isLive(todo);
  if (list === 'logbook' || !isOpen(todo) || todo.repeat) return false;
  if (list === 'inbox') return !inInbox(todo);
  if (list === 'today') return !inToday(todo, ref);
  if (list === 'unscheduled') return !inUnscheduled(todo, projects, ref);
  if (list === 'deferred') return !inDeferred(todo);
  return true; // Scheduled: the date is chosen after the drop.
}

/** Today items get a star on pages other than Today (whenMark). */
function isStarred(todo: Todo, ref: LocalDate): boolean {
  return inToday(todo, ref);
}

/** What a row shows before its title about its When (Section 6, Row). */
type WhenMark =
  | { kind: 'today' }
  | { kind: 'scheduled'; label: string }
  | { kind: 'deferred' }
  | { kind: 'paused' }
  | null;

/**
 * A task's When mark: a star when it is in Today, a grey date
 * label when it is scheduled later, a dashed checkbox when it is deferred,
 * and nothing when it is unscheduled. `list` is the built-in list showing
 * the row (null on project, area and search pages); a mark the list already
 * states is left off (no star in Today, no date in Scheduled's day groups),
 * and closed tasks in Completed and Trash have none.
 */
export function whenMark(todo: Todo, ref: LocalDate, list: BuiltInList | null): WhenMark {
  if (list === 'logbook' || list === 'trash' || !isListed(todo)) return null;
  // A template shows its next date, or Paused (FR-4.3, FR-4.4).
  if (todo.repeat?.paused) return { kind: 'paused' };
  if (isStarred(todo, ref)) return list === 'today' ? null : { kind: 'today' };
  if (todo.start === 'deferred') return { kind: 'deferred' };
  if (todo.startDate !== null && todo.startDate > ref) {
    // Scheduled's day groups already say the date; its later groups show it as "Nov 29" (FR-21.6).
    if (list === 'scheduled') return todo.startDate > addDays(ref, 7) ? { kind: 'scheduled', label: formatShort(todo.startDate) } : null;
    return { kind: 'scheduled', label: whenLabel(todo.startDate, ref) };
  }
  return null;
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

/** How many whole months Scheduled shows one at a time, after this one, before it goes by year (FR-21.6). */
export const SCHEDULED_MONTHS = 4;

/**
 * Scheduled (FR-21.6), each group with the
 * dates it covers (`from`, `to`), so its calendar events can be found:
 * - `day`: each of the next 7 days, starting tomorrow, titled "Tomorrow" or
 *   the weekday, with the date's number (`day`) shown large before it
 * - `range`: the rest of the month the week ends in, "November" with "27–30"
 * - `month`: each of the next SCHEDULED_MONTHS months, "December"
 * - `year`: everything later, a year at a time, "2027"
 * A group shows when it has tasks, or when `hasEvents` says it has calendar
 * events (never for a year). Tasks on the same date go by priority, those
 * with none last, then in their own order (FR-21.7).
 */
export function scheduledGroups(
  s: Snapshot,
  ref: LocalDate,
  hasEvents: (from: LocalDate, to: LocalDate) => boolean = () => false,
): TodoGroup[] {
  // By date; on a date, by priority (P1 first, then no priority), then in their own order (FR-21.7).
  const rank = (t: Todo) => t.priority ?? 6;
  const items = visibleTodos(s)
    .filter((t) => inScheduled(t, ref))
    .sort((a, b) =>
      a.startDate! !== b.startDate!
        ? a.startDate! < b.startDate! ? -1 : 1
        : rank(a) - rank(b) || compareKeys(a.sortKey, b.sortKey),
    );
  const groups: TodoGroup[] = [];
  const add = (g: Omit<TodoGroup, 'todos'>) => groups.push({ ...g, todos: [] });
  const weekEnd = addDays(ref, 7);
  for (let d = addDays(ref, 1); d <= weekEnd; d = addDays(d, 1)) {
    // "Tomorrow", then weekdays: the seventh day too, which formatRelative would give as a date.
    const title = d === addDays(ref, 1) ? 'Tomorrow' : formatWeekday(d);
    add({ key: d, kind: 'day', title, day: String(Number(d.slice(8))), from: d, to: d });
  }
  const rangeFrom = addDays(weekEnd, 1);
  if (rangeFrom.slice(0, 7) === weekEnd.slice(0, 7)) {
    const to = monthEnd(weekEnd);
    const days = rangeFrom === to ? `${Number(to.slice(8))}` : `${Number(rangeFrom.slice(8))}–${Number(to.slice(8))}`;
    add({ key: weekEnd.slice(0, 7), kind: 'range', title: formatMonthName(weekEnd), subtitle: days, from: rangeFrom, to });
  }
  for (let i = 1; i <= SCHEDULED_MONTHS; i++) {
    const from = addMonths(weekEnd, i);
    add({ key: from.slice(0, 7), kind: 'month', title: formatMonthName(from), from, to: monthEnd(from) });
  }
  const yearsFrom = addMonths(weekEnd, SCHEDULED_MONTHS + 1);
  const templates = bySortKey(s.projects.filter((p) => inScheduledProject(p, ref)));
  // Years, as far as the last task or template reaches; the first may start mid-year.
  const last = [...items.map((t) => t.startDate!), ...templates.map((p) => p.startDate!)].sort().at(-1) ?? yearsFrom;
  for (let y = Number(yearsFrom.slice(0, 4)); y <= Number(last.slice(0, 4)); y++) {
    const from = y === Number(yearsFrom.slice(0, 4)) ? yearsFrom : `${y}-01-01`;
    add({ key: String(y), kind: 'year', title: String(y), from, to: `${y}-12-31` });
  }
  for (const t of items) groups.find((g) => g.from! <= t.startDate! && t.startDate! <= g.to!)?.todos.push(t);
  // Repeating projects' templates, on their next copy's date (FR-4.6).
  for (const p of templates) {
    const g = groups.find((g) => g.from! <= p.startDate! && p.startDate! <= g.to!);
    if (g) (g.projects ??= []).push(p);
  }
  return groups.filter((g) => g.todos.length || g.projects?.length || (g.kind !== 'year' && hasEvents(g.from!, g.to!)));
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

/** What a task takes on when dragged into another of Today's groups (FR-16.7). */
type GroupChange =
  | { kind: 'priority'; priority: Priority | null }
  | { kind: 'context'; contextId: ID | null }
  /** A project, an area, or neither ("No project"). */
  | { kind: 'place'; to: { projectId?: ID; areaId?: ID } };

/**
 * The change that puts `todo` into the Today group `key` (from `todayGroups`),
 * or null when it is already there.
 */
export function todayGroupChange(key: string, todo: Todo): GroupChange | null {
  const [kind, value = ''] = key.split(/:(.*)/);
  if (kind === 'priority') {
    const priority = value === 'none' ? null : (Number(value) as Priority);
    return todo.priority === priority ? null : { kind: 'priority', priority };
  }
  if (kind === 'context') {
    const contextId = value === 'none' ? null : value;
    return todo.contextId === contextId ? null : { kind: 'context', contextId };
  }
  if (kind === 'project') return todo.projectId === value ? null : { kind: 'place', to: { projectId: value } };
  if (kind === 'area') return !todo.projectId && todo.areaId === value ? null : { kind: 'place', to: { areaId: value } };
  if (kind === 'none') return !todo.projectId && !todo.areaId ? null : { kind: 'place', to: {} };
  return null;
}

export function unscheduledGroups(s: Snapshot, ref: LocalDate): TodoGroup[] {
  const p = projectIndex(s.projects);
  return groupByContainer(visibleTodos(s).filter((t) => inUnscheduled(t, p, ref)), s);
}

/**
 * A group's tasks cut to `limit` (FR-23.1), with how many more Show All
 * would add. No cut when there's no limit, or the group fits in it.
 */
export function limitTodos<T>(todos: T[], limit: number | null): { shown: T[]; more: number } {
  if (limit === null || todos.length <= limit) return { shown: todos, more: 0 };
  return { shown: todos.slice(0, limit), more: todos.length - limit };
}

export function deferredGroups(s: Snapshot): TodoGroup[] {
  return groupByContainer(visibleTodos(s).filter(inDeferred), s);
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
 * heading, then one group per heading. Each group is in manual order, or,
 * when given `ref` (today) and the project or heading sorts by date, in the
 * order of `byDate` (FR-2.8). Without `ref` the order is always manual, as
 * counts and sequential projects need.
 */
export function projectSections(
  s: Snapshot,
  projectId: ID,
  ref?: LocalDate,
): { loose: Todo[]; headings: { heading: Heading; todos: Todo[] }[] } {
  const open = s.todos.filter((t) => t.projectId === projectId && isListed(t));
  const heads = bySortKey(
    s.headings.filter((h) => h.projectId === projectId && h.deletedAt === null && !h.archived),
  );
  const headIds = new Set(heads.map((h) => h.id));
  const ordered = (todos: Todo[], sortByDate: boolean | undefined) =>
    ref && sortByDate ? byDate(bySortKey(todos), ref) : bySortKey(todos);
  const project = s.projects.find((p) => p.id === projectId);
  return {
    loose: ordered(open.filter((t) => !t.headingId || !headIds.has(t.headingId)), project?.sortByDate),
    headings: heads.map((heading) => ({
      heading,
      todos: ordered(open.filter((t) => t.headingId === heading.id), heading.sortByDate),
    })),
  };
}

/**
 * Sort by date (FR-2.8): tasks you can do now (in Today, or with no start
 * date) first, in their order; then tasks starting later, by start date
 * (the same date keeps their order); then deferred tasks, in their order.
 * Completed tasks still waiting to move sort by their dates too.
 */
export function byDate(todos: Todo[], ref: LocalDate): Todo[] {
  const group = (t: Todo) => (t.start === 'deferred' ? 2 : t.startDate !== null && t.startDate > ref ? 1 : 0);
  // Array sort is stable, so ties keep the order given.
  return [...todos].sort((a, b) => {
    const ga = group(a);
    return ga - group(b) || (ga === 1 ? a.startDate!.localeCompare(b.startDate!) : 0);
  });
}

/** Share of a project's live to-dos that are closed, 0 to 1 (FR-2.2). */
export function projectProgress(s: Snapshot, projectId: ID): number {
  // A repeating task's template isn't a task to do; its copies are.
  const all = s.todos.filter((t) => t.projectId === projectId && isLive(t) && !t.repeat);
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

/** A project's open tasks, under its headings or not (asked about when completing it, FR-2.3). */
export function openTaskCount(s: Snapshot, projectId: ID): number {
  const sec = projectSections(s, projectId);
  return [...sec.loose, ...sec.headings.flatMap((h) => h.todos)].filter((t) => isOpen(t) && !t.repeat).length;
}

/**
 * Repeating tasks that would stop repeating if the project, or only its
 * heading `headingId`, were completed (review C4).
 */
export function repeatingTaskCount(s: Snapshot, projectId: ID, headingId?: ID): number {
  const sec = projectSections(s, projectId);
  const todos = headingId ? (sec.headings.find((h) => h.heading.id === headingId)?.todos ?? []) : [...sec.loose, ...sec.headings.flatMap((h) => h.todos)];
  return todos.filter((t) => isOpen(t) && !!t.repeat).length;
}

/**
 * Badge counts for the sidebar. Today's two numbers add up to
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
// Move Completed Items (FR-12.2)
// ---------------------------------------------------------------------------

/** A view that Move Completed Items can act on: a built-in list, a project or an area. */
export type ViewRef = { kind: 'list'; list: BuiltInList } | { kind: 'project'; id: ID } | { kind: 'area'; id: ID };

/** The to-dos and projects that a Move Completed Items command moves. */
export interface WaitingItems {
  todos: ID[];
  projects: ID[];
}

/**
 * Items shown in `view` that are closed and still waiting to move to
 * Completed. Move Completed Items (the to-do menu and Quick Find) moves just
 * these, and is offered only when there are some.
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
    deferred: inDeferred,
    logbook: () => false,
    trash: () => false,
  };
  return { todos: ids(todos.filter(inList[view.list])), projects: [] };
}
