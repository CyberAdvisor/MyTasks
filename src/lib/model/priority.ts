/**
 * Automatic priority rules (design doc, Section 5.10, FR-14.9 to FR-14.14).
 *
 * One pure function decides a to-do's priority from its current state, so the
 * same rule runs after every edit and in the sweep at launch, resume and
 * midnight. Because it only looks at state, running it twice changes nothing.
 *
 * Priority sources:
 * - `user`: the user chose this priority, or chose "None". The rules never
 *   change it (FR-14.2).
 * - `auto`: set by a rule.
 * - `null`: no priority and no choice made yet.
 */
import { isDue, isOpen } from './lists';
import type { AppSettings } from './settings';
import type { LocalDate, Priority, Todo } from './types';

/** The priority fields of a to-do. */
type PriorityFields = Pick<Todo, 'priority' | 'prioritySource' | 'priorityBeforeAuto'>;

/**
 * A priority of None the user chose (FR-14.2). It holds only while the task
 * is in Today: once the task is elsewhere, or enters Today again, it counts
 * as no choice and the automatic rules may give it one (FR-14.15).
 */
export function choseNone(todo: Pick<Todo, 'priority' | 'prioritySource'>): boolean {
  return todo.prioritySource === 'user' && todo.priority === null;
}

/** The change that turns a chosen None into no choice, or nothing (FR-14.15). */
export function noneToNoChoice(todo: Pick<Todo, 'priority' | 'prioritySource'>): Partial<Todo> {
  return choseNone(todo) ? { prioritySource: null } : {};
}

/**
 * Has the to-do entered Today through its When date (FR-14.10)? A deadline
 * alone does not count: that case is handled by automatic P1.
 */
function enteredToday(todo: Todo, ref: LocalDate): boolean {
  return todo.start !== 'deferred' && todo.startDate !== null && todo.startDate <= ref;
}

/**
 * The priority fields a to-do should have now, or `null` when nothing
 * changes. Closed and trashed to-dos are frozen (FR-14.12). `projectPriority`
 * is its sequential project's priority (FR-17.3), given in place of Default P2.
 */
export function priorityRules(
  todo: Todo,
  ref: LocalDate,
  settings: AppSettings,
  projectPriority: Priority | null = null,
): PriorityFields | null {
  if (!isOpen(todo) || todo.prioritySource === 'user') return null;

  let priority = todo.priority;
  let source = todo.prioritySource;
  let before = todo.priorityBeforeAuto;

  // FR-14.10: a to-do entering Today with no priority gets P2, or its
  // sequential project's priority (FR-17.3).
  if (priority === null && source === null && enteredToday(todo, ref)) {
    const given = projectPriority ?? (settings.defaultP2 ? 2 : null);
    if (given !== null) {
      priority = given;
      source = 'auto';
    }
  }

  // FR-14.9 and FR-14.11: automatic P1 while due or overdue, then restore.
  if (settings.autoP1) {
    const hasAutoP1 = source === 'auto' && priority === 1;
    if (isDue(todo, ref) && !hasAutoP1) {
      before = priority;
      priority = 1;
      source = 'auto';
    } else if (!isDue(todo, ref) && hasAutoP1) {
      priority = before;
      source = before === null ? null : 'auto';
      before = null;
    }
  }

  const unchanged =
    priority === todo.priority && source === todo.prioritySource && before === todo.priorityBeforeAuto;
  return unchanged ? null : { priority, prioritySource: source, priorityBeforeAuto: before };
}
