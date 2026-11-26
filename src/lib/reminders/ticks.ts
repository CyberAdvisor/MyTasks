/**
 * Ticks in Apple Reminders (FR-21.11). The calendar helper on the Mac writes
 * ticks.json to each gist: the tasks whose reminders were ticked in its
 * Reminders list, encrypted with the gist's key (envelope app
 * `mytasks-ticks`). Inside: `{ format: 1, ticks: [{ task, at, day? }] }`,
 * where `at` is when the reminder was ticked and `day`, for a repeating
 * task's one repeating reminder, the day it was for (the copy for that day
 * is completed).
 *
 * After each sync the engine hands the file over (`receiveTicks`), and the
 * tasks still open are completed at the tick's time, as one undo step
 * (repo.completeTicked). The file is read on every sync, since a tick
 * already applied finds its task closed and is skipped; the helper drops a
 * tick once its task is closed, or after 30 days. The app never writes it.
 */
import { writable, type Readable } from 'svelte/store';
import { completeTicked } from '../db/repo';
import { parseEnvelope, unseal } from '../sync/crypto';
import { isId, isLocalDate, isTimestamp } from '../sync/validate';
import type { ID, LocalDate } from '../model/types';

/** One task ticked in Reminders. */
export interface Tick {
  task: ID;
  /** When it was ticked, as toISOString writes it. */
  at: string;
  /** For a repeating task's reminder: the day whose copy is completed. */
  day?: LocalDate;
}

/** The ticks in a decrypted ticks.json; an entry that fails a check is left out, and a file that isn't format 1 holds none. */
export function readTicks(x: unknown): Tick[] {
  const file = x as { format?: unknown; ticks?: unknown } | null;
  if (!file || typeof file !== 'object' || file.format !== 1 || !Array.isArray(file.ticks)) return [];
  const out: Tick[] = [];
  for (const t of file.ticks as Record<string, unknown>[]) {
    if (!t || typeof t !== 'object' || !isId(t.task) || !isTimestamp(t.at)) continue;
    if (t.day !== undefined && !isLocalDate(t.day)) continue;
    out.push({ task: t.task as ID, at: t.at as string, ...(t.day !== undefined ? { day: t.day as LocalDate } : {}) });
  }
  return out;
}

/** The message for the tasks completed: "Completed in Reminders: Call Sam", or "3 tasks completed in Reminders". */
export function tickedMessage(titles: string[]): string {
  return titles.length === 1 ? `Completed in Reminders: ${titles[0] || 'Untitled task'}` : `${titles.length} tasks completed in Reminders`;
}

const listeners = new Set<(message: string) => void>();

/** Call `fn` with the message whenever ticks complete tasks (the toast, with Undo). Returns a function that stops it. */
export function onTicked(fn: (message: string) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const writtenAt = writable<string | null>(null);

/**
 * When the helper last wrote this gist's ticks.json (its envelope's time,
 * readable without decrypting), or null when the gist has none or no sync
 * has read it yet. Settings › Sync shows the later of this and the calendar
 * file's time as the helper's last update.
 */
export const ticksWrittenAt: Readable<string | null> = { subscribe: writtenAt.subscribe };

/**
 * After a sync read the gist: complete the tasks ticked in Reminders, from
 * the gist's ticks.json (null when it has none). Never fails the sync: a file
 * that can't be opened is left alone.
 */
export async function receiveTicks(keys: { key: CryptoKey }, file: string | null): Promise<void> {
  if (file === null) {
    writtenAt.set(null);
    return;
  }
  try {
    const env = parseEnvelope(file, 'mytasks-ticks');
    writtenAt.set(env && isTimestamp(env.updatedAt) ? env.updatedAt : null);
    if (!env) return;
    const ticks = readTicks(JSON.parse(await unseal(keys.key, env)));
    if (!ticks.length) return;
    const titles = await completeTicked(ticks);
    if (titles.length) for (const l of listeners) l(tickedMessage(titles));
  } catch (e) {
    console.error('Reading the Reminders ticks failed', e);
  }
}
