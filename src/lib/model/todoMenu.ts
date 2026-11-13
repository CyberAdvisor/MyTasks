/**
 * The to-do right-click menu's items (FR-1.7), in Things' order. Pure, so
 * each situation is easy to test; RowMenu.svelte draws the items and runs
 * the actions.
 *
 * Left out, as a web app cannot offer them: Ask Siri, Shortcuts, Share…
 * (Section 11) and Services. Added to Things: Priority and Context.
 * Things' Log Completed is named Move to Completed here.
 */
import type { Todo } from './types';

export type TodoMenuAction =
  | 'when'
  | 'move'
  | 'tags'
  | 'deadline'
  | 'info'
  | 'duplicate'
  | 'convert'
  | 'delete'
  | 'remove'
  | 'show'
  | 'move-to-completed'
  | 'put-back'
  | 'delete-forever';

/** Submenus open beside the menu. */
export type TodoSubmenu = 'priority' | 'context' | 'complete';

export type TodoMenuItem =
  | { kind: 'action'; action: TodoMenuAction; label: string; disabled?: boolean }
  | { kind: 'submenu'; submenu: TodoSubmenu; label: string }
  | { kind: 'separator' };

/** Where the menu was opened. */
export interface TodoMenuContext {
  /** The row's list: an open list, Completed, or Trash. */
  mode: 'open' | 'logbook' | 'trash';
  /** The to-do's project or area page, when it is not the page being shown (Show in …). */
  link: 'project' | 'area' | null;
  /** Whether the current view has completed items waiting to move (FR-12.2). */
  waiting: boolean;
}

const action = (a: TodoMenuAction, label: string, disabled = false): TodoMenuItem =>
  disabled ? { kind: 'action', action: a, label, disabled } : { kind: 'action', action: a, label };
const SEP: TodoMenuItem = { kind: 'separator' };

/** The menu for `todo` opened in `ctx`. */
export function todoMenuItems(todo: Pick<Todo, 'projectId' | 'areaId'>, ctx: TodoMenuContext): TodoMenuItem[] {
  if (ctx.mode === 'trash') return [action('put-back', 'Put Back'), SEP, action('delete-forever', 'Delete Immediately…')];
  const items: TodoMenuItem[] = [
    action('when', 'When…'),
    action('move', 'Move…'),
    action('tags', 'Tags…'),
    action('deadline', 'Deadline…'),
    { kind: 'submenu', submenu: 'priority', label: 'Priority' },
    { kind: 'submenu', submenu: 'context', label: 'Context' },
    { kind: 'submenu', submenu: 'complete', label: 'Complete' },
    SEP,
    action('info', 'Get Info'),
    action('duplicate', 'Duplicate Task'),
    action('convert', 'Convert to Project…'),
    action('delete', 'Delete Task'),
  ];
  const container = todo.projectId ? 'Project' : todo.areaId ? 'Area' : null;
  if (container) items.push(SEP, action('remove', `Remove From ${container}`));
  items.push(SEP);
  if (ctx.link) items.push(action('show', `Show in ${ctx.link === 'project' ? 'Project' : 'Area'}`));
  items.push(action('move-to-completed', 'Move to Completed', !ctx.waiting));
  return items;
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
