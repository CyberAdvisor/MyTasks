/**
 * The task limit (NFR-7, decided 2026-11-17, conversation 2026-11-17-C).
 *
 * Every device's tasks travel as one encrypted gist file, which sync and
 * Restore refuse over 5 MB (MAX_FILE_CHARS). A typical task takes about 850
 * characters there, so about 6,000 fit; 5,000 leaves room for longer notes.
 * Every task that isn't deleted counts: open, completed, canceled and in the
 * Trash. Projects, areas and headings don't.
 *
 * Adding a task is refused at the limit (TaskLimitError); a repeating task's
 * next copy and tasks arriving by sync are not, so nothing is lost or stops.
 */
import { MAX_FILE_CHARS } from '../sync/crypto';

/** The most tasks a list may hold. */
export const MAX_TASKS = 5000;

/** From this many tasks, the sidebar warns how close the limit is. */
export const WARN_TASKS = 4500;

/** Thrown when adding `adding` tasks would take the list past MAX_TASKS. */
export class TaskLimitError extends Error {
  constructor(
    readonly count: number,
    readonly adding: number,
  ) {
    super(`Task limit: ${count} + ${adding} > ${MAX_TASKS}`);
  }
}

/** Whether `adding` more tasks fit alongside `count`. */
export function hasRoom(count: number, adding = 1): boolean {
  return adding <= 0 || count + adding <= MAX_TASKS;
}

/** Whether the sidebar should warn, at `count` tasks. */
export function nearLimit(count: number): boolean {
  return count >= WARN_TASKS;
}

/** A count with a thousands separator: 4,612. */
export function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}

/** The sidebar's warning line. */
export function limitWarning(count: number): string {
  return `${formatCount(count)} of ${formatCount(MAX_TASKS)} tasks.`;
}

/**
 * From this gist file size the sidebar warns too (v1.11.6): 90% of the 5 MB a
 * sync or Restore will upload (MAX_FILE_CHARS), so tasks with long notes or
 * checklists, which fill the file before 5,000 tasks, are warned about before
 * an upload is refused ("Sync error — too large").
 */
export const WARN_FILE_CHARS = Math.floor(MAX_FILE_CHARS * 0.9);

/** Whether the gist file, as the last sync left it, is near its 5 MB limit; false before a first sync. */
export function nearFileLimit(chars: number | undefined): boolean {
  return chars !== undefined && chars >= WARN_FILE_CHARS;
}

/** A file size against the limit: "4.6 MB of 5 MB". */
function sizeOfLimit(chars: number): string {
  const mb = 1024 * 1024;
  return `${(chars / mb).toFixed(1)} MB of ${MAX_FILE_CHARS / mb} MB`;
}

/**
 * The sidebar's warning line (NFR-7): from 4,500 tasks or 4.5 MB, whichever
 * comes first, or both; null when neither is near. `chars` is the gist
 * file's size from the last sync. The daily notes file (FR-24.1), `notesChars`,
 * has its own 5 MB and is warned of from 4.5 MB too.
 */
export function roomWarning(count: number, chars: number | undefined, notesChars?: number | null): string | null {
  const base = tasksWarning(count, chars);
  if (!nearFileLimit(notesChars ?? undefined)) return base;
  const notes = sizeOfLimit(notesChars!);
  return base ? `${base.slice(0, -1)} · daily notes ${notes}.` : `Your daily notes are ${notes}.`;
}

/** The warning for the tasks alone: their count, their file's size, or both. */
function tasksWarning(count: number, chars: number | undefined): string | null {
  const tasks = nearLimit(count);
  const size = nearFileLimit(chars);
  if (tasks && size) return `${formatCount(count)} of ${formatCount(MAX_TASKS)} tasks · ${sizeOfLimit(chars!)}.`;
  if (size) return `Your gist is ${sizeOfLimit(chars!)}.`;
  return tasks ? limitWarning(count) : null;
}

/** The message when an add is refused. */
export function limitRefusal(count: number, adding: number): string {
  const what = adding === 1 ? 'Another task' : `${formatCount(adding)} more tasks`;
  return `${what} would take you past ${formatCount(MAX_TASKS)}, the most My Tasks can sync (you have ${formatCount(count)}). Empty the Trash or delete old completed tasks to make room.`;
}
