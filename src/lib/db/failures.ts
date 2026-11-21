/**
 * Failed saves (Milestone 11, review finding C1, conversation 2026-11-17-E).
 *
 * The interface starts most saves without waiting for them (`void repo.x()`),
 * so a failure surfaces as an unhandled promise rejection. main.ts catches
 * those in one place and asks `failureKind` what happened: a refused add at
 * the task limit (NFR-7), this device's storage being full, or another
 * database failure. Those three are shown to the user; anything else is only
 * logged, so harmless errors elsewhere don't raise alarms.
 *
 * A failed save changes nothing: its transaction is rolled back and no undo
 * step is recorded (history.ts).
 */
import Dexie from 'dexie';
import { TaskLimitError } from '../model/limits';

type FailureKind = 'limit' | 'storageFull' | 'database' | 'other';

/** What kind of failure an unhandled rejection's reason is. */
export function failureKind(reason: unknown): FailureKind {
  if (reason instanceof TaskLimitError) return 'limit';
  if (isQuota(reason) || (reason instanceof Dexie.DexieError && isQuota(reason.inner))) return 'storageFull';
  if (reason instanceof Dexie.DexieError) return 'database';
  return 'other';
}

/** The browser's "no room" error, as IndexedDB raises it or as Dexie re-raises it. */
function isQuota(e: unknown): boolean {
  return e instanceof Error || e instanceof DOMException ? e.name === 'QuotaExceededError' : false;
}

/** The dialog for a failed save, by kind. */
export const failureMessages: Record<'storageFull' | 'database', { title: string; message: string }> = {
  storageFull: {
    title: 'Storage is full',
    message:
      "My Tasks couldn't save your last change because this device has no room left for it. Free up space on this device, then reload My Tasks. Changes made before this one are kept.",
  },
  database: {
    title: "Couldn't save",
    message:
      "Your last change couldn't be saved, so it hasn't happened. Reload My Tasks and try again. If it keeps happening, report it on GitHub.",
  },
};
