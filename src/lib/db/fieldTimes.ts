/**
 * Stamping part times (FR-19.10, model/parts.ts) on every local change.
 *
 * One place for every write: Dexie's hooks on the tasks and projects tables
 * compare each written record with its stored copy and give the parts that
 * changed the change's time, so no command has to stamp them itself. A new
 * record of any table starts with no part times.
 *
 * Writes that come from the gist (`fromSync`: sync's merge, Replace With
 * Gist and Restore, which sets every part's time itself) are left as they
 * are, so a device never re-stamps another device's change as its own.
 */
import Dexie, { type Transaction } from 'dexie';
import { nowIso } from '../model/ids';
import { changedParts, partsOf, stampParts } from '../model/parts';
import { ENTITY_NAMES, type BaseRecord } from '../model/types';
import type { MyTasksDB } from './database';

/** A transaction marked by `tx` (history.ts) as applying changes from the gist. */
type MarkedTransaction = Transaction & { fromSync?: boolean };

/** `obj` with Dexie's key-path modifications applied, as a new object. */
function withMods(obj: object, mods: Record<string, unknown>): Record<string, unknown> {
  const next = structuredClone(obj) as Record<string, unknown>;
  for (const [path, value] of Object.entries(mods)) Dexie.setByKeyPath(next, path, value);
  return next;
}

/** Install the hooks on `database`'s synced tables. */
export function installFieldTimes(database: MyTasksDB): void {
  for (const entity of ENTITY_NAMES) {
    const table = database.table(entity);
    table.hook('creating', (_id, created, trans) => {
      const obj = created as BaseRecord;
      if (!(trans as MarkedTransaction).fromSync && !obj.deletedAt) obj.ft = {};
    });
    const parts = partsOf(entity);
    if (!parts) continue;
    table.hook('updating', (mods, _id, stored, trans) => {
      if ((trans as MarkedTransaction).fromSync) return;
      const obj = stored as BaseRecord;
      const after = withMods(obj, mods as Record<string, unknown>) as unknown as BaseRecord;
      if (after.deletedAt) return;
      const changed = changedParts(parts, obj, after);
      if (!changed.length && Object.hasOwn(after, 'ft')) return;
      return { ft: stampParts(after.ft, changed, (after.modifiedAt as string | undefined) ?? nowIso()) };
    });
  }
}
