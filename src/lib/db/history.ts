/**
 * Transactions, and multi-step undo and redo (FR-DM.2, FR-1.6).
 *
 * Every user change runs through `tx`, which opens one read-write transaction
 * over all tables. Dexie table hooks record the state of each record before
 * the transaction first touches it. Those "before" copies form one undo step.
 *
 * - The last UNDO_LIMIT steps are kept, in memory only (lost on reload).
 *   `undo` writes the newest step back and keeps the records as they were
 *   just before, as a redo step; `redo` does the same the other way round.
 *   A new change clears the redo steps.
 * - A step whose records a sync from the gist has changed since is stale:
 *   undoing or redoing it would overwrite the other device's newer edit, so
 *   it is dropped instead (the result says so) and the next call goes on to
 *   the step before it.
 * - Changes the app makes on its own (the automatic priority sweep, settings)
 *   run with `track: false`, so they never become undo steps.
 * - `undoGroup` merges several transactions into one step, for actions made of
 *   more than one call (create a to-do, then place it, or change several
 *   selected tasks); its `onTodosChanged` listeners hear once, at the end.
 * - Every committed change except one applied from the gist notifies the
 *   `onLocalChange` listeners, so sync can push it (FR-19.5).
 * - A tracked change also passes the tasks it touched, as they were before,
 *   to the `onTodosChanged` listeners, which show where a task went when it
 *   leaves the Inbox (FR-1.10). Undo and sync are untracked, so they don't.
 */
import Dexie, { type Transaction } from 'dexie';
import { db, type MyTasksDB } from './database';
import { nowIso } from '../model/ids';
import { bury } from './bury';
import { ENTITY_NAMES, type BaseRecord, type EntityName, type ID, type Todo } from '../model/types';
import { installFieldTimes } from './fieldTimes';

/** Tables that hold entities (everything except the log and settings). */
const ENTITY_TABLES = ENTITY_NAMES;

/** One undoable change: each touched record as it was before (undefined when created). */
class UndoStep {
  readonly before = new Map<string, { entity: EntityName; id: ID; record: BaseRecord | undefined }>();

  /** Keep the first "before" copy of each record; later writes in the step do not replace it. */
  /** Set when a sync from the gist has written one of the step's records since. */
  stale = false;

  record(entity: EntityName, id: ID, record: BaseRecord | undefined): void {
    const k = key(entity, id);
    if (!this.before.has(k)) this.before.set(k, { entity, id, record: record && JSON.parse(JSON.stringify(record)) });
  }
}

/** How many undo steps are kept (FR-1.6). */
export const UNDO_LIMIT = 10;

/** What `undo` and `redo` did: applied a step, found none, or dropped a stale one. */
type UndoResult = 'done' | 'none' | 'stale';

/**
 * A Dexie transaction carrying the step its writes belong to, or marked as
 * applying changes from the gist.
 */
type TrackedTransaction = Transaction & { undoStep?: UndoStep | null; fromSync?: boolean };

/** Undo steps, oldest first; redo steps, the next one to redo last. */
let undoStack: UndoStep[] = [];
let redoStack: UndoStep[] = [];
let group: UndoStep | null = null;

const key = (entity: EntityName, id: ID) => `${entity}:${id}`;

/** Add a new user change: it becomes the newest undo step and clears redo. */
function pushStep(step: UndoStep): void {
  undoStack.push(step);
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  redoStack = [];
}

/** A sync wrote this record: any kept step that holds it is now stale. */
function markSynced(entity: EntityName, id: ID): void {
  const k = key(entity, id);
  for (const step of [...undoStack, ...redoStack]) if (step.before.has(k)) step.stale = true;
}

/** Record writes made inside tracked transactions. */
function installHooks(database: MyTasksDB): void {
  for (const entity of ENTITY_TABLES) {
    const table = database.table(entity);
    const seen = (trans: Transaction, id: unknown, before: BaseRecord | undefined) => {
      const t = trans as TrackedTransaction;
      if (t.fromSync) markSynced(entity, id as ID);
      else t.undoStep?.record(entity, id as ID, before);
    };
    table.hook('creating', (id, _obj, trans) => seen(trans, id, undefined));
    table.hook('updating', (_mods, id, obj, trans) => seen(trans, id, obj as BaseRecord));
    table.hook('deleting', (id, obj, trans) => seen(trans, id, obj as BaseRecord));
  }
}
installHooks(db);
installFieldTimes(db);

/**
 * Empty the old change log (FR-DM.3). Until 1.3.7 every change added a row
 * there, and nothing read them (review C2). The table stays defined, empty,
 * until a later schema version can drop it: dropping it now would make
 * devices on the older app refuse the gist's newer schema.
 */
export function clearChangeLog(): Promise<void> {
  return db.changeLog.clear();
}

const listeners = new Set<() => void>();
const todoListeners = new Set<(before: Todo[]) => void>();

/** Call `fn` after every committed local change. Returns a function that stops it. */
export function onLocalChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Call `fn` after every committed tracked change with the tasks it touched,
 * as they were before it (tasks it created are left out). Returns a
 * function that stops it.
 */
export function onTodosChanged(fn: (before: Todo[]) => void): () => void {
  todoListeners.add(fn);
  return () => todoListeners.delete(fn);
}

/** The tasks a step touched, as they were before it. */
function todosBefore(step: UndoStep): Todo[] {
  return [...step.before.values()].filter((b) => b.entity === 'todos' && b.record).map((b) => b.record as Todo);
}

/**
 * Run `fn` in one read-write transaction over every table. With `track`
 * (the default) its writes become the newest undo step. `fromSync` marks
 * changes that came from the gist: they are not local changes, and they make
 * any kept step holding the same records stale.
 */
export async function tx<T>(
  fn: () => Promise<T>,
  { track = true, fromSync = false }: { track?: boolean; fromSync?: boolean } = {},
): Promise<T> {
  const step = track ? (group ?? new UndoStep()) : null;
  const tables = [...ENTITY_TABLES.map((n) => db.table(n)), db.changeLog, db.settings];
  // The callback must be an async function: Dexie then keeps the transaction
  // alive across awaits in nested async calls. A plain callback returning
  // fn()'s promise lets IndexedDB commit early when one change awaits a
  // helper that awaits another (PrematureCommitError), as in a sequential
  // project releasing its next task.
  const result = await db.transaction('rw', tables, async () => {
    const t = Dexie.currentTransaction as TrackedTransaction;
    t.undoStep = step;
    t.fromSync = fromSync;
    return await fn();
  });
  if (step && step !== group && step.before.size) pushStep(step);
  if (!fromSync) for (const l of listeners) l();
  // A group tells the listeners once, when it ends (undoGroup).
  if (step && step !== group && !fromSync) notifyTodos(step);
  return result;
}

/** Pass the tasks a step touched, as they were before it, to the onTodosChanged listeners. */
function notifyTodos(step: UndoStep): void {
  if (!todoListeners.size) return;
  const before = todosBefore(step);
  if (before.length) for (const l of todoListeners) l(before);
}

/** Run `fn` so that all its tracked transactions form a single undo step. */
export async function undoGroup<T>(fn: () => Promise<T>): Promise<T> {
  if (group) return fn();
  const step = (group = new UndoStep());
  try {
    const result = await fn();
    if (step.before.size) pushStep(step);
    group = null;
    notifyTodos(step);
    return result;
  } finally {
    group = null;
  }
}

/**
 * Write a step's records back: restore each one it touched, and replace
 * records it created with tombstones (model/tombstone.ts), so the deletion
 * syncs like any change. Returns the opposite step: the records as they were
 * just before, so the step can be taken back again.
 */
async function apply(step: UndoStep): Promise<UndoStep> {
  const opposite = new UndoStep();
  await tx(
    async () => {
      const at = nowIso();
      for (const { entity, id, record } of step.before.values()) {
        opposite.record(entity, id, (await db.table(entity).get(id)) as BaseRecord | undefined);
        if (record) {
          await db.table(entity).put({ ...record, modifiedAt: at });
        } else await bury(entity, [id], at);
      }
    },
    { track: false },
  );
  return opposite;
}

/** Take the newest step from `from`, apply it, and keep its opposite on `to`. */
async function step(from: UndoStep[], to: UndoStep[]): Promise<UndoResult> {
  const s = from.pop();
  if (!s) return 'none';
  if (s.stale) return 'stale';
  to.push(await apply(s));
  if (to.length > UNDO_LIMIT) to.shift();
  return 'done';
}

/** Undo the newest change (FR-1.6), keeping it for redo. */
export function undo(): Promise<UndoResult> {
  return step(undoStack, redoStack);
}

/** True when there is a step to undo. */
export function canUndo(): boolean {
  return undoStack.length > 0;
}

/** Redo the change undone last (FR-1.6), keeping it for undo. */
export function redo(): Promise<UndoResult> {
  return step(redoStack, undoStack);
}

/**
 * Forget every undo and redo step: after a change that cannot be undone
 * (Empty Trash, Delete Immediately, Restore from Backup), and in tests.
 */
export function clearUndo(): void {
  undoStack = [];
  redoStack = [];
}
