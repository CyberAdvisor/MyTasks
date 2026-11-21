/**
 * The to-do right-click menu's items (FR-1.7), in order. Pure, so
 * each situation is easy to test; RowMenu.svelte draws the items and runs
 * the actions.
 *
 * Left out, as a web app cannot offer them: Ask Siri, Shortcuts, Share…
 * (Section 11) and Services.
 */
import type { Todo } from './types';

export type TodoMenuAction =
  | 'when'
  | 'move'
  | 'complete'
  | 'tags'
  | 'deadline'
  | 'info'
  | 'duplicate'
  | 'convert'
  | 'delete'
  | 'remove'
  | 'show'
  | 'move-to-completed'
  | 'reset-others'
  | 'put-back'
  | 'delete-forever'
  | 'repeat'
  | 'edit-rule'
  | 'pause'
  | 'resume'
  | 'stop'
  | 'show-previous'
  | 'create-next';

/** Submenus open beside the menu. */
export type TodoSubmenu = 'priority' | 'context' | 'complete' | 'repeat';

export type TodoMenuItem =
  | { kind: 'action'; action: TodoMenuAction; label: string; disabled?: boolean }
  | { kind: 'submenu'; submenu: TodoSubmenu; label: string }
  | { kind: 'separator' };

/** Where the menu was opened. */
interface TodoMenuContext {
  /** The row's list: an open list, Completed, or Trash. */
  mode: 'open' | 'logbook' | 'trash';
  /** The to-do's project or area page, when it is not the page being shown (Show in …). */
  link: 'project' | 'area' | null;
  /** Whether the current view has completed items waiting to move (FR-12.2). */
  waiting: boolean;
  /** Whether other tasks of its sequential project are in Today (FR-17.6). */
  resetOthers?: boolean;
}

const action = (a: TodoMenuAction, label: string, disabled = false): TodoMenuItem =>
  disabled ? { kind: 'action', action: a, label, disabled } : { kind: 'action', action: a, label };
const SEP: TodoMenuItem = { kind: 'separator' };

/**
 * The menu for `todo` opened in `ctx`. A repeating task's template has no
 * Start Date… or Deadline…, since its rule sets them, nor Convert to
 * Project… (the repeat would be lost; review C4), and adds a Repeat
 * submenu after Complete, whose choices complete or skip its next copy early
 * (FR-4.4); any other open task offers Repeat… (FR-4.1).
 */
export function todoMenuItems(todo: Pick<Todo, 'projectId' | 'areaId'> & Partial<Pick<Todo, 'repeat'>>, ctx: TodoMenuContext): TodoMenuItem[] {
  if (ctx.mode === 'trash') return [action('put-back', 'Put Back'), SEP, action('delete-forever', 'Delete Immediately…')];
  const template = !!todo.repeat;
  const items: TodoMenuItem[] = [
    ...(template ? [] : [action('when', 'Start Date…')]),
    action('move', 'Move…'),
    action('tags', 'Tags…'),
    ...(template ? [] : [action('deadline', 'Deadline…')]),
    { kind: 'submenu', submenu: 'priority', label: 'Priority' },
    { kind: 'submenu', submenu: 'context', label: 'Context' },
    { kind: 'submenu', submenu: 'complete', label: 'Complete' },
    ...(template ? [{ kind: 'submenu', submenu: 'repeat', label: 'Repeat' } as TodoMenuItem] : []),
    ...(template || ctx.mode !== 'open' ? [] : [action('repeat', 'Repeat…')]),
    SEP,
    action('info', 'Get Info'),
    action('duplicate', 'Duplicate Task'),
    ...(template ? [] : [action('convert', 'Convert to Project…')]),
    action('delete', 'Delete Task'),
  ];
  const container = todo.projectId ? 'Project' : todo.areaId ? 'Area' : null;
  if (container) items.push(SEP, action('remove', `Remove From ${container}`));
  if (ctx.resetOthers) items.push(action('reset-others', 'Reset Other Tasks…'));
  items.push(SEP);
  if (ctx.link) items.push(action('show', `Show in ${ctx.link === 'project' ? 'Project' : 'Area'}`));
  items.push(action('move-to-completed', 'Move Completed Items', !ctx.waiting));
  return items;
}

/**
 * The menu for several selected tasks (FR-10.1): the commands
 * that make sense for all of them at once, with counts in the labels. Get
 * Info, Convert to Project, Show in… and Reset Other Tasks… are left out.
 * Remove From Project (or Area) shows when every task is in one.
 */
export function severalMenuItems(todos: Pick<Todo, 'projectId' | 'areaId'>[], ctx: Pick<TodoMenuContext, 'waiting'>): TodoMenuItem[] {
  const n = todos.length;
  const items: TodoMenuItem[] = [
    action('when', 'Start Date…'),
    action('move', 'Move…'),
    action('tags', 'Tags…'),
    action('deadline', 'Deadline…'),
    { kind: 'submenu', submenu: 'priority', label: 'Priority' },
    { kind: 'submenu', submenu: 'context', label: 'Context' },
    { kind: 'submenu', submenu: 'complete', label: 'Complete' },
    SEP,
    action('duplicate', `Duplicate ${n} Tasks`),
    action('delete', `Delete ${n} Tasks`),
  ];
  const container = todos.every((t) => t.projectId) ? 'Project' : todos.every((t) => t.areaId && !t.projectId) ? 'Area' : null;
  if (container) items.push(SEP, action('remove', `Remove From ${container}`));
  items.push(SEP, action('move-to-completed', 'Move Completed Items', !ctx.waiting));
  return items;
}

/**
 * The ⋯ menu of Select mode on touch (FR-10.2): what
 * the floating bar has no room for. Mark as Completed reopens instead when
 * every selected task is already done.
 */
export function selectModeMenuItems(statuses: Todo['status'][]): TodoMenuItem[] {
  const allDone = statuses.length > 0 && statuses.every((s) => s !== 'open');
  return [
    { kind: 'submenu', submenu: 'priority', label: 'Priority' },
    { kind: 'submenu', submenu: 'context', label: 'Context' },
    action('tags', 'Tags…'),
    action('deadline', 'Deadline…'),
    SEP,
    action('complete', allDone ? 'Mark as Open' : 'Mark as Completed'),
    action('duplicate', 'Duplicate'),
  ];
}

/**
 * A template's Repeat submenu (FR-4.4): Edit Rule…; Show
 * Previous Copy and Create Next Copy; Pause or Resume, and Stop….
 */
export function repeatSubmenuItems(paused: boolean): TodoMenuItem[] {
  return [
    action('edit-rule', 'Edit Rule…'),
    SEP,
    action('show-previous', 'Show Previous Copy'),
    action('create-next', 'Create Next Copy'),
    SEP,
    paused ? action('resume', 'Resume') : action('pause', 'Pause'),
    action('stop', 'Stop…'),
  ];
}

/**
 * The Complete submenu for several tasks: their shared status's choices, or
 * all three when they differ.
 */
export function completeChoicesFor(statuses: Todo['status'][]): { status: Todo['status']; label: string }[] {
  if (statuses.every((s) => s === statuses[0])) return completeChoices(statuses[0]);
  return [
    { status: 'open', label: 'Mark as Open' },
    { status: 'completed', label: 'Mark as Completed' },
    { status: 'canceled', label: 'Mark as Canceled' },
  ];
}

/** The Complete submenu: what the to-do can become from its current status. */
export function completeChoices(status: Todo['status']): { status: Todo['status']; label: string }[] {
  if (status === 'open') {
    return [
      { status: 'completed', label: 'Mark as Completed' },
      { status: 'canceled', label: 'Mark as Canceled' },
    ];
  }
  return [
    { status: 'open', label: 'Mark as Open' },
    status === 'completed'
      ? { status: 'canceled', label: 'Mark as Canceled' }
      : { status: 'completed', label: 'Mark as Completed' },
  ];
}
