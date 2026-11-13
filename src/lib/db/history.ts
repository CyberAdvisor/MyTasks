/**
 * Transactions, the change log and single-step undo (FR-DM.2, FR-DM.3, FR-1.6).
 *
 * Every user change runs through `tx`, which opens one read-write transaction
 * over all tables. Dexie table hooks record the state of each record before
 * the transaction first touches it. Those "before" copies form one undo step;
 * `undo` writes them back.
 *
 * - Only the last step is kept (v1). Multi-step undo and redo (v1.1) turn
 *   `last` into a stack.
 * - Changes the app makes on its own (the automatic priority sweep, settings)
 *   run with `track: false`, so they never replace the user's last change.
 * - `undoGroup` merges several transactions into one step, for actions made of
 *   more than one call (create a to-do, then place it).
 * - Every committed change except one applied from the gist notifies the
 *   `onLocalChange` listeners, so sync can push it (FR-19.5).
 */
import Dexie, { type Transaction } from 'dexie';
import { db, type MyTasksDB } from './database';
import { nowIso } from '../model/ids';
import { bury } from './bury';
import type { BaseRecord, EntityName, ID } from '../model/types';

/** Tables that hold entities (everything except the log and settings). */
const ENTITY_TABLES: EntityName[] = [
  'areas',
  'projects',
  'headings',
  'todos',
  'checklistItems',
  'tags',
  'contexts',
  'savedSearches',
];

/** One undoable change: each touched record as it was before (undefined when created). */
class UndoStep {
  readonly before = new Map<string, { entity: EntityName; id: ID; record: BaseRecord | undefined }>();

  /** Keep the first "before" copy of each record; later writes in the step do not replace it. */
  record(entity: EntityName, id: ID, record: BaseRecord | undefined): void {
    const k = `${entity}:${id}`;
    if (!this.before.has(k)) this.before.set(k, { entity, id, record: record && JSON.parse(JSON.stringify(record)) });
  }
}

/** A Dexie transaction carrying the step its writes belong to. */
type TrackedTransaction = Transaction & { undoStep?: UndoStep | null };

let last: UndoStep | null = null;
let group: UndoStep | null = null;

/** Record writes made inside tracked transactions. */
function installHooks(database: MyTasksDB): void {
  for (const entity of ENTITY_TABLES) {
    const table = database.table(entity);
    table.hook('creating', (id, _obj, trans) => {
      (trans as TrackedTransaction).undoStep?.record(entity, id as ID, undefined);
    });
    table.hook('updating', (_mods, id, obj, trans) => {
      (trans as TrackedTransaction).undoStep?.record(entity, id as ID, obj as BaseRecord);
    });
    table.hook('deleting', (id, obj, trans) => {
      (trans as TrackedTransaction).undoStep?.record(entity, id as ID, obj as BaseRecord);
    });
  }
}
installHooks(db);

/** Append one change-log row; call inside a transaction. */
export function log(entity: EntityName, entityId: ID, fields: string[]): Promise<number> {
  return db.changeLog.add({ entity, entityId, fields, at: nowIso() });
}

const listeners = new Set<() => void>();

/** Call `fn` after every committed local change. Returns a function that stops it. */
export function onLocalChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Run `fn` in one read-write transaction over every table. With `track`
 * (the default) its writes become the step `undo` reverses. `fromSync`
 * marks changes that came from the gist: they are not local changes.
 */
export async function tx<T>(
  fn: () => Promise<T>,
  { track = true, fromSync = false }: { track?: boolean; fromSync?: boolean } = {},
): Promise<T> {
  const step = track ? (group ?? new UndoStep()) : null;
  const tables = [...ENTITY_TABLES.map((n) => db.table(n)), db.changeLog, db.settings];
  const result = await db.transaction('rw', tables, () => {
    (Dexie.currentTransaction as TrackedTransaction).undoStep = step;
    return fn();
  });
  if (step && step !== group && step.before.size) last = step;
  if (!fromSync) for (const l of listeners) l();
  return result;
}

/** Run `fn` so that all its tracked transactions form a single undo step. */
export async function undoGroup<T>(fn: () => Promise<T>): Promise<T> {
  if (group) return fn();
  const step = (group = new UndoStep());
  try {
    const result = await fn();
    if (step.before.size) last = step;
    return result;
  } finally {
    group = null;
  }
}

/**
 * Undo the last change: restore each record it touched, and replace records
 * it created with tombstones (model/tombstone.ts), so the deletion syncs like any change.
 * Returns false when there is nothing to undo.
 */
export async function undo(): Promise<boolean> {
  const step = last;
  if (!step) return false;
  last = null;
  await tx(
    async () => {
      const at = nowIso();
      for (const { entity, id, record } of step.before.values()) {
        if (record) {
          await db.table(entity).put({ ...record, modifiedAt: at });
          await log(entity, id, ['*']);
        } else await bury(entity, [id], at);
      }
    },
    { track: false },
  );
  return true;
}

/** Forget the last step: after a change that cannot be undone (Empty Trash, Delete Immediately), and in tests. */
export function clearUndo(): void {
  last = null;
}
