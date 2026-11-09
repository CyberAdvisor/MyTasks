/**
 * UI state shared across components. None of it is in the database; only
 * the hidden-sidebar flag is remembered, per device.
 */
import * as repo from '../db/repo';
import { undo } from '../db/history';
import { readFlag, writeFlag } from './flags';
import type { ID } from '../model/types';
import type { TodoDraft } from './draft.svelte';

/** How long a completed row stays visible before it leaves the list (FR-1.3). */
export const COMPLETE_DELAY_MS = 2000;

/** How long the Undo toast stays up. */
export const TOAST_MS = 5000;

/** A picker or field the open card should show at once (keyboard commands, Section 7). */
export type CardCommand = 'when' | 'deadline' | 'tags' | 'checklist';

const SIDEBAR_KEY = 'mytasks.sidebarHidden';

class UiState {
  /** The to-do whose card is open, if any. */
  expandedId = $state<ID | null>(null);
  /** The selected row (desktop single selection). */
  selectedId = $state<ID | null>(null);
  /** The to-do whose Move dialog is open. */
  movingId = $state<ID | null>(null);
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
  /** Keyboard Help is open (FR-7.1k). */
  helpOpen = $state(false);
  /** The sidebar is hidden on wider screens (Cmd/Ctrl+/); remembered. */
  sidebarHidden = $state(readFlag(SIDEBAR_KEY));
  /** The Undo toast shown on touch devices after a destructive action (FR-1.6). */
  toast = $state<{ message: string } | null>(null);
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  /** A to-do to select, and maybe open, once the next view has loaded. */
  private reveal: { id: ID; open: boolean } | null = null;

  private timers = new Map<ID, ReturnType<typeof setTimeout>>();

  /** Open a to-do's card. */
  open(id: ID): void {
    this.expandedId = id;
    this.selectedId = id;
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

  /** Show or hide the sidebar and remember the choice. */
  toggleSidebar(): void {
    this.sidebarHidden = !this.sidebarHidden;
    writeFlag(SIDEBAR_KEY, this.sidebarHidden);
  }

  /**
   * After a destructive change, offer Undo in a toast on touch devices, which
   * have no Cmd/Ctrl+Z and where web apps cannot use shake to undo. Desktop
   * uses the keyboard only, as Things does.
   */
  offerUndo(message: string): void {
    if (typeof matchMedia === 'undefined' || !matchMedia('(pointer: coarse)').matches) return;
    clearTimeout(this.toastTimer);
    this.toast = { message };
    this.toastTimer = setTimeout(() => (this.toast = null), TOAST_MS);
  }

  /**
   * Undo the last change (FR-1.6). A check-off still waiting to be written is
   * the last change, so it is taken back first.
   */
  async undoLast(): Promise<void> {
    clearTimeout(this.toastTimer);
    this.toast = null;
    const waiting = Object.keys(this.pending);
    if (waiting.length) this.toggleDone(waiting[waiting.length - 1]);
    else await undo();
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
    this.close();
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

// Never lose a check-off when the app is closed or backgrounded mid-delay.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') ui.flush();
  });
  window.addEventListener('pagehide', () => ui.flush());
}
