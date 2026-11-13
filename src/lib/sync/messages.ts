/**
 * Sync messages in plain words (FR-19.3, FR-19.8): the one-line status in
 * the sidebar, and the full explanation in Settings and the dialogs.
 */
import { formatTimestamp } from '../model/dates';
import { MIN_PASSPHRASE } from './crypto';
import { SyncError } from './cycle';
import { GistError } from './github';
import type { SyncCode, SyncStatus } from './sync.svelte';

/** Shown under a new passphrase field (Setup and Change Passphrase). */
export const PASSPHRASE_TIP = `Use at least ${MIN_PASSPHRASE} characters. A password manager, or four random words, makes a good passphrase.`;

/** A clock time such as 2:41 PM. */
export function clock(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** "today at 2:41 PM", or a date and time for older syncs, mid-sentence. */
export function whenSynced(iso: string, now = new Date()): string {
  return formatTimestamp(iso, now).replace(/^(Today|Yesterday)/, (w) => w.toLowerCase());
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
      return 'Your My Tasks gist was not found. It may have been deleted on GitHub. Recreate it from the tasks on this device.';
    case 'malformed':
      return 'Your gist holds a file that isn’t a valid My Tasks file. It was not applied, and the tasks on this device are unchanged.';
    case 'passphrase':
      return 'The passphrase was changed on another device. Enter the new passphrase to keep syncing.';
    case 'wrong-passphrase':
      return 'Wrong passphrase.';
    case 'newer':
      return 'Your tasks were saved by a newer version of My Tasks. Reload the app to update it.';
    case 'invalid':
      return 'The tasks on this device failed their check, so they were not uploaded. Your gist is unchanged.';
  }
}

/** The explanation for an error thrown by a sync action. */
export function errorText(e: unknown): string {
  if (e instanceof GistError) return problemText(e.code, e.retryAt);
  if (e instanceof SyncError) return problemText(e.code);
  console.error(e);
  return 'Something went wrong. Try again.';
}

/** The sidebar's sync line (FR-19.8): Syncing… while a sync runs, otherwise the last sync. */
export function syncedLine(status: SyncStatus, lastSyncedAt: string | null): string {
  if (status === 'syncing') return 'Syncing…';
  return lastSyncedAt ? `Synced ${clock(new Date(lastSyncedAt))}` : 'Not synced yet';
}

/** The message above the sync line: being offline, or the problem; null when there is none. */
export function syncMessage(status: SyncStatus, problem: SyncCode | null): string | null {
  switch (status) {
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
      return null;
  }
}
