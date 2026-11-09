/**
 * App-wide keys for Quick Find and Quick Entry (FR-8.1, FR-9.1).
 * The full shortcut set, with browser-tab fallbacks, comes in Milestone 4.
 *
 * - Quick Entry: Ctrl+Space, Cmd/Ctrl+Shift+N, or Cmd+Shift+Space
 *   (Ctrl+Space switches input source on some Macs).
 * - Quick Find: Cmd/Ctrl+F, or `/` outside a text field, or typing a
 *   character while nothing has focus ("type Travel").
 */

/** The key fields a decision needs (a subset of KeyboardEvent). */
type KeyInput = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>;

/** Where keyboard focus is: a text field, nothing (the page), or another control. */
type FocusKind = 'text' | 'none' | 'other';

type GlobalAction = { kind: 'quick-entry' } | { kind: 'find'; text: string } | null;

/** Decide what a key press does. `busy` is true while a dialog is open. */
export function globalAction(e: KeyInput, focus: FocusKind, busy: boolean): GlobalAction {
  if (busy) return null;
  const key = e.key.toLowerCase();
  const cmd = e.metaKey || e.ctrlKey;

  if (key === ' ' && e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) return { kind: 'quick-entry' };
  if (cmd && e.shiftKey && (key === 'n' || (key === ' ' && e.metaKey))) return { kind: 'quick-entry' };
  if (cmd && !e.shiftKey && !e.altKey && key === 'f') return { kind: 'find', text: '' };

  if (focus === 'text' || cmd || e.altKey) return null;
  if (e.key === '/') return { kind: 'find', text: '' };
  if (focus === 'none' && e.key.length === 1 && e.key.trim()) return { kind: 'find', text: e.key };
  return null;
}

/** Classify the focused element. */
export function focusKind(el: Element | null): FocusKind {
  if (!el || el === document.body || el === document.documentElement) return 'none';
  if (el instanceof HTMLTextAreaElement || (el as HTMLElement).isContentEditable) return 'text';
  if (el instanceof HTMLInputElement) {
    return ['checkbox', 'radio', 'button', 'submit', 'range', 'color'].includes(el.type) ? 'other' : 'text';
  }
  return 'other';
}
