/**
 * One sync or Settings action at a time, across every open window of the app.
 *
 * Uses the browser's Web Locks API, so a window's action waits for one
 * running in another window, and Disconnect waits for both. Where the API is
 * missing (older browsers, the unit tests' jsdom), actions still run one at a
 * time within this window.
 */

/** The lock's name; the same in every window of the app. */
const LOCK_NAME = 'mytasks-sync';

/** The last action queued in this window, when Web Locks are not available. */
let tail: Promise<unknown> = Promise.resolve();

/** Run `action` once no other sync or Settings action is running. */
export async function exclusive<T>(action: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) return await navigator.locks.request(LOCK_NAME, action);
  const run = tail.then(action);
  tail = run.catch(() => undefined);
  return run;
}
