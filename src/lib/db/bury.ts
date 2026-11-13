/**
 * Delete records on this device: each is replaced by its tombstone, keeping
 * only `id`, `deletedAt` and `modifiedAt` (model/tombstone.ts).
 */
import { db } from './database';
import type { BaseRecord, EntityName, ID } from '../model/types';

/**
 * Replace records with their tombstones and log the change. Call inside a
 * transaction. Returns Dexie's own promise, not an `async` one, so the
 * transaction stays open (see DEVELOPMENT.md, Data).
 */
export function bury(entity: EntityName, ids: ID[], at: string): Promise<unknown> {
  if (!ids.length) return Promise.resolve();
  return db
    .table(entity)
    .where(':id')
    .anyOf(ids)
    .modify((record: BaseRecord, ctx) => {
      ctx.value = { id: record.id, deletedAt: at, modifiedAt: at };
    })
    .then(() => db.changeLog.bulkAdd(ids.map((entityId) => ({ entity, entityId, fields: ['deletedAt'], at }))));
}
