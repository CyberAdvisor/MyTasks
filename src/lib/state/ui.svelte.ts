/**
 * Transient UI state shared across components (not persisted).
 */
import * as repo from '../db/repo';
import type { ID } from '../model/types';

/** How long a completed row stays visible before it leaves the list (FR-1.3). */
export const COMPLETE_DELAY_MS = 2000;

class UiState {
  /** The to-do whose card is open, if any. */
  expandedId = $state<ID | null>(null);
  /** The selected row (desktop single selection). */
  selectedId = $state<ID | null>(null);
  /** The to-do whose Move dialog is open. */
  movingId = $state<ID | null>(null);
  /** Tag selected in the current view's tag bar (FR-6.3); reset on navigation. */
  tagFilter = $state<ID | null>(null);
  /** Rows checked off but not yet written, mapped to their pending status. */
  pending = $state<Record<ID, 'completed' | 'canceled'>>({});

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
