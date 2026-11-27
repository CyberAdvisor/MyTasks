/**
 * Daily notes (FR-24.1): one note per day, kept in each gist's notes.json
 * beside the tasks, encrypted with the gist's key (envelope app
 * `mytasks-notes`). Inside: `{ format: 1, notes: [DayNote, …] }`.
 *
 * A note is a day's text, one bullet per line (`- `). Clearing a note leaves
 * a tombstone (`deletedAt`, empty text), so the clearing reaches other
 * devices; tombstones are dropped after TOMBSTONE_DAYS, as for other records.
 * Notes merge day by day, the whole note at a time: the later `modifiedAt`
 * wins, a time later than now counting as now.
 *
 * Pure functions, no storage access.
 */
import { isLocalDate, isTimestamp } from '../sync/validate';
import { TOMBSTONE_DAYS } from '../sync/payload';
import type { LocalDate } from '../model/types';

/** One day's note, or its tombstone. */
export interface DayNote {
  date: LocalDate;
  /** The note as typed, one bullet per line; empty on a tombstone. */
  text: string;
  /** Last change, as toISOString writes it; decides merges. */
  modifiedAt: string;
  /** Set when the note was cleared or archived. */
  deletedAt?: string;
}

/** The decrypted contents of notes.json. */
export interface NotesFile {
  format: 1;
  notes: DayNote[];
}

/** The longest note accepted, in characters: far beyond a day's bullets, short of filling the file. */
const MAX_NOTE_CHARS = 100_000;

/** Whether `x` is a valid note or tombstone. */
function isDayNote(x: unknown): x is DayNote {
  const n = x as Partial<DayNote> | null;
  if (!n || typeof n !== 'object' || !isLocalDate(n.date) || !isTimestamp(n.modifiedAt) || typeof n.text !== 'string') return false;
  if (n.text.length > MAX_NOTE_CHARS) return false;
  const keys = Object.keys(n);
  if (keys.some((k) => !['date', 'text', 'modifiedAt', 'deletedAt'].includes(k))) return false;
  if (n.deletedAt === undefined) return true;
  return isTimestamp(n.deletedAt) && n.text === '';
}

/**
 * The notes in a decrypted notes.json, or null when the file isn't a valid
 * format-1 notes file: every entry must pass `isDayNote`, with each day once.
 */
export function readNotesFile(x: unknown): DayNote[] | null {
  const file = x as { format?: unknown; notes?: unknown } | null;
  if (!file || typeof file !== 'object' || file.format !== 1 || !Array.isArray(file.notes)) return null;
  const seen = new Set<string>();
  for (const n of file.notes) {
    if (!isDayNote(n) || seen.has(n.date)) return null;
    seen.add(n.date);
  }
  return file.notes as DayNote[];
}

/** A note's change time for merging: a time later than `now` counts as `now`. */
function when(n: DayNote, now: string): string {
  return n.modifiedAt > now ? now : n.modifiedAt;
}

/** Whether two notes say the same (text, and whether cleared). */
function same(a: DayNote, b: DayNote): boolean {
  return a.text === b.text && Boolean(a.deletedAt) === Boolean(b.deletedAt);
}

/** Whether a tombstone is older than TOMBSTONE_DAYS at `now`. */
function isOldNoteTombstone(n: DayNote, now: string): boolean {
  if (!n.deletedAt) return false;
  return Date.parse(now) - Date.parse(n.deletedAt) > TOMBSTONE_DAYS * 86_400_000;
}

/** The result of merging this device's notes with the gist's. */
export interface NotesMerge {
  /** The gist's notes this device must store (newer or missing here). */
  toApply: DayNote[];
  /** Days this device must forget: their winning note is a tombstone past TOMBSTONE_DAYS. */
  toDrop: LocalDate[];
  /** Every day's winning note, old tombstones dropped: what the gist should hold. */
  merged: DayNote[];
  /** Whether the gist differs from `merged`, so it must be written. */
  pushNeeded: boolean;
}

/** Whether two copies of a day's note differ in time or content. */
function differs(a: DayNote, b: DayNote): boolean {
  return a.modifiedAt !== b.modifiedAt || !same(a, b);
}

/**
 * Merge this device's notes (`local`) with the gist's (`remote`, null when
 * the gist has no notes file), day by day: the later change wins, this
 * device's when the times are equal.
 */
export function mergeNotes(local: DayNote[], remote: DayNote[] | null, now: string): NotesMerge {
  const mine = new Map(local.map((n) => [n.date, n]));
  const theirs = new Map((remote ?? []).map((n) => [n.date, n]));
  const out: NotesMerge = { toApply: [], toDrop: [], merged: [], pushNeeded: false };
  for (const date of new Set([...mine.keys(), ...theirs.keys()])) {
    const m = mine.get(date);
    const t = theirs.get(date);
    const win = !m ? t! : !t ? m : when(t, now) > when(m, now) ? t : m;
    if (isOldNoteTombstone(win, now)) {
      if (m) out.toDrop.push(date);
      if (t) out.pushNeeded = true;
      continue;
    }
    if (t && win === t && (!m || differs(m, t))) out.toApply.push(t);
    if (!t || (win === m && differs(m, t))) out.pushNeeded = true;
    out.merged.push(win);
  }
  out.merged.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}

/**
 * The days whose note this device changed after `since` and the merge
 * replaced with a different one (FR-19.12).
 */
export function lostNotes(local: DayNote[], merged: DayNote[], since: string): LocalDate[] {
  const now = new Map(merged.map((n) => [n.date, n]));
  return local
    .filter((m) => m.modifiedAt > since)
    .filter((m) => {
      const n = now.get(m.date);
      return n !== undefined && n.modifiedAt !== m.modifiedAt && !same(m, n);
    })
    .map((m) => m.date);
}

/** A fingerprint of this device's notes: each day with its change time. */
export function notesStamp(notes: DayNote[]): string {
  return notes
    .map((n) => `${n.date}\t${n.modifiedAt}`)
    .sort()
    .join('\n');
}

/** The open note's text without blank bullets: empty when nothing is written. */
export function cleanNote(text: string): string {
  return text
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.replace(/^\s*[-*+]\s*/, '') !== '')
    .join('\n');
}

/** A note to show: each line not already a bullet becomes one, so it draws as a list (FR-7.4's Markdown). */
export function asBullets(text: string): string {
  return cleanNote(text)
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => (/^\s*([-*+]|\d+[.)])\s/.test(l) ? l : `- ${l}`))
    .join('\n');
}
