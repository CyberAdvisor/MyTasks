/**
 * The daily notes part of a sync (FR-24.1): merge the gist's notes.json with
 * this device's notes, and write it back when the gist lacks something.
 *
 * It runs after the tasks, in the same sync and under the same lock, from the
 * file read in the same request. As for the tasks, a notes file with the IV
 * the last sync left hasn't changed, so it isn't decrypted: with this
 * device's notes unchanged too, nothing more is done.
 *
 * A notes file that can't be opened never fails the sync, and is never
 * written over: Settings › Daily Notes says so (`notesProblem`). Nor is a
 * file over MAX_FILE_CHARS written: the gist keeps its last good one. A
 * GitHub error while writing (offline) fails the sync as usual.
 */
import { writable, type Readable } from 'svelte/store';
import { DecryptError, MAX_FILE_CHARS, parseEnvelope, seal, unseal } from '../sync/crypto';
import { writeNotes } from '../sync/github';
import type { DeviceConfig, NotesMark } from '../sync/device';
import type { LostChange } from '../sync/lost';
import { nowIso } from '../model/ids';
import { formatWeekdayDate } from '../model/dates';
import { lostNotes, mergeNotes, notesStamp, readNotesFile, type DayNote } from './model';
import { applyNotes, readNotes } from './store';

/**
 * Why the gist's notes file couldn't be used: `unreadable` (damaged, or
 * encrypted with another passphrase) or `toolarge` (this device's notes,
 * encrypted, are over MAX_FILE_CHARS, so they weren't written).
 */
export type NotesProblem = 'unreadable' | 'toolarge';

const size = writable<number | null>(null);
const problem = writable<NotesProblem | null>(null);

/** The gist's notes file's length in characters as of the last sync, or null when it has none. */
export const notesChars: Readable<number | null> = { subscribe: size.subscribe };

/** A problem with the gist's notes file at the last sync, or null. */
export const notesProblem: Readable<NotesProblem | null> = { subscribe: problem.subscribe };

/** How a day's lost note is listed in the lost-change notice (FR-19.12). */
function lostNote(date: DayNote['date'], merged: DayNote[]): LostChange {
  const now = merged.find((n) => n.date === date);
  return { kind: 'note', id: date, title: `Daily note, ${formatWeekdayDate(date)}`, what: ['text'], deleted: !now || Boolean(now.deletedAt) };
}

/** Encrypt the notes for the gist: null when the file would be over MAX_FILE_CHARS. */
async function sealNotes(config: Pick<DeviceConfig, 'key' | 'salt' | 'iterations'>, notes: DayNote[]): Promise<{ content: string; iv: string } | null> {
  const env = await seal(config.key, config, JSON.stringify({ format: 1, notes }), nowIso(), 'mytasks-notes');
  const content = JSON.stringify(env);
  return content.length > MAX_FILE_CHARS ? null : { content, iv: env.cipher.iv };
}

/** Write `notes` to the gist and give the mark it leaves; with the file too large, nothing is written and `mark` stays. */
async function push(config: DeviceConfig, notes: DayNote[], mark: NotesMark | undefined): Promise<NotesMark | undefined> {
  const sealed = await sealNotes(config, notes);
  if (!sealed) {
    problem.set('toolarge');
    return mark;
  }
  await writeNotes(config.token, config.gistId, sealed.content);
  size.set(sealed.content.length);
  problem.set(null);
  return { iv: sealed.iv, stamp: notesStamp(notes), chars: sealed.content.length };
}

/** The gist's notes, decrypted and checked; null when the file can't be used. */
async function openNotes(config: DeviceConfig, file: string): Promise<{ notes: DayNote[]; iv: string } | null> {
  const env = parseEnvelope(file, 'mytasks-notes');
  if (!env || env.kdf.salt !== config.salt || env.kdf.iterations !== config.iterations) return null;
  try {
    const notes = readNotesFile(JSON.parse(await unseal(config.key, env)));
    return notes ? { notes, iv: env.cipher.iv } : null;
  } catch (e) {
    if (e instanceof DecryptError || e instanceof SyntaxError) return null;
    throw e;
  }
}

/**
 * Sync the notes with the gist's notes file (`file`, null when the gist has
 * none). `mark` is what the last sync left; `since`, when that sync read this
 * device, for the lost-change notice. Resolves to the next mark, or undefined
 * while neither side has notes.
 */
export async function syncNotes(
  config: DeviceConfig,
  file: string | null,
  mark: NotesMark | undefined,
  since: string | undefined,
  onLost: (lost: LostChange[]) => void,
): Promise<NotesMark | undefined> {
  const local = await readNotes();
  const now = nowIso();
  if (file === null) {
    size.set(null);
    problem.set(null);
    const { toDrop, merged } = mergeNotes(local, [], now);
    await applyNotes([], toDrop);
    return merged.length ? push(config, merged, undefined) : undefined;
  }
  size.set(file.length);
  const env = parseEnvelope(file, 'mytasks-notes');
  if (mark && env && env.cipher.iv === mark.iv) {
    problem.set(null);
    if (notesStamp(local) === mark.stamp) return { ...mark, chars: file.length };
    const { toDrop, merged } = mergeNotes(local, [], now);
    await applyNotes([], toDrop);
    return push(config, merged, mark);
  }
  const remote = await openNotes(config, file);
  if (!remote) {
    problem.set('unreadable');
    return mark;
  }
  problem.set(null);
  const { toApply, toDrop, merged, pushNeeded } = mergeNotes(local, remote.notes, now);
  await applyNotes(toApply, toDrop);
  if (since) {
    const lost = lostNotes(local, merged, since);
    if (lost.length) onLost(lost.map((d) => lostNote(d, merged)));
  }
  if (pushNeeded) return push(config, merged, mark);
  return { iv: remote.iv, stamp: notesStamp(merged), chars: file.length };
}

/** Write this device's notes, encrypted with `config`'s key (Change Passphrase); nothing when there are none. */
export async function rewriteNotes(config: DeviceConfig): Promise<void> {
  const { merged } = mergeNotes(await readNotes(), [], nowIso());
  if (merged.length) await push(config, merged, undefined);
}

/** Make this device's notes exactly the gist's (Replace With Gist, FR-19.9); a file that can't be opened changes nothing. */
export async function adoptNotes(config: DeviceConfig, file: string | null): Promise<void> {
  const remote = file === null ? { notes: [] } : await openNotes(config, file);
  if (!remote) return;
  const keep = new Set(remote.notes.map((n) => n.date));
  const drop = (await readNotes()).map((n) => n.date).filter((d) => !keep.has(d));
  await applyNotes(remote.notes, drop);
}
