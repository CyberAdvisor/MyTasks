/**
 * UI-level actions that combine routing, today's date and data operations.
 */
import { get } from 'svelte/store';
import { rowLimit } from './state/rowLimit.svelte';
import * as repo from './db/repo';
import * as bulk from './bulk';
import { db } from './db/database';
import { undoGroup } from './db/history';
import { zoneOf } from './drag/drag';
import { orderWith } from './drag/plan';
import { addDays, today } from './model/dates';
import { inInbox, inScheduled, inToday, isClosed, isLogged, isOpen, projectIndex, type BuiltInList, type WaitingItems } from './model/lists';
import { addedTo, shownIn } from './model/whereItWent';
import { outsideFocus, todoInFocus } from './model/focus';
import { setFocus } from './state/focus';
import type { ID, LocalDate, Todo } from './model/types';
import type { ProjectRepeatAction } from './model/sidebarMenu';
import { TodoDraft, type DraftStart } from './state/draft.svelte';
import { focusedArea, fullSnapshot, snapshot } from './state/live';
import { go, hrefFor, route, type Route } from './state/route';
import { ui } from './state/ui.svelte';

/**
 * Where a new to-do starts when Quick Entry is opened from a view (FR-10.5):
 * in that project, area or list. Other views start in the Inbox. While an area
 * is focused (FR-22.1), one made in Today, Scheduled, Unscheduled or Deferred
 * goes in that area, so it stays on screen; the Inbox stays the Inbox.
 */
export function draftStartFor(r: Route, ref: LocalDate, focus: ID | null = get(focusedArea)): DraftStart {
  if (r.kind === 'project') return { placement: { projectId: r.id } };
  if (r.kind === 'area') return { placement: { areaId: r.id } };
  if (r.kind !== 'list') return {};
  const inFocus = focus ? { placement: { areaId: focus } } : {};
  if (r.list === 'today') return { ...inFocus, startDate: ref };
  if (r.list === 'scheduled') return { ...inFocus, startDate: addDays(ref, 1) };
  if (r.list === 'unscheduled') return { ...inFocus, start: 'unscheduled' };
  if (r.list === 'deferred') return { ...inFocus, deferred: true };
  return {};
}

/**
 * Fields for a to-do created inline in view `r` (FR-1.1): the view's own
 * start, as for Quick Entry, but in the same container (and, in Scheduled,
 * on the same day) as the selected to-do.
 */
export function inlineStart(r: Route, ref: LocalDate, selected?: Todo): repo.NewTodo {
  const { placement, ...when } = draftStartFor(r, ref);
  const opts: repo.NewTodo = { ...placement, ...when };
  if (!selected) return opts;
  opts.projectId = selected.projectId;
  opts.areaId = selected.areaId;
  opts.headingId = selected.headingId;
  if (r.kind === 'list' && r.list === 'scheduled') opts.startDate = selected.startDate;
  return opts;
}

/**
 * New To-Do from the keyboard (FR-1.1): add a to-do below the selected row,
 * or at the end of Today, and open it with the title focused. Views without
 * a list of their own (search results) open Quick Entry instead.
 *
 * Creating the to-do takes a moment, so keys typed meanwhile are collected
 * (`ui.typeAhead`) and the card puts them in the title.
 */
export async function newTodoInline(r: Route, ref: LocalDate): Promise<void> {
  if (!canAddHere(r)) return;
  if (r.kind !== 'list' && r.kind !== 'project' && r.kind !== 'area') {
    openQuickEntry(draftStartFor(r, ref));
    return;
  }
  ui.typeAhead = '';
  try {
    ui.open(await createInline(r, ref));
  } catch (err) {
    ui.typeAhead = null;
    throw err;
  }
}

/** Create the keyboard's new to-do and place it below the selected row (or at the end of Today). */
async function createInline(r: Route, ref: LocalDate): Promise<ID> {
  rowLimit.drawAll(); // a new task goes after the list's last row, drawn or not (NFR-7)
  const selected = get(snapshot).todos.find((t) => t.id === ui.selectedId && isOpen(t));
  const rows = document.querySelectorAll('main [data-row-id]');
  const anchor = selected
    ? document.querySelector(`main [data-row-id="${CSS.escape(selected.id)}"]`)
    : r.kind === 'list' && r.list === 'today'
      ? rows[rows.length - 1]
      : null;
  const zone = anchor ? zoneOf(anchor, 'todo') : null;
  return undoGroup(async () => {
    const newId = await repo.createTodo(inlineStart(r, ref, selected));
    if (zone) {
      const after = zone.ids.indexOf((anchor as HTMLElement).dataset.rowId!);
      await zone.zone.drop(newId, orderWith(zone.ids, newId, after + 1));
    }
    return newId;
  });
}

/**
 * Empty the Trash (FR-12.3). It is final, so an Undo toast still showing
 * from an earlier change is hidden: there is nothing left for it to undo.
 */
export async function emptyTrash(): Promise<void> {
  await repo.emptyTrash();
  ui.dismissUndo();
}

/** Delete one to-do in the Trash permanently (Delete Immediately, FR-1.7); final, like Empty Trash. */
export async function deleteTodoForever(id: ID): Promise<void> {
  await repo.deleteTodoForever(id);
  ui.dismissUndo();
}

/**
 * Focus on an area, or leave the focus when it is the one focused (the area
 * menus' Focus on this Area / Leave Focus, FR-22.1). Focusing from a page
 * outside the area opens the area first, since that page would be left empty.
 */
export function toggleAreaFocus(areaId: ID): void {
  if (get(focusedArea) === areaId) return setFocus(null);
  const s = get(fullSnapshot);
  if (outsideFocus(s, areaId, get(route))) go({ kind: 'area', id: areaId });
  setFocus(areaId);
}

/** Open Quick Entry with a fresh draft (FR-8.1). */
export function openQuickEntry(start: DraftStart = {}): void {
  ui.draft = new TodoDraft(start);
}

/** Store the Quick Entry draft, close the panel and select the new to-do. */
export async function saveDraft(): Promise<void> {
  const draft = ui.draft;
  if (!draft) return;
  ui.draft = null;
  let id: ID;
  try {
    id = await repo.createTodo(draft.toNewTodo());
  } catch (e) {
    ui.draft = draft; // keep what was typed; the refusal or failure (main.ts) shows over it
    throw e;
  }
  ui.selectedId = id;
  await sayWhereAdded(id);
}

/**
 * A new task the view on screen can't list would vanish without a word: say
 * where it went, with Show (FR-1.10).
 */
async function sayWhereAdded(id: ID): Promise<void> {
  const todo = await db.todos.get(id);
  if (!todo) return;
  const ref = today();
  const s = get(fullSnapshot);
  const projects = projectIndex(s.projects);
  const focus = get(focusedArea);
  // A task outside the focus (FR-22.1) can't show, whatever the list.
  if ((!focus || todoInFocus(todo, focus, projects)) && shownIn(todo, get(route), ref, projects)) return;
  const container = todo.projectId ? await db.projects.get(todo.projectId) : todo.areaId ? await db.areas.get(todo.areaId) : undefined;
  const added = addedTo(todo, ref, container?.title);
  ui.showWhere(added.message, added.where);
}

/** The view a to-do lives in: its project or area, else the list it shows in. */
export function homeOf(todo: Todo, ref: LocalDate): Route {
  const list = (l: BuiltInList): Route => ({ kind: 'list', list: l });
  if (todo.trashedAt) return list('trash');
  // A closed to-do still waiting to move to Completed is found where it was.
  if (isLogged(todo)) return list('logbook');
  if (todo.projectId) return { kind: 'project', id: todo.projectId };
  if (todo.areaId) return { kind: 'area', id: todo.areaId };
  if (inInbox(todo)) return list('inbox');
  if (inToday(todo, ref)) return list('today');
  if (inScheduled(todo, ref)) return list('scheduled');
  if (todo.start === 'deferred') return list('deferred');
  return list('unscheduled');
}

/**
 * Show a to-do where it lives: go to its view, select it and, if it is open,
 * open its card (Quick Find, FR-9.1).
 */
export function revealTodo(todo: Todo, current: Route, ref: LocalDate): void {
  const target = homeOf(todo, ref);
  ui.revealNext(todo.id, !isClosed(todo));
  if (hrefFor(target) === hrefFor(current)) ui.enterView();
  else go(target);
}

/**
 * The project or area page an open card links to (FR-1.2): the to-do's
 * container, or null when it has none or that page is already showing.
 */
export function containerLink(todo: Todo, current: Route): Extract<Route, { kind: 'project' | 'area' }> | null {
  const target: Extract<Route, { kind: 'project' | 'area' }> | null = todo.projectId
    ? { kind: 'project', id: todo.projectId }
    : todo.areaId
      ? { kind: 'area', id: todo.areaId }
      : null;
  return target && hrefFor(target) !== hrefFor(current) ? target : null;
}

/** Go to a to-do's project or area page with the to-do selected (Go to Project). */
export function goToContainer(todo: Todo, current: Route): void {
  const target = containerLink(todo, current);
  if (!target) return;
  ui.close();
  ui.revealNext(todo.id, false);
  go(target);
}

/** Add an empty heading at the end of a project and focus its title (FR-2.4). */
export async function newHeading(projectId: string): Promise<void> {
  ui.newHeadingId = await repo.createHeading(projectId, '');
}

/** Whether the current view accepts new to-dos (Completed, Trash and Settings do not). */
export function canAddHere(r: Route): boolean {
  if (r.kind === 'settings') return false;
  return !(r.kind === 'list' && (r.list === 'logbook' || r.list === 'trash'));
}

/** Move a view's waiting completed items to Completed now (FR-12.2). Undoable. */
export async function moveWaiting(items: WaitingItems): Promise<void> {
  await repo.moveToCompleted(items);
  ui.offerUndo('Moved to Completed');
}

/** Move a to-do to Trash, with the Undo toast on touch (FR-1.5, FR-1.6). */
export async function trashTodo(id: ID): Promise<void> {
  if (ui.expandedId === id) ui.close();
  await repo.setTodoTrashed(id, true);
  ui.offerUndo('Moved to Trash');
}

/** Move several selected tasks to the Trash at once, as one undo step (FR-10.1). */
export async function trashTodos(ids: ID[]): Promise<void> {
  if (ids.length === 1) return trashTodo(ids[0]);
  if (ui.expandedId && ids.includes(ui.expandedId)) ui.close();
  ui.selectedId = null;
  await bulk.trash(ids);
  ui.offerUndo(`Moved ${ids.length} tasks to Trash`);
}

/** Turn a to-do into a project and open the project (FR-1.5). */
export async function convertTodo(id: ID): Promise<void> {
  const projectId = await repo.convertTodoToProject(id);
  ui.close();
  if (projectId) go({ kind: 'project', id: projectId });
}

// ---------------------------------------------------------------------------
// Project, area and saved search commands, shared by each page's ⋯ menu and
// the sidebar's right-click menu (SidebarMenu.svelte).
// ---------------------------------------------------------------------------

/** After deleting an item, leave its page if it is the one showing. */
function leaveIfShowing(gone: Route): void {
  if (hrefFor(get(route)) === hrefFor(gone)) go({ kind: 'list', list: 'today' });
}

/** Duplicate a project (FR-1.5) and open the copy. */
export async function duplicateProject(id: ID): Promise<void> {
  const copyId = await repo.duplicateProject(id);
  if (copyId) go({ kind: 'project', id: copyId });
}

/** Move a project to Trash, with the Undo toast on touch. */
export async function trashProject(id: ID): Promise<void> {
  await repo.setProjectTrashed(id, true);
  leaveIfShowing({ kind: 'project', id });
  ui.offerUndo('Moved to Trash');
}

/**
 * Delete Project: a repeating project's template asks first
 * (FR-4.6); copies already made stay. Any other project goes to the Trash.
 */
export async function deleteProject(id: ID): Promise<void> {
  if ((await db.projects.get(id))?.repeat) ui.projectConfirm = { kind: 'delete', id };
  else await trashProject(id);
}

/**
 * A command of a repeating project's Repeat › submenu, or of its template
 * banner (FR-4.6). Show Previous Copy and Create Next Copy open the copy;
 * Stop… asks first.
 */
export async function projectRepeatAction(id: ID, action: ProjectRepeatAction): Promise<void> {
  switch (action) {
    case 'edit-rule':
      ui.repeating = { kind: 'project', id };
      return;
    case 'pause':
    case 'resume':
      return repo.setProjectRepeatPaused(id, action === 'pause');
    case 'stop':
      ui.projectConfirm = { kind: 'stop', id };
      return;
    case 'create-next':
    case 'show-previous': {
      const copy = action === 'create-next' ? await repo.createNextProjectCopy(id) : (await repo.previousProjectCopy(id))?.id;
      if (copy) go({ kind: 'project', id: copy });
    }
  }
}

/** Create a project in an area and open it (FR-2.5). */
export async function newProjectInArea(areaId: ID): Promise<void> {
  go({ kind: 'project', id: await repo.createProject({ areaId }) });
}

/** Delete an area, keeping its projects and tasks or moving them to Trash (FR-2.5). */
export async function deleteArea(id: ID, contents: 'keep' | 'trash'): Promise<void> {
  await repo.deleteArea(id, contents);
  leaveIfShowing({ kind: 'area', id });
  ui.offerUndo('Area deleted');
}

/** Delete a saved search (FR-15.5); tasks are not changed. */
export async function deleteSavedSearch(id: ID): Promise<void> {
  await repo.deleteSavedSearch(id);
  leaveIfShowing({ kind: 'saved', id });
  // Undo, as after deleting a project, an area or a heading (review F5).
  ui.offerUndo('Saved search deleted');
}

// ---------------------------------------------------------------------------
// Changes to several tasks that a repeating project's template asks about
// (FR-4.6): giving a template's task a date or a deadline, or closing it,
// asks "Create Copy Now?" (ui.guardTemplate) and puts the change on the
// next copy. Every other change, and these on other tasks, run at once.
// ---------------------------------------------------------------------------

/** A When choice, for one task or several (bulk.setWhen); a date asks first on a template's task. */
export function changeWhen(ids: ID[], choice: repo.WhenChoice): Promise<void> {
  const dates = choice.kind === 'today' || choice.kind === 'date';
  return dates ? ui.guardTemplate(ids, (x) => bulk.setWhen(x, choice)) : bulk.setWhen(ids, choice);
}

/** A deadline, for one task or several (bulk.setDeadline); setting one asks first on a template's task. */
export function changeDeadline(ids: ID[], deadline: LocalDate | null, moveWhen: boolean): Promise<void> {
  const change = (x: ID[]) => bulk.setDeadline(x, deadline, moveWhen);
  return deadline ? ui.guardTemplate(ids, change) : change(ids);
}

/** Set or clear the reminder of one or several tasks (FR-3.8). */
export function changeReminder(ids: ID[], reminder: string | null): Promise<void> {
  return bulk.setReminder(ids, reminder);
}

/** Complete, cancel or reopen tasks at once (bulk.setStatus); closing asks first on a template's task. */
export function changeStatus(ids: ID[], status: Todo['status']): Promise<void> {
  const change = (x: ID[]) => bulk.setStatus(x, status);
  return status === 'open' ? change(ids) : ui.guardTemplate(ids, change);
}
