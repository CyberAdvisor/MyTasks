/**
 * Keyboard bindings (design doc, Section 7; FR-7.1k, FR-7.2k).
 *
 * Each command has its Things binding. In a browser tab some of those keys
 * belong to the browser (new tab, reload, find), so the command gets a
 * fallback instead, usually a single letter. The installed app uses the
 * Things bindings; a tab uses the fallbacks (FR-7.1k).
 *
 * Rules:
 * - Single keys and Alt chords never fire while typing in a text field
 *   (FR-7.2k). Cmd/Ctrl chords do, except undo and moving items, which a
 *   text field needs for itself.
 * - Space, Enter, the arrows and Delete belong to whatever control has focus,
 *   unless that is a to-do row or nothing.
 * - In the installed app, typing a character with nothing focused (or a row
 *   selected) starts Quick Find, as in Things. In a tab, letters are commands,
 *   and `/` opens Quick Find.
 * - "G I" style bindings are sequences: G, then I within 1.5 seconds.
 *
 * Chords are written `Mod+Shift+N`, where Mod is Cmd on Apple devices and
 * Ctrl elsewhere. This module is pure: the caller supplies the key event, the
 * focus and the mode, and runs the command it returns.
 */

/** Everything a key can do. */
export type Command =
  | 'new-todo'
  | 'new-project'
  | 'new-heading'
  | 'quick-entry'
  | 'open'
  | 'select-prev'
  | 'select-next'
  | 'move-up'
  | 'move-down'
  | 'complete'
  | 'cancel'
  | 'when'
  | 'deadline'
  | 'today'
  | 'unscheduled'
  | 'deferred'
  | 'tags'
  | 'move'
  | 'checklist'
  | 'duplicate'
  | 'trash'
  | 'priority-1'
  | 'priority-2'
  | 'priority-3'
  | 'priority-4'
  | 'priority-5'
  | 'priority-0'
  | 'cycle-grouping'
  | 'find'
  | 'go-inbox'
  | 'go-today'
  | 'go-scheduled'
  | 'go-unscheduled'
  | 'go-deferred'
  | 'go-logbook'
  | 'go-trash'
  | 'toggle-sidebar'
  | 'undo'
  | 'help';

/** One command and its keys. */
export interface Binding {
  command: Command;
  /** Shown in Keyboard Help. */
  label: string;
  /** Keys in both the installed app and a tab. */
  both?: string[];
  /** Keys in the installed app only (the Things bindings that clash in a tab). */
  app?: string[];
  /** Keys in a browser tab only (the fallbacks). */
  tab?: string[];
  /** False when a Cmd/Ctrl chord must not fire while typing. */
  inText?: boolean;
}

export const BINDINGS: Binding[] = [
  { command: 'new-todo', label: 'New To-Do', app: ['Mod+N'], tab: ['N'], both: ['Space'] },
  { command: 'new-project', label: 'New Project', both: ['Mod+Alt+N'] },
  { command: 'new-heading', label: 'New Heading', app: ['Mod+Shift+N'], tab: ['Alt+H'] },
  { command: 'quick-entry', label: 'Quick Entry', both: ['Ctrl+Space', 'Mod+Shift+Space'] },
  { command: 'open', label: 'Open selected to-do', both: ['Enter'] },
  { command: 'select-prev', label: 'Select previous to-do', both: ['Up'] },
  { command: 'select-next', label: 'Select next to-do', both: ['Down'] },
  { command: 'move-up', label: 'Move item up', both: ['Mod+Up'], inText: false },
  { command: 'move-down', label: 'Move item down', both: ['Mod+Down'], inText: false },
  { command: 'complete', label: 'Complete', app: ['Mod+K'], tab: ['X'] },
  { command: 'cancel', label: 'Cancel', app: ['Mod+Alt+K'], tab: ['Shift+X'] },
  { command: 'when', label: 'When', app: ['Mod+S'], tab: ['W'] },
  { command: 'deadline', label: 'Deadline', app: ['Mod+Shift+D'], tab: ['D'] },
  { command: 'today', label: 'Today', app: ['Mod+T'], tab: ['T'] },
  { command: 'unscheduled', label: 'Unscheduled', app: ['Mod+R'], tab: ['U'] },
  { command: 'deferred', label: 'Deferred', app: ['Mod+O'], tab: ['F'] },
  { command: 'tags', label: 'Tags', app: ['Mod+Shift+T'], tab: ['#'] },
  { command: 'move', label: 'Move', app: ['Mod+Shift+M'], tab: ['M'] },
  { command: 'checklist', label: 'Checklist', app: ['Mod+Shift+C'], tab: ['C'] },
  { command: 'duplicate', label: 'Duplicate', app: ['Mod+D'], tab: ['Alt+D'] },
  { command: 'trash', label: 'Delete', both: ['Backspace', 'Delete'] },
  { command: 'priority-1', label: 'Priority 1', both: ['Alt+1'] },
  { command: 'priority-2', label: 'Priority 2', both: ['Alt+2'] },
  { command: 'priority-3', label: 'Priority 3', both: ['Alt+3'] },
  { command: 'priority-4', label: 'Priority 4', both: ['Alt+4'] },
  { command: 'priority-5', label: 'Priority 5', both: ['Alt+5'] },
  { command: 'priority-0', label: 'Clear priority', both: ['Alt+0'] },
  { command: 'cycle-grouping', label: 'Cycle Today grouping', app: ['Mod+G'], tab: ['G G'] },
  { command: 'find', label: 'Quick Find', both: ['Mod+F', '/'] },
  { command: 'go-inbox', label: 'Go to Inbox', app: ['Mod+1'], tab: ['G I'] },
  { command: 'go-today', label: 'Go to Today', app: ['Mod+2'], tab: ['G T'] },
  { command: 'go-scheduled', label: 'Go to Scheduled', app: ['Mod+3'], tab: ['G S'] },
  { command: 'go-unscheduled', label: 'Go to Unscheduled', app: ['Mod+4'], tab: ['G U'] },
  { command: 'go-deferred', label: 'Go to Deferred', app: ['Mod+5'], tab: ['G D'] },
  { command: 'go-logbook', label: 'Go to Completed', app: ['Mod+6'], tab: ['G C'] },
  { command: 'go-trash', label: 'Go to Trash', app: ['Mod+7'] },
  { command: 'toggle-sidebar', label: 'Show or hide the sidebar', both: ['Mod+/'] },
  { command: 'undo', label: 'Undo', both: ['Mod+Z'], inText: false },
  { command: 'help', label: 'Keyboard Help', both: ['Mod+Shift+/', '?'] },
];

/** The key fields a decision needs (a subset of KeyboardEvent). */
export type KeyInput = Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>;

/** Where keyboard focus is: a text field, a to-do row, nothing (the page), or another control. */
export type FocusKind = 'text' | 'row' | 'none' | 'other';

/** What the resolver needs to know besides the key. */
export interface KeyContext {
  focus: FocusKind;
  /** Running as an installed app rather than in a browser tab. */
  standalone: boolean;
  /** Apple device: Mod is Cmd. */
  mac: boolean;
  /** Current time in ms, for sequences. */
  now: number;
}

export type KeyResult = { command: Command } | { find: string } | { pending: true } | null;

/** How long the second key of a sequence may wait (ms). */
const SEQUENCE_MS = 1500;
/** Plain keys that belong to the focused control unless it is a row or nothing. */
const CONTROL_KEYS = new Set(['Space', 'Enter', 'Up', 'Down', 'Backspace', 'Delete']);
const NAMED: Record<string, string> = { Up: 'ArrowUp', Down: 'ArrowDown', Enter: 'Enter', Backspace: 'Backspace', Delete: 'Delete' };
const CODES: Record<string, string> = { '/': 'Slash' };

/** A parsed chord. */
interface Chord {
  mod: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

function parseChord(text: string): Chord {
  const parts = text.split('+');
  const key = parts.pop()!;
  return {
    mod: parts.includes('Mod'),
    ctrl: parts.includes('Ctrl'),
    alt: parts.includes('Alt'),
    shift: parts.includes('Shift'),
    key,
  };
}

/** Whether a key event is this chord. */
function matches(c: Chord, e: KeyInput, mac: boolean): boolean {
  const wantMeta = mac && c.mod;
  const wantCtrl = c.ctrl || (!mac && c.mod);
  if (e.metaKey !== wantMeta || e.ctrlKey !== wantCtrl || e.altKey !== c.alt) return false;
  const k = c.key;
  if (/^[A-Z]$/.test(k)) {
    // With Alt, Macs type a different character, so match the physical key.
    const hit = e.altKey ? e.code === `Key${k}` : e.key.toUpperCase() === k;
    return hit && e.shiftKey === c.shift;
  }
  if (/^[0-9]$/.test(k)) return (e.altKey ? e.code === `Digit${k}` : e.key === k) && e.shiftKey === c.shift;
  if (k === 'Space') return (e.key === ' ' || e.code === 'Space') && e.shiftKey === c.shift;
  if (NAMED[k]) return e.key === NAMED[k] && e.shiftKey === c.shift;
  // Symbols: with a modifier, match the physical key; alone, match the character typed.
  if (c.mod || c.ctrl) return e.code === CODES[k] && e.shiftKey === c.shift;
  return e.key === k;
}

/** Whether a chord may fire with focus where it is. */
function allowedHere(c: Chord, b: Binding, focus: FocusKind): boolean {
  const command = c.mod || c.ctrl;
  if (focus === 'text') return command && b.inText !== false;
  if (focus === 'other' && !command && !c.alt && CONTROL_KEYS.has(c.key)) return false;
  return true;
}

/** The keys a binding has in the current mode. */
export function keysFor(b: Binding, standalone: boolean): string[] {
  return [...(b.both ?? []), ...((standalone ? b.app : b.tab) ?? [])];
}

/**
 * Turns key presses into commands, remembering the first key of a sequence.
 * One instance serves the whole app.
 */
export class KeyResolver {
  private prefix: { key: string; at: number } | null = null;

  resolve(e: KeyInput, ctx: KeyContext): KeyResult {
    const prefix = this.prefix && ctx.now - this.prefix.at <= SEQUENCE_MS ? this.prefix.key : null;
    this.prefix = null;
    const all = BINDINGS.flatMap((b) =>
      keysFor(b, ctx.standalone).map((keys) => ({ b, steps: keys.split(' '), chords: keys.split(' ').map(parseChord) })),
    );
    const sequences = ctx.focus === 'text' ? [] : all.filter((x) => x.chords.length === 2);

    // The second key of a sequence comes first: after G, T means "go to
    // Today", not the single-key Today command.
    if (prefix) {
      const hit = sequences.find((x) => x.steps[0] === prefix && matches(x.chords[1], e, ctx.mac));
      if (hit) return { command: hit.b.command };
    }
    for (const { b, chords } of all) {
      if (chords.length === 1 && matches(chords[0], e, ctx.mac) && allowedHere(chords[0], b, ctx.focus)) {
        return { command: b.command };
      }
    }
    const startsSequence = sequences.some((x) => matches(x.chords[0], e, ctx.mac));
    if (startsSequence) {
      this.prefix = { key: e.key.toUpperCase(), at: ctx.now };
      return { pending: true };
    }
    // Type to search (installed app only).
    const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
    if (ctx.standalone && plain && (ctx.focus === 'none' || ctx.focus === 'row') && e.key.length === 1 && e.key.trim()) {
      return { find: e.key };
    }
    return null;
  }
}

/** Show a binding's keys the way the platform writes them, e.g. ⌘⇧N or Ctrl+Shift+N. */
export function formatKeys(keys: string, mac: boolean): string {
  return keys
    .split(' ')
    .map((step) => {
      const c = parseChord(step);
      const key = { Up: '↑', Down: '↓', Enter: mac ? 'Return' : 'Enter', Backspace: mac ? '⌫' : 'Backspace' }[c.key] ?? c.key;
      const shown = c.key === '/' && c.shift ? '?' : key;
      const shift = c.shift && shown !== '?';
      if (mac) return `${c.ctrl ? '⌃' : ''}${c.alt ? '⌥' : ''}${shift ? '⇧' : ''}${c.mod ? '⌘' : ''}${shown}`;
      const mods = [c.ctrl || c.mod ? 'Ctrl' : '', c.alt ? 'Alt' : '', shift ? 'Shift' : ''].filter(Boolean);
      return [...mods, shown].join('+');
    })
    .join(' then ');
}

/** Classify the focused element. */
export function focusKind(el: Element | null): FocusKind {
  if (!el || el === document.body || el === document.documentElement) return 'none';
  if (el instanceof HTMLTextAreaElement || (el as HTMLElement).isContentEditable) return 'text';
  if (el instanceof HTMLInputElement) {
    return ['checkbox', 'radio', 'button', 'submit', 'range', 'color'].includes(el.type) ? 'other' : 'text';
  }
  // Buttons inside a row (its checkbox) keep Space and Enter for themselves.
  if (el.matches('button, a, select, summary')) return 'other';
  if (el.closest('[data-row-id]')) return 'row';
  return 'other';
}

/** Whether the app runs installed (Home Screen, Dock or a Chromium app window). */
export function isStandalone(): boolean {
  return matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** Whether Mod means Cmd on this device. */
export function isMac(): boolean {
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
}
