/**
 * Sequential projects (design doc, FR-17). A project carrying a tag listed in
 * Settings › Sequential projects keeps one task in Today: when none of its
 * open tasks is there, the first in project order moves in, with the tag's
 * priority and context. Pure functions; repo.ts applies them.
 */
import { inToday, isLive, isOpen } from './lists';
import { bySortKey } from './order';
import type { SequentialTag } from './settings';
import type { Heading, ID, LocalDate, Priority, Project, Todo } from './types';

/** What a sequential project gives the tasks it releases. */
interface SequentialRule {
  /** FR-17.3: the highest priority of its listed tags; null when all are None. */
  priority: Priority | null;
  /** FR-17.4: the context of its tag listed first in Settings. */
  contextId: ID | null;
}

/** The rule for a project, or null when it carries no listed tag. */
export function sequentialRule(project: Pick<Project, 'tagIds'>, rows: SequentialTag[]): SequentialRule | null {
  const listed = rows.filter((r) => project.tagIds.includes(r.tagId));
  if (!listed.length) return null;
  const set = listed.map((r) => r.priority).filter((p): p is Priority => p !== null);
  return { priority: set.length ? (Math.min(...set) as Priority) : null, contextId: listed[0].contextId };
}

/**
 * A project's tasks in project order: those under no heading, then each
 * heading's in turn. Done tasks are included; tasks in Trash are not.
 */
export function projectOrder(projectId: ID, todos: Todo[], headings: Heading[]): Todo[] {
  // A repeating task's template isn't released; its copies take their turn (FR-4.1).
  const mine = todos.filter((t) => t.projectId === projectId && isLive(t) && !t.repeat);
  const heads = bySortKey(headings.filter((h) => h.projectId === projectId && h.deletedAt === null));
  const headIds = new Set(heads.map((h) => h.id));
  return [
    ...bySortKey(mine.filter((t) => !t.headingId || !headIds.has(t.headingId))),
    ...heads.flatMap((h) => bySortKey(mine.filter((t) => t.headingId === h.id))),
  ];
}

/**
 * The task a sequential project releases now (FR-17.2): its first open task,
 * when none of its open tasks is in Today. A project that is closed, deferred
 * or starts later releases nothing. `ordered` comes from `projectOrder`.
 */
export function nextToRelease(project: Project, ordered: Todo[], ref: LocalDate): Todo | null {
  if (!isOpen(project) || project.start === 'deferred' || (project.startDate !== null && project.startDate > ref)) {
    return null;
  }
  const open = ordered.filter(isOpen);
  if (open.some((t) => inToday(t, ref))) return null;
  return open[0] ?? null;
}

/**
 * The changes that release `todo` into Today: today as its start date, where
 * it was (to return it there), what released it, and the tag's context when
 * it has none (FR-17.4). Its priority follows from the priority rules.
 */
export function releaseChanges(todo: Todo, ref: LocalDate, rule: SequentialRule, releasedBy: ID | null): Partial<Todo> {
  const givenContextId = todo.contextId === null ? rule.contextId : null;
  return {
    start: 'unscheduled',
    startDate: ref,
    releasedBy,
    releasedFrom: { start: todo.start, startDate: todo.startDate, givenContextId },
    ...(givenContextId !== null ? { contextId: givenContextId } : {}),
  };
}

/**
 * The changes that return a task to where it was (FR-17.5, FR-17.6), undoing
 * what its time in Today gave it: an automatic priority is removed (one the
 * user chose stays; the rules then run again, so a due task gets P1 back),
 * and the context the release gave goes, unless the user has changed it
 * since. A task that wasn't released goes back to having no start date.
 */
export function returnChanges(todo: Todo): Partial<Todo> {
  const from = todo.releasedFrom ?? { start: 'unscheduled', startDate: null, givenContextId: null };
  return {
    start: from.start,
    startDate: from.startDate,
    releasedBy: null,
    releasedFrom: null,
    ...(todo.prioritySource === 'auto' ? { priority: null, prioritySource: null, priorityBeforeAuto: null } : {}),
    ...(from.givenContextId !== null && todo.contextId === from.givenContextId ? { contextId: null } : {}),
  };
}

/** A task's place in its project, such as "task 2 of 5", or "" when it isn't in `ordered`. */
export function placeLabel(todo: Pick<Todo, 'id'>, ordered: Todo[]): string {
  const i = ordered.findIndex((t) => t.id === todo.id);
  return i < 0 ? '' : `task ${i + 1} of ${ordered.length}`;
}

/**
 * The line under a row's title: the project or area name, then the task's
 * place in a sequential project, joined with " · ". The place is shown in
 * the built-in lists (`list`) even where the name is left off, as under a
 * project's group heading; on the project's own page (`list` null, no name)
 * the order is already visible, so it is left off.
 */
export function rowSubtitle(containerLabel: string, place: string, list: string | null): string {
  if (!containerLabel && list === null) return '';
  return [containerLabel, place].filter(Boolean).join(' · ');
}

/**
 * The other open tasks of a sequential project in Today that Reset Other
 * Tasks returns (FR-17.6): all but `todo`, leaving those with a deadline.
 */
export function othersToReset(todo: Todo, ordered: Todo[], ref: LocalDate): Todo[] {
  return ordered.filter((t) => t.id !== todo.id && isOpen(t) && inToday(t, ref) && t.deadline === null);
}
