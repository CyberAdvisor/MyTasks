/**
 * Where a task went (FR-1.10). Moving a task out of the Inbox, or adding one
 * that the list on screen can't show, makes it disappear from view; these
 * name the place it can now be found, for a message with a Show button.
 */
import { formatWeekdayDate } from './dates';
import { inDeferred, inInbox, inScheduled, inToday, inUnscheduled, isOpen } from './lists';
import type { ID, LocalDate, Project, Todo } from './types';
import type { Route } from '../state/route';

export interface WhereItWent {
  message: string;
  where: Route;
}

/**
 * The place an open task can be found, by its start first: Today, Scheduled
 * (with the date), Deferred; then its project or area by name (`title`);
 * then the Inbox or Unscheduled.
 */
function destination(todo: Todo, ref: LocalDate, title: string): { name: string; where: Route } {
  const list = (name: string, l: 'inbox' | 'today' | 'scheduled' | 'unscheduled' | 'deferred') => ({
    name,
    where: { kind: 'list', list: l } as Route,
  });
  if (todo.start === 'deferred') return list('Deferred', 'deferred');
  if (inToday(todo, ref)) return list('Today', 'today');
  if (todo.startDate !== null && todo.startDate > ref) {
    return list(`Scheduled for ${formatWeekdayDate(todo.startDate)}`, 'scheduled');
  }
  if (todo.projectId) return { name: title || 'New Project', where: { kind: 'project', id: todo.projectId } };
  if (todo.areaId) return { name: title || 'New Area', where: { kind: 'area', id: todo.areaId } };
  if (inInbox(todo)) return list('Inbox', 'inbox');
  return list('Unscheduled', 'unscheduled');
}

/**
 * The message for a task that was in the Inbox (`before`) and no longer is
 * (`after`), or null when there is none to show: still in the Inbox, moved
 * into a project (the task is plainly there), completed, canceled or
 * deleted. `areaTitle` names the area the task is in now, if any.
 */
export function whereItWent(before: Todo, after: Todo | undefined, ref: LocalDate, areaTitle = ''): WhereItWent | null {
  if (!after || !inInbox(before) || inInbox(after) || !isOpen(after) || after.projectId) return null;
  const d = destination(after, ref, areaTitle);
  return { message: `Moved to ${d.name}`, where: d.where };
}

/**
 * One message for several tasks that left the Inbox in one change (FR-10.1).
 * Gone to the same place: "3 tasks moved to Today", with Show. Gone to
 * different places: "3 tasks moved", with nothing to show.
 */
export function combineWhere(went: WhereItWent[]): { message: string; where?: Route } | null {
  if (went.length <= 1) return went[0] ?? null;
  const first = went[0];
  const same = went.every((w) => w.message === first.message);
  const n = `${went.length} tasks moved`;
  return same ? { message: `${n}${first.message.slice('Moved'.length)}`, where: first.where } : { message: n };
}

/**
 * The message for a task just added from the new-task box, naming where it
 * went; `title` is its project's or area's name, if any. The caller shows it
 * only when the view on screen doesn't list the task (`shownIn`).
 */
export function addedTo(todo: Todo, ref: LocalDate, title = ''): WhereItWent {
  const d = destination(todo, ref, title);
  return { message: `Added to ${d.name}`, where: d.where };
}

/**
 * Does the view on screen list this task? Each built-in list by its own
 * rule; a project's or area's page by the task's project or area. Search,
 * saved searches, filters, Home and Settings count as not listing it, since
 * whether it matches isn't plain to see.
 */
export function shownIn(todo: Todo, route: Route, ref: LocalDate, projects: Map<ID, Project>): boolean {
  if (route.kind === 'project') return todo.projectId === route.id;
  if (route.kind === 'area') return todo.areaId === route.id;
  if (route.kind !== 'list') return false;
  switch (route.list) {
    case 'inbox':
      return inInbox(todo);
    case 'today':
      return inToday(todo, ref);
    case 'scheduled':
      return inScheduled(todo, ref);
    case 'unscheduled':
      return inUnscheduled(todo, projects, ref);
    case 'deferred':
      return inDeferred(todo);
    default:
      return false;
  }
}
