/**
 * The menus of projects, areas and saved searches: one list per kind, drawn
 * both as the sidebar's right-click menu (SidebarMenu.svelte) and as the
 * page's ⋯ menu (ProjectView, AreaView, SearchView), so the two always match
 * (review C8, F4; since 1.3.9). The page's menu adds only Select (touch
 * screens) before it and, for a project on phones, Add Heading after it.
 * Pure, so each case is easy to test; MenuItems.svelte draws the items.
 *
 * "…" marks an item that asks for something more before it acts (a picker,
 * a dialog, the print dialog).
 *
 * Left out: Open in New Window and Share… (Section 11). The
 * built-in lists have no right-click menu: their commands are on their pages
 * (decided 2026-11-14, conversation 2026-11-14-C).
 */
import type { ID, Project } from './types';

/** A sidebar item that has a right-click menu. */
export type SidebarTarget =
  | { kind: 'project'; id: ID }
  | { kind: 'area'; id: ID }
  | { kind: 'saved'; id: ID };

export type SidebarMenuAction =
  | 'complete'
  | 'reopen'
  | 'when'
  | 'tags'
  | 'deadline'
  | 'repeat'
  | 'repeat-menu'
  | ProjectRepeatAction
  | 'move'
  | 'duplicate'
  | 'sort-by-date'
  | 'new-project'
  | 'focus'
  | 'move-to-completed'
  | 'edit-search'
  | 'print'
  | 'delete';

/** The commands of a repeating project's Repeat › submenu (FR-4.6). */
export type ProjectRepeatAction = 'edit-rule' | 'create-next' | 'show-previous' | 'pause' | 'resume' | 'stop';

export type SidebarMenuItem =
  | {
      kind: 'action';
      action: SidebarMenuAction;
      label: string;
      /** The Icon shown before the label in the page's ⋯ menu. */
      icon: MenuIcon;
      disabled?: boolean;
      danger?: boolean;
      checked?: boolean;
      /** Opens a submenu in the menu's place (Repeat ›), drawn with a ›. */
      submenu?: boolean;
    }
  | { kind: 'separator' };

/** What the menu depends on, beyond the item itself. */
interface SidebarMenuContext {
  /** The project's status (projects only). */
  status?: Project['status'];
  /** Whether the project or area has tags (Edit Tags rather than Add Tags). */
  hasTags?: boolean;
  /** Whether the project has a deadline (Change Deadline rather than Add Deadline). */
  hasDeadline?: boolean;
  /** Whether the item has completed items waiting to move to Completed (FR-12.2). */
  waiting?: boolean;
  /** Whether the project sorts its tasks by date (FR-2.8). */
  sortByDate?: boolean;
  /** Whether the area is the one focused on (Leave Focus rather than Focus on this Area, FR-22.1). */
  focused?: boolean;
  /** Whether the project is a repeating project's template (FR-4.6). */
  template?: boolean;
}

/** Icons the menus use (names from Icon.svelte). */
type MenuIcon =
  | 'check'
  | 'calendar'
  | 'tag'
  | 'flag'
  | 'move'
  | 'copy'
  | 'logbook'
  | 'printer'
  | 'trash'
  | 'project'
  | 'focus'
  | 'pencil'
  | 'repeat'
  | 'plus'
  | 'search'
  | 'none';

const ICONS: Record<SidebarMenuAction, MenuIcon> = {
  complete: 'check',
  reopen: 'check',
  when: 'calendar',
  tags: 'tag',
  deadline: 'flag',
  repeat: 'repeat',
  'repeat-menu': 'repeat',
  'edit-rule': 'pencil',
  'show-previous': 'search',
  'create-next': 'plus',
  pause: 'none',
  resume: 'none',
  stop: 'none',
  move: 'move',
  duplicate: 'copy',
  // A setting: its check mark shows when on, a blank space when off.
  'sort-by-date': 'none',
  'new-project': 'project',
  focus: 'focus',
  'move-to-completed': 'logbook',
  'edit-search': 'pencil',
  print: 'printer',
  delete: 'trash',
};

const SEP: SidebarMenuItem = { kind: 'separator' };

function item(
  action: SidebarMenuAction,
  label: string,
  opts: { disabled?: boolean; danger?: boolean; checked?: boolean; submenu?: boolean } = {},
): SidebarMenuItem {
  return {
    kind: 'action',
    action,
    label,
    icon: ICONS[action],
    ...(opts.disabled ? { disabled: true } : {}),
    ...(opts.danger ? { danger: true } : {}),
    ...(opts.checked !== undefined ? { checked: opts.checked } : {}),
    ...(opts.submenu ? { submenu: true } : {}),
  };
}

/** The menu for `target`. */
export function sidebarMenuItems(target: SidebarTarget, ctx: SidebarMenuContext = {}): SidebarMenuItem[] {
  const moveToCompleted = item('move-to-completed', 'Move Completed Items', { disabled: !ctx.waiting });
  const tags = item('tags', ctx.hasTags ? 'Edit Tags…' : 'Add Tags…');
  const print = item('print', 'Print…');
  switch (target.kind) {
    case 'project':
      // A repeating project's template (FR-4.6): its date is its
      // next copy's, so no Start Date…; not duplicated; Repeat › for its commands.
      return [
        ctx.status === 'open' ? item('complete', 'Complete Project') : item('reopen', 'Reopen Project'),
        ...(ctx.template ? [] : [item('when', 'Start Date…')]),
        tags,
        item('deadline', ctx.hasDeadline ? 'Change Deadline…' : 'Add Deadline…'),
        ...(ctx.template ? [item('repeat-menu', 'Repeat', { submenu: true })] : ctx.status === 'open' ? [item('repeat', 'Repeat…')] : []),
        SEP,
        item('move', 'Move…'),
        ...(ctx.template ? [] : [item('duplicate', 'Duplicate Project')]),
        item('sort-by-date', 'Sort by Date', { checked: !!ctx.sortByDate }),
        moveToCompleted,
        print,
        SEP,
        item('delete', 'Delete Project', { danger: true }),
      ];
    case 'area':
      return [
        tags,
        item('new-project', 'New Project'),
        item('focus', ctx.focused ? 'Leave Focus' : 'Focus on this Area'),
        moveToCompleted,
        print,
        SEP,
        item('delete', 'Delete Area…', { danger: true }),
      ];
    case 'saved':
      return [item('edit-search', 'Edit Search…'), print, SEP, item('delete', 'Delete…', { danger: true })];
  }
}

/**
 * A repeating project's Repeat › submenu (FR-4.6), the same commands as a
 * repeating task's (FR-4.4): Edit Rule…; Show Previous Copy and Create Next
 * Copy; Pause or Resume, and Stop….
 */
export function projectRepeatItems(paused: boolean): SidebarMenuItem[] {
  return [
    item('edit-rule', 'Edit Rule…'),
    SEP,
    item('show-previous', 'Show Previous Copy'),
    item('create-next', 'Create Next Copy'),
    SEP,
    paused ? item('resume', 'Resume') : item('pause', 'Pause'),
    item('stop', 'Stop…'),
  ];
}
