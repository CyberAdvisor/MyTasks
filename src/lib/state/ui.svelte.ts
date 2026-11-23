/**
 * UI state shared across components. None of it is in the database; only
 * the hidden-sidebar flag is remembered, per device.
 */
import { onHide } from './onHide';
import { rowLimit } from './rowLimit.svelte';
import * as repo from '../db/repo';
import { db } from '../db/database';
import { canUndo, onTodosChanged, redo, undo, undoGroup } from '../db/history';
import { today } from '../model/dates';
import { combineWhere, whereItWent, type WhereItWent } from '../model/whereItWent';
import { go, type Route } from './route';
import { get } from 'svelte/store';
import { untrack } from 'svelte';
import { inInbox } from '../model/lists';
import { fullSnapshot } from './live';
import { holdInInbox, inboxShown, openHold } from './held';
import { readFlag, writeFlag } from './flags';
import type { ID, Todo } from '../model/types';
import type { TodoDraft } from './draft.svelte';
import type { SidebarTarget } from '../model/sidebarMenu';
import type { TodoSubmenu } from '../model/todoMenu';
import { NO_SELECTION, single, type Selection } from '../model/selection';

/** What the Repeat dialog is open for: a task (FR-4.1) or a project (FR-4.6). */
export interface RepeatTarget {
  kind: 'todo' | 'project';
  id: ID;
}

/** How long a completed row stays visible before it leaves the list (FR-1.3). */
const COMPLETE_DELAY_MS = 2000;

/** How long the Undo toast stays up. */
const TOAST_MS = 5000;

/** A picker or field the open card should show at once (keyboard commands, Section 7). */
export type CardCommand = 'when' | 'deadline' | 'tags' | 'checklist';

const SIDEBAR_KEY = 'mytasks.sidebarHidden';

class UiState {
  private openId = $state<ID | null>(null);
  /** Changes made while a card was open, kept to say where the task went when it closes. */
  private whereWaiting = new Map<ID, Todo>();

  /**
   * The to-do whose card is open, if any. While it's open the task is held
   * where it was in the lists (src/lib/model/hold.ts); closing it lets the
   * task move and says where it went (FR-1.10).
   */
  get expandedId(): ID | null {
    return this.openId;
  }
  set expandedId(id: ID | null) {
    // Read without tracking: callers such as App's view effect must not come
    // to depend on the open card.
    const was = untrack(() => this.openId);
    if (id === was) return;
    this.openId = id;
    const task = id ? get(fullSnapshot).todos.find((t) => t.id === id) : undefined;
    openHold.set(task ?? null);
    // A task just made (New Task) isn't in the live view yet: read it.
    if (id && !task) {
      void db.todos.get(id).then((t) => {
        if (t && untrack(() => this.openId) === id && get(openHold) === null) openHold.set(t);
      });
    }
    const waiting = was ? this.whereWaiting.get(was) : undefined;
    if (was) this.whereWaiting.delete(was);
    if (waiting) void this.announceOne(waiting);
  }
  /** The selected rows (FR-10.1); see model/selection.ts. */
  selection = $state<Selection>(NO_SELECTION);
  /**
   * The row the keyboard is on: the one selected, or the last one chosen of
   * several. Setting it selects that row alone (or none).
   */
  get selectedId(): ID | null {
    return this.selection.active;
  }
  set selectedId(id: ID | null) {
    this.selection = single(id);
  }
  /** The selected ids as a set, so checking one row is quick with thousands of tasks (NFR-7). */
  private selectedSet = $derived(new Set(this.selection.ids));
  /** Whether a row is part of the selection. */
  isSelected(id: ID): boolean {
    return this.selectedSet.has(id);
  }
  /**
   * The selected tasks that still exist, in the order chosen. Read from the
   * selection rather than by checking every task (NFR-7).
   */
  selectedTodos(byId: ReadonlyMap<ID, Todo>): Todo[] {
    return this.selection.ids.flatMap((id) => byId.get(id) ?? []);
  }
  /** More than one row is selected: item commands act on all of them. */
  get multiple(): boolean {
    return this.selection.ids.length > 1;
  }
  /** Drop selected rows that are no longer on screen (`onScreen`, in screen order). */
  keepOnly(onScreen: ID[]): void {
    const s = this.selection;
    const ids = s.ids.filter((id) => onScreen.includes(id));
    if (ids.length === s.ids.length) return;
    const active = s.active && ids.includes(s.active) ? s.active : (ids[ids.length - 1] ?? null);
    const anchor = s.anchor && ids.includes(s.anchor) ? s.anchor : active;
    this.selection = { ids, active, anchor };
  }
  /**
   * Select mode on touch (FR-10.2): a tap selects or
   * deselects a row, and the floating bar acts on the selected tasks. It
   * stays on after an action, and ends with Done or on leaving the view.
   */
  selecting = $state(false);
  /** Start Select mode, with nothing selected and no task open. */
  startSelecting(): void {
    this.close();
    this.selection = NO_SELECTION;
    this.selecting = true;
  }
  /** End Select mode, clearing the selection. */
  stopSelecting(): void {
    this.selecting = false;
    this.selection = NO_SELECTION;
  }
  /** The task or project the Repeat dialog is open for (FR-4.1, FR-4.6). */
  repeating = $state<RepeatTarget | null>(null);
  /**
   * A change to a repeating project's template's tasks waiting for "Create
   * Copy Now?" (FR-4.6): the tasks, and the change to make on their copies.
   */
  copyNow = $state<{ ids: ID[]; change: (ids: ID[]) => Promise<unknown> } | null>(null);
  /** A repeating project waiting for Stop… or Delete Project to be confirmed (FR-4.6). */
  projectConfirm = $state<{ kind: 'stop' | 'delete'; id: ID } | null>(null);
  /** The tasks the Move dialog is open for: one, or the selected several (FR-10.1). */
  movingIds = $state<ID[] | null>(null);
  /** A heading just created, whose title should take focus. */
  newHeadingId = $state<ID | null>(null);
  /** Tag selected in the current view's tag bar (FR-6.3); reset on navigation. */
  tagFilter = $state<ID | null>(null);
  /** Rows checked off but not yet written, mapped to their pending status. */
  pending = $state<Record<ID, 'completed' | 'canceled'>>({});
  /** Quick Find is open (FR-9.1), starting with `findText`. */
  findOpen = $state(false);
  findText = $state('');
  /** The to-do being written in Quick Entry (FR-8.1), if it is open. */
  draft = $state<TodoDraft | null>(null);
  /** A row to scroll into view once it renders (after Quick Find opens it). */
  scrollId = $state<ID | null>(null);
  /** Picker for the open card to show once it renders. */
  cardCommand = $state<CardCommand | null>(null);
  /**
   * The to-do menu (FR-1.7), opened by right-click, the card's ⋯ or a tap on
   * a Trash row: the row, its list, where it opened, whether the keyboard
   * opened it (then its first item takes focus), and whether `x` is the
   * menu's right edge (under the card's ⋯) rather than its left.
   */
  rowMenu = $state<{
    id: ID;
    mode: 'open' | 'logbook' | 'trash';
    x: number;
    y: number;
    keyboard?: boolean;
    alignEnd?: boolean;
    /** A picker to show in place of the menu: for a keyboard command with several selected (FR-10.1), or Select mode's Start Date (FR-10.2). */
    panel?: 'when' | 'deadline' | 'tags';
    /** On a phone's sheet, a submenu to open with: the repeat line on a template's card (FR-4.4). */
    submenu?: TodoSubmenu;
  } | null>(null);
  /**
   * The sidebar's right-click menu: the item, where it opened, and whether
   * the keyboard opened it (then its first item takes focus).
   */
  sidebarMenu = $state<{ target: SidebarTarget; x: number; y: number; keyboard?: boolean } | null>(null);
  /** Keyboard Help is open (FR-7.1k). */
  helpOpen = $state(false);
  /** The sidebar is hidden on wider screens (Cmd/Ctrl+/); remembered. */
  sidebarHidden = $state(readFlag(SIDEBAR_KEY));
  /** Today's completed tasks hidden (Hide / Show by Today's ⋯). This device only, and shown again whenever the app opens. */
  hideCompleted = $state(false);
  /**
   * The toast: on touch devices, Undo after a destructive action (FR-1.6);
   * on every device, where a task went when it left the Inbox, with Show
   * (FR-1.10). `undo` shows the Undo button, `where` the Show button.
   */
  toast = $state<{ message: string; undo: boolean; where?: Route; at: number } | null>(null);
  /** Print… was chosen where the device can't print (FR-12.5); App shows why. */
  printUnavailable = $state(false);
  /** An add refused at the task limit (NFR-7): the count then, and how many it would have added. */
  limitRefused = $state<{ count: number; adding: number } | null>(null);
  /** A save that failed (review C1): App says so, with Reload. Null when none is showing. */
  saveFailed = $state<'storageFull' | 'database' | null>(null);
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  /** A to-do to select, and maybe open, once the next view has loaded. */
  private reveal: { id: ID; open: boolean } | null = null;
  /**
   * Keys typed after New To-Do, before its card's title has focus (FR-1.1);
   * null when not waiting. Not reactive: the key handler writes it and the
   * card takes it once (`takeTypeAhead`).
   */
  typeAhead: string | null = null;

  private timers = new Map<ID, ReturnType<typeof setTimeout>>();

  /** Open a to-do's card. */
  open(id: ID): void {
    this.expandedId = id;
    this.selectedId = id;
  }

  /** Return the keys typed after New Task and stop collecting them. */
  takeTypeAhead(): string {
    const text = this.typeAhead ?? '';
    this.typeAhead = null;
    return text;
  }

  /** Close any open card. */
  close(): void {
    this.expandedId = null;
  }

  /** Open a to-do's card showing one of its pickers. */
  openWith(id: ID, command: CardCommand): void {
    this.open(id);
    this.cardCommand = command;
  }

  /**
   * Show or hide the sidebar and remember the choice on this device:
   * Cmd+/, the iPad's sidebar button, dragging the edge
   * past its narrowest, or pulling it back from the window's left edge.
   */
  setSidebarHidden(hidden: boolean): void {
    this.sidebarHidden = hidden;
    writeFlag(SIDEBAR_KEY, hidden);
  }

  /** Show or hide the sidebar (Cmd+/ and the sidebar button). */
  toggleSidebar(): void {
    this.setSidebarHidden(!this.sidebarHidden);
  }

  /**
   * After a destructive change, offer Undo in a toast on touch devices, which
   * have no Cmd/Ctrl+Z and where web apps cannot use shake to undo. Desktop
   * uses the keyboard only.
   */
  offerUndo(message: string): void {
    if (!coarsePointer()) return;
    // The same change already said where the task went: keep that message.
    if (this.toast?.where && Date.now() - this.toast.at < 1000) {
      this.toast = { ...this.toast, undo: true };
      return;
    }
    this.showToast({ message, undo: true });
  }

  /**
   * Say where a task went when it left the Inbox, on every device, with Show
   * to open that list (when there is one place to show); touch devices also
   * offer Undo (FR-1.10).
   */
  showWhere(message: string, where?: Route): void {
    this.showToast({ message, undo: coarsePointer(), where });
  }

  /** Show the toast for TOAST_MS. */
  private showToast(t: { message: string; undo: boolean; where?: Route }): void {
    clearTimeout(this.toastTimer);
    this.toast = { ...t, at: Date.now() };
    this.toastTimer = setTimeout(() => (this.toast = null), TOAST_MS);
  }

  /**
   * After a change, find the tasks that left the Inbox and say where they
   * went (FR-1.10): one message, for several tasks too (FR-10.1).
   */
  async announceWhere(before: Todo[]): Promise<void> {
    const went: WhereItWent[] = [];
    for (const b of before) {
      // The open card's task waits until its card closes, as it was first.
      if (b.id === this.openId) {
        if (!this.whereWaiting.has(b.id)) this.whereWaiting.set(b.id, b);
        continue;
      }
      const w = await this.whereOne(b);
      if (w) went.push(w);
    }
    const message = combineWhere(went);
    if (message) this.showWhere(message.message, message.where);
  }

  /** Say where one task went (its card just closed). */
  private async announceOne(b: Todo): Promise<void> {
    const w = await this.whereOne(b);
    if (w) this.showWhere(w.message, w.where);
  }

  /**
   * Where one task went, if it left the Inbox. Out of the Inbox while the
   * Inbox is on screen, it stays listed there under "N tasks moved out of
   * the Inbox" instead, and there's nothing to say.
   */
  private async whereOne(b: Todo): Promise<WhereItWent | null> {
    const after = await db.todos.get(b.id);
    if (inboxShown() && inInbox(b) && after && !after.deletedAt && !after.trashedAt && !inInbox(after)) {
      holdInInbox(b);
      return null;
    }
    const area = after?.areaId ? await db.areas.get(after.areaId) : undefined;
    return whereItWent(b, after, today(), area?.title);
  }

  /** Hide the Undo toast, as after a change that cannot be undone, where its Undo would do nothing. */
  dismissUndo(): void {
    clearTimeout(this.toastTimer);
    this.toast = null;
  }

  /**
   * Undo the newest change (FR-1.6). A check-off still waiting to be written
   * is the newest change, so it is taken back first. On touch devices the
   * toast stays with Undo while earlier changes remain, so each tap goes one
   * step further back.
   */
  async undoLast(): Promise<void> {
    this.dismissUndo();
    const waiting = Object.keys(this.pending);
    if (waiting.length) return this.toggleDone(waiting[waiting.length - 1]);
    const result = await undo();
    if (result === 'stale') this.showStale('undo');
    else if (result === 'done' && coarsePointer() && canUndo()) this.showToast({ message: 'Undone', undo: true });
  }

  /** Redo the change undone last (FR-1.6). */
  async redoLast(): Promise<void> {
    this.dismissUndo();
    if ((await redo()) === 'stale') this.showStale('redo');
  }

  /** Say that a step was dropped because another device changed its tasks since (FR-1.6). */
  private showStale(what: 'undo' | 'redo'): void {
    this.showToast({ message: `Can't ${what}: changed on another device`, undo: false });
  }

  /** Open Quick Find, optionally with text already typed. */
  openFind(text = ''): void {
    this.findText = text;
    this.findOpen = true;
  }

  /** Ask for a to-do to be selected (and its card opened) when the next view shows. */
  revealNext(id: ID, open: boolean): void {
    this.reveal = { id, open };
  }

  /**
   * Reset per-view state after navigation, then select and scroll to any
   * to-do waiting to be revealed.
   */
  enterView(): void {
    rowLimit.reset();
    this.close();
    this.typeAhead = null;
    this.selecting = false;
    this.selectedId = null;
    this.tagFilter = null;
    const r = this.reveal;
    this.reveal = null;
    if (!r) return;
    this.selectedId = r.id;
    this.scrollId = r.id;
    if (r.open) this.expandedId = r.id;
  }

  /**
   * The checkbox of a row or card: check an open to-do off (`toggleDone`), or
   * reopen one that is completed and still waiting in its list (FR-12.2).
   */
  check(todo: Todo, status: 'completed' | 'canceled' = 'completed'): void {
    // A repeating task's template completes (or skips) its next copy at once; it stays open itself (FR-4.4).
    if (todo.repeat) void repo.setTodoStatus(todo.id, status);
    // A repeating project's template's task asks first, then closes its copy (FR-4.6).
    else if (todo.status === 'open' && this.inTemplate(todo)) this.copyNow = { ids: [todo.id], change: (ids) => this.closeAll(ids, status) };
    else if (todo.status === 'open') this.toggleDone(todo.id, status);
    else void repo.setTodoStatus(todo.id, 'open');
  }

  /** Whether `todo` is in a repeating project's template (FR-4.6). */
  private inTemplate(todo: Todo): boolean {
    return !!todo.projectId && !!get(fullSnapshot).projects.find((p) => p.id === todo.projectId)?.repeat;
  }

  /** Close tasks at once, one after another. */
  private async closeAll(ids: ID[], status: 'completed' | 'canceled'): Promise<void> {
    for (const id of ids) await repo.setTodoStatus(id, status);
  }

  /**
   * Make `change` to the tasks `ids`, unless some are in a repeating
   * project's template (FR-4.6): those wait for "Create Copy Now?", and the
   * change goes to their copies (answerCopyNow). The rest change at once.
   */
  async guardTemplate(ids: ID[], change: (ids: ID[]) => Promise<unknown>): Promise<void> {
    const inTemplate = new Set(await repo.templateTaskIds(ids));
    const rest = ids.filter((id) => !inTemplate.has(id));
    if (rest.length) await change(rest);
    if (inTemplate.size) this.copyNow = { ids: [...inTemplate], change };
  }

  /**
   * The answer to "Create Copy Now?": make the next copy, put the change on
   * its tasks, both as one undo step, and open the copy. The template stays
   * as it was. No: nothing changes.
   */
  async answerCopyNow(create: boolean): Promise<void> {
    const asked = this.copyNow;
    this.copyNow = null;
    if (!asked || !create) return;
    const made = await undoGroup(async () => {
      const copies = await repo.copyNowForTasks(asked.ids);
      if (copies.taskIds.length) await asked.change(copies.taskIds);
      return copies;
    });
    if (made.projectIds.length) go({ kind: 'project', id: made.projectIds[0] });
  }

  /**
   * Check a row off. It shows as done immediately and is written after a short
   * delay, so the user can see it and undo by clicking again (FR-1.3, FR-1.4).
   */
  toggleDone(id: ID, status: 'completed' | 'canceled' = 'completed'): void {
    if (this.pending[id]) {
      clearTimeout(this.timers.get(id));
      this.timers.delete(id);
      delete this.pending[id];
      return;
    }
    this.pending[id] = status;
    this.timers.set(
      id,
      setTimeout(() => this.commit(id), COMPLETE_DELAY_MS),
    );
  }

  /** Write one pending completion now. */
  private commit(id: ID): void {
    const status = this.pending[id];
    this.timers.delete(id);
    delete this.pending[id];
    if (status) void repo.setTodoStatus(id, status);
    if (this.expandedId === id) this.expandedId = null;
  }

  /** Write every pending completion immediately (e.g. when the app is hidden). */
  flush(): void {
    for (const [id, timer] of this.timers) {
      clearTimeout(timer);
      this.commit(id);
    }
  }
}

export const ui = new UiState();
onTodosChanged((before) => void ui.announceWhere(before));

/** A touch screen, where Undo needs a button (no Cmd/Ctrl+Z). */
function coarsePointer(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
}

// Never lose a check-off when the app is closed or backgrounded mid-delay.
onHide(() => ui.flush());
