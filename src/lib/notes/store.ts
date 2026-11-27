/**
 * Where this device keeps the open gist's daily notes (FR-24.1): a database
 * of its own beside the gist's task database, named `<task database>.notes`
 * (`mytasks.notes` for the first gist). Kept apart so the tasks' schema, which
 * is also the gist's, doesn't change: devices on older versions ignore
 * notes.json and keep syncing the tasks.
 *
 * The name can't be taken for a task database: `isTaskDbName` allows no dot.
 */
import Dexie, { liveQuery, type Table } from 'dexie';
import { readable, type Readable } from 'svelte/store';
import { activeDbName } from '../gists/active';
import { noteLocalChange } from '../db/history';
import { nowIso } from '../model/ids';
import { cleanNote, type DayNote } from './model';
import type { LocalDate } from '../model/types';

/** The notes database for a gist's task database. */
export function notesDbName(taskDb: string = activeDbName()): string {
  return `${taskDb}.notes`;
}

class NotesDB extends Dexie {
  notes!: Table<DayNote, LocalDate>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({ notes: 'date' });
  }
}

/** The open gist's notes database. */
export const notesDb = new NotesDB(notesDbName());

/** Every note and tombstone on this device, oldest day first. */
export function readNotes(): Promise<DayNote[]> {
  return notesDb.notes.orderBy('date').toArray();
}

/** The open gist's notes, by day, without tombstones: what the app shows. */
export const dayNotes: Readable<ReadonlyMap<LocalDate, DayNote>> = readable<ReadonlyMap<LocalDate, DayNote>>(new Map(), (set) => {
  const sub = liveQuery(async () => (await readNotes()).filter((n) => !n.deletedAt)).subscribe({
    next: (notes) => set(new Map(notes.map((n) => [n.date, n]))),
    error: (e) => console.error('Notes query failed', e),
  });
  return () => sub.unsubscribe();
});

/**
 * Save the note for `date` as typed. Blank bullets are left out; a note left
 * empty becomes a tombstone (when the day had one), so other devices clear it
 * too. An unchanged note isn't written. Sync is told, as for any change.
 */
export async function saveNote(date: LocalDate, typed: string): Promise<void> {
  const text = cleanNote(typed);
  const changed = await notesDb.transaction('rw', notesDb.notes, async () => {
    const old = await notesDb.notes.get(date);
    if ((old?.deletedAt ? '' : (old?.text ?? '')) === text) return false;
    const now = nowIso();
    if (text === '') {
      if (!old || old.deletedAt) return false;
      await notesDb.notes.put({ date, text: '', modifiedAt: now, deletedAt: now });
    } else {
      await notesDb.notes.put({ date, text, modifiedAt: now });
    }
    return true;
  });
  if (changed) noteLocalChange();
}

/** Store the gist's newer notes and forget days whose tombstones are past their time, in one transaction (sync). */
export async function applyNotes(toApply: DayNote[], toDrop: LocalDate[]): Promise<void> {
  if (!toApply.length && !toDrop.length) return;
  await notesDb.transaction('rw', notesDb.notes, async () => {
    if (toDrop.length) await notesDb.notes.bulkDelete(toDrop);
    if (toApply.length) await notesDb.notes.bulkPut(toApply);
  });
}

/**
 * Delete a gist's notes database from this device (Disconnect). The open
 * one stays usable afterwards (empty), as the task database does after its
 * own delete, until the page reloads on the next gist.
 */
export function deleteNotesDb(taskDb: string): Promise<void> {
  return taskDb === activeDbName() ? notesDb.delete({ disableAutoOpen: false }) : Dexie.delete(notesDbName(taskDb));
}
