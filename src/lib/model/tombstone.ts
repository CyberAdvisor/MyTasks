/**
 * Deleted records keep nothing but what sync needs (security review,
 * 2026-11-13): `id`, `deletedAt` and `modifiedAt`. Titles, notes, checklist
 * text and every other field are dropped, on the device (db/bury.ts) and in
 * uploads and merges (sync/local.ts, sync/payload.ts).
 *
 * Undo still works: the undo step keeps its own copy of each record from
 * before the change (db/history.ts), and writes it back.
 */
import type { BaseRecord } from './types';

/** The record as stored: a deleted one stripped to its tombstone, any other unchanged. */
export function tombstone<T extends BaseRecord>(record: T): T {
  if (!record.deletedAt) return record;
  const { id, deletedAt, modifiedAt } = record;
  return { id, deletedAt, modifiedAt } as T;
}

/** True when a deleted record still holds more than its tombstone (written by 0.7.1 or earlier). */
export function keepsContent(record: BaseRecord): boolean {
  return !!record.deletedAt && Object.keys(record).some((k) => k !== 'id' && k !== 'deletedAt' && k !== 'modifiedAt');
}
