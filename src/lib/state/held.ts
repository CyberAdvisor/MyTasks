/**
 * Tasks held in place (src/lib/model/hold.ts), as they were when held:
 *
 * - `openHold`: the task whose card is open, from when it opened until it
 *   closes (set by `ui.expandedId`).
 * - `inboxHold`: tasks moved out of the Inbox while it was on screen. They
 *   stay listed there under "N tasks moved out of the Inbox", until OK
 *   (`releaseInbox`) or another page is opened.
 *
 * Per device and never synced; a reload releases everything.
 */
import { derived, get, writable, type Readable } from 'svelte/store';
import { route } from './route';
import type { ID, Todo } from '../model/types';

export const openHold = writable<Todo | null>(null);
export const inboxHold = writable<ReadonlyMap<ID, Todo>>(new Map());

/** Every held task, the open card's taking precedence. */
export const held: Readable<ReadonlyMap<ID, Todo>> = derived([inboxHold, openHold], ([inbox, open]) => {
  if (!open) return inbox;
  return new Map([...inbox, [open.id, open]]);
});

/** Keep a task that left the Inbox listed there, as it was before. */
export function holdInInbox(was: Todo): void {
  const m = get(inboxHold);
  if (m.has(was.id)) return;
  inboxHold.set(new Map([...m, [was.id, was]]));
}

/** Let the tasks moved out of the Inbox go (OK, or another page opened). */
export function releaseInbox(): void {
  if (get(inboxHold).size) inboxHold.set(new Map());
}

/** Whether the Inbox is the page on screen. */
export const inboxShown = (): boolean => {
  const r = get(route);
  return r.kind === 'list' && r.list === 'inbox';
};

// Opening any other page lets them go.
route.subscribe((r) => {
  if (!(r.kind === 'list' && r.list === 'inbox')) releaseInbox();
});
