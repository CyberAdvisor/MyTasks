/**
 * Sync messages in plain words (FR-19.3, FR-19.8): the one-line status in
 * the sidebar, and the full explanation in Settings and the dialogs.
 */
import { SyncError } from './cycle';
import { GistError } from './github';
import type { SyncCode, SyncStatus } from './sync.svelte';

/** A clock time such as 2:41 PM. */
export function clock(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** "today at 2:41 PM", or a date and time for older syncs. */
export function whenSynced(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (d.toDateString() === now.toDateString()) return `today at ${clock(d)}`;
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} at ${clock(d)}`;
}

/** The full explanation of a sync problem. */
export function problemText(code: SyncCode, retryAt: Date | null = null): string {
  switch (code) {
    case 'token':
    case 'scope':
      return 'Token not valid, or it is missing the gist scope.';
    case 'offline':
      return 'Couldn’t reach GitHub. Check your connection and try again.';
    case 'ratelimit':
      return retryAt
        ? `GitHub is limiting requests. Try again after ${clock(retryAt)}.`
        : 'GitHub is limiting requests. Try again in a few minutes.';
    case 'server':
      return 'GitHub returned an error. Try again.';
    case 'notfound':
      return 'Your My Tasks gist was not found. It may have been deleted on GitHub. Recreate it from the list on this device.';
    case 'malformed':
      return 'Your gist holds a file that isn’t a valid My Tasks list. It was not applied, and the list on this device is unchanged.';
    case 'passphrase':
      return 'The passphrase was changed on another device. Enter the new passphrase to keep syncing.';
    case 'wrong-passphrase':
      return 'Wrong passphrase.';
    case 'newer':
      return 'Your list was saved by a newer version of My Tasks. Reload the app to update it.';
    case 'invalid':
      return 'The list on this device failed its check, so it was not uploaded. Your gist is unchanged.';
  }
}

/** The explanation for an error thrown by a sync action. */
export function errorText(e: unknown): string {
  if (e instanceof GistError) return problemText(e.code, e.retryAt);
  if (e instanceof SyncError) return problemText(e.code);
  console.error(e);
  return 'Something went wrong. Try again.';
}

/** The sidebar's one-line status. */
export function statusLine(status: SyncStatus, problem: SyncCode | null, lastSyncedAt: string | null): string {
  switch (status) {
    case 'syncing':
      return 'Syncing…';
    case 'offline':
      return 'Offline — changes saved on this device';
    case 'error':
      if (problem === 'passphrase') return 'Passphrase changed';
      if (problem === 'ratelimit') return 'GitHub busy — will retry';
      if (problem === 'token' || problem === 'scope') return 'Sync error — token rejected';
      if (problem === 'notfound') return 'Sync error — gist not found';
      if (problem === 'newer') return 'Update needed — reload the app';
      return 'Sync error';
    default:
      return lastSyncedAt ? `Synced ${clock(new Date(lastSyncedAt))}` : 'Synced';
  }
}
