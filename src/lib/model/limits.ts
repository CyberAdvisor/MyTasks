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

/** The message when an add is refused. */
export function limitRefusal(count: number, adding: number): string {
  const what = adding === 1 ? 'Another task' : `${formatCount(adding)} more tasks`;
  return `${what} would take you past ${formatCount(MAX_TASKS)}, the most My Tasks can sync (you have ${formatCount(count)}). Empty the Trash or delete old completed tasks to make room.`;
}
