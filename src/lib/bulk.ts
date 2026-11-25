/**
 * Changing several selected tasks at once (FR-10.1, FR-14.5). Each change
 * runs the one-task change for every task, in screen order, inside one undo
 * step (`undoGroup`) and one transaction (`tx`): the automatic rules
 * (priority, sequential projects) run for each task as usual, one Cmd/Ctrl+Z
 * takes the whole change back, "where it went" says it once (FR-1.10), and
 * the lists are read again once rather than once per task (NFR-7). A change
 * that fails partway leaves every task as it was.
 */
import { db } from './db/database';
import { tx, undoGroup } from './db/history';
import * as repo from './db/repo';
import { today, whenAfterDeadline } from './model/dates';
import type { ID, LocalDate, Priority, Todo } from './model/types';

/** Run `change` for each task, as one undo step and one transaction. */
function each(ids: ID[], change: (id: ID) => Promise<unknown>): Promise<void> {
  return undoGroup(() =>
    tx(async () => {
      for (const id of ids) await change(id);
    }),
  );
}

export const setWhen = (ids: ID[], choice: repo.WhenChoice) => each(ids, (id) => repo.setWhen(id, choice));
export const setPriority = (ids: ID[], p: Priority | null) => each(ids, (id) => repo.setPriority(id, p));
export const setContext = (ids: ID[], c: ID | null) => each(ids, (id) => repo.setContext(id, c));
export const setTag = (ids: ID[], tagId: ID, on: boolean) => each(ids, (id) => repo.toggleTag('todos', id, tagId, on));
export const move = (ids: ID[], to: repo.TodoPlacement) => each(ids, (id) => repo.moveTodo(id, to));
export const trash = (ids: ID[]) => each(ids, (id) => repo.setTodoTrashed(id, true));

/**
 * Back to the Inbox, as a drop on Inbox does (FR-10.3b): out
 * of any project or area, with no start date.
 */
export const toInbox = (ids: ID[]) =>
  each(ids, async (id) => {
    await repo.moveTodo(id, {});
    await repo.setWhen(id, { kind: 'clear' });
  });

/**
 * Complete, cancel or reopen several tasks at once. Unlike a checkbox they
 * are written straight away: the 2-second window (FR-1.3) is for taking back
 * a single click, and Undo takes back the whole change.
 */
export const setStatus = (ids: ID[], status: Todo['status']) => each(ids, (id) => repo.setTodoStatus(id, status));

/**
 * Set a deadline on several tasks. With `moveWhen`, only the tasks whose
 * start date is after the new deadline have it moved to the deadline (FR-3.6).
 */
export function setDeadline(ids: ID[], deadline: LocalDate | null, moveWhen: boolean): Promise<void> {
  const ref = today();
  return each(ids, async (id) => {
    const t = await db.todos.get(id);
    await repo.setDeadline(id, deadline, moveWhen && !!t && whenAfterDeadline(t.startDate, deadline, ref));
  });
}

/** Set or clear the reminder of several tasks at once (FR-3.8): one transaction, one undo step. */
export const setReminder = (ids: ID[], reminder: string | null) => each(ids, (id) => repo.setReminder(id, reminder));

/** Duplicate several tasks; returns the copies' ids, in the same order. */
export async function duplicate(ids: ID[]): Promise<ID[]> {
  await repo.ensureRoom(ids.length); // all or none, never part of the selection
  const copies: ID[] = [];
  await each(ids, async (id) => {
    const copy = await repo.duplicateTodo(id);
    if (copy) copies.push(copy);
  });
  return copies;
}

/** Take several tasks out of their project or area, keeping their dates (Remove From Project). */
export const removeFromContainer = (ids: ID[]) => each(ids, (id) => repo.moveTodo(id, {}));

/** What several tasks share, for a menu's check mark: the value when every task has it, else undefined. */
export function shared<T>(todos: Todo[], value: (t: Todo) => T): T | undefined {
  const first = todos.length ? value(todos[0]) : undefined;
  return todos.every((t) => value(t) === first) ? first : undefined;
}

/** For the Tags picker: the tags every task has, and the tags only some have. */
export function tagsOf(todos: Todo[]): { all: ID[]; some: ID[] } {
  const ids = [...new Set(todos.flatMap((t) => t.tagIds))];
  const all = ids.filter((id) => todos.every((t) => t.tagIds.includes(id)));
  return { all, some: ids.filter((id) => !all.includes(id)) };
}

/**
 * For the Start Date picker: the earliest deadline among the tasks, so a
 * start date chosen for all of them is after none of their deadlines (FR-3.6).
 */
export function earliestDeadline(todos: Todo[]): LocalDate | null {
  const dates = todos.map((t) => t.deadline).filter((d): d is LocalDate => d !== null);
  return dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : null;
}

/**
 * For the Deadline picker's warning: the latest start date among the tasks,
 * so a deadline before it can offer to move the start dates (FR-3.6).
 */
export function latestStart(todos: Todo[]): LocalDate | null {
  const dates = todos.map((t) => t.startDate).filter((d): d is LocalDate => d !== null);
  return dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null;
}
