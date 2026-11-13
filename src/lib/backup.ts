/**
 * Back up and restore (FR-12.8): the backup file, and the checks a file
 * must pass before Restore replaces anything.
 *
 * The file is unencrypted JSON: a header saying what it is (`format`,
 * `formatVersion`, `schema`, when it was saved and by which version), then
 * the same tables and synced settings the gist holds (sync/payload.ts). It
 * is built only from the synced tables, in one transaction (readLocal), so
 * it never holds the token, the gist id or the key, which live in the
 * separate `mytasks-device` database. Saving needs no network, so it works
 * whatever state the gist is in.
 *
 * Restoring the file is SyncEngine.restore (sync/sync.svelte.ts).
 */
import { MAX_FILE_CHARS } from './sync/crypto';
import { SyncError, checkList } from './sync/cycle';
import { readLocal } from './sync/local';
import type { Payload } from './sync/payload';
import { nowIso } from './model/ids';
import { VERSION } from './version';
import type { BaseRecord } from './model/types';
import type { Browser } from './pwa/platform';

/** What a backup file says it is. */
export const BACKUP_FORMAT = 'mytasks-backup';

/** The layout of the file around the list; raise it if the header changes. */
export const BACKUP_FORMAT_VERSION = 1;

/** A backup file as written. */
export interface BackupFile extends Payload {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  /** When it was saved (ISO). */
  savedAt: string;
  /** The app version that saved it. */
  appVersion: string;
}

/** A backup file that passed every check, ready to restore. */
export interface Backup {
  /** The list, upgraded to this version's schema. */
  list: Payload;
  savedAt: string;
}

/**
 * Why a file can't be restored:
 * - `toolarge`: over 5 MB, larger than the gist can hold
 * - `notbackup`: not JSON, or not a My Tasks backup file
 * - `newer`: saved by a newer version of My Tasks
 * - `invalid`: a My Tasks backup that fails the checks
 */
export type BackupProblem = 'toolarge' | 'notbackup' | 'newer' | 'invalid';

export class BackupError extends Error {
  constructor(readonly code: BackupProblem) {
    super(`Backup refused: ${code}`);
  }
}

/** The message for a refused file. Nothing on the device has changed. */
export function backupProblemText(code: BackupProblem): string {
  const unchanged = 'Nothing was changed.';
  switch (code) {
    case 'toolarge':
      return `This file is over 5 MB, too large to restore. ${unchanged}`;
    case 'notbackup':
      return `This file isn’t a My Tasks backup. ${unchanged}`;
    case 'newer':
      return `This backup was saved by a newer version of My Tasks. Reload the app to update it, then try again. ${unchanged}`;
    case 'invalid':
      return `This backup is damaged or has been edited, so it can’t be restored. ${unchanged}`;
  }
}

/** The file's name, from when it was saved: My Tasks backup 2026-11-13 1150.json. */
export function backupFileName(at: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `My Tasks backup ${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())} ${p(at.getHours())}${p(at.getMinutes())}.json`;
}

/** The backup file's text, from one consistent snapshot of this device. */
export async function buildBackup(savedAt = nowIso()): Promise<string> {
  const list = await readLocal();
  const file: BackupFile = { format: BACKUP_FORMAT, formatVersion: BACKUP_FORMAT_VERSION, savedAt, appVersion: VERSION, ...list };
  return JSON.stringify(file, null, 1);
}

/**
 * Check a file's text completely, changing nothing: its size, that it is a
 * My Tasks backup, its format and schema (an older schema is upgraded, a
 * newer one refused), and every record and setting with the same checks as
 * the gist (sync/validate.ts). Throws BackupError.
 */
export function readBackup(text: string): Backup {
  if (text.length > MAX_FILE_CHARS) throw new BackupError('toolarge');
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    throw new BackupError('notbackup');
  }
  const f = file as Partial<BackupFile> | null;
  if (!f || typeof f !== 'object' || Array.isArray(f) || f.format !== BACKUP_FORMAT) throw new BackupError('notbackup');
  if (!Number.isInteger(f.formatVersion) || (f.formatVersion as number) < 1) throw new BackupError('invalid');
  if ((f.formatVersion as number) > BACKUP_FORMAT_VERSION) throw new BackupError('newer');
  if (typeof f.savedAt !== 'string' || Number.isNaN(Date.parse(f.savedAt))) throw new BackupError('invalid');
  const { app, schema, tables, settings } = f;
  let list: Payload;
  try {
    list = checkList({ app, schema, tables, settings });
  } catch (e) {
    if (e instanceof SyncError && e.code === 'newer') throw new BackupError('newer');
    throw new BackupError('invalid');
  }
  delete list.upgradedFrom;
  return { list, savedAt: f.savedAt };
}

/** What a list holds, not counting deleted records, for the restore confirmation. */
export function countsOf(list: Payload): { tasks: number; projects: number; areas: number } {
  const live = (rows: BaseRecord[]) => rows.filter((r) => !r.deletedAt).length;
  return { tasks: live(list.tables.todos), projects: live(list.tables.projects), areas: live(list.tables.areas) };
}

/** "142 tasks, 9 projects and 3 areas". */
export function countsText(c: { tasks: number; projects: number; areas: number }): string {
  const n = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
  return `${n(c.tasks, 'task')}, ${n(c.projects, 'project')} and ${n(c.areas, 'area')}`;
}

/**
 * How Save Backup hands the file over: the share sheet in the installed
 * iPhone and iPad app, where a download has nowhere to go (to be confirmed
 * in device testing), otherwise an ordinary download.
 */
export function saveMethod(browser: Browser, standalone: boolean, canShareFiles: boolean): 'share' | 'download' {
  return browser === 'ios' && standalone && canShareFiles ? 'share' : 'download';
}
