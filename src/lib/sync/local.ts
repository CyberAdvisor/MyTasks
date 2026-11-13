/**
 * This device's side of sync: read the whole list as a payload, and write
 * the changes that came from the gist (FR-19.4).
 */
import { db, SCHEMA_VERSION } from '../db/database';
import { tx } from '../db/history';
import { tombstone } from '../model/tombstone';
import type { BaseRecord, EntityName, SettingEntry } from '../model/types';
import { SYNCED_SETTINGS, SYNCED_TABLES, type Payload, type RemoteChanges } from './payload';

/** Every record (deleted ones as tombstones only) and the settings that sync. */
export async function readLocal(): Promise<Payload> {
  const tables = {} as Record<EntityName, BaseRecord[]>;
  for (const t of SYNCED_TABLES) tables[t] = ((await db.table(t).toArray()) as BaseRecord[]).map(tombstone);
  const keys = new Set<string>(SYNCED_SETTINGS);
  const settings = (await db.settings.toArray()).filter((s) => keys.has(s.key));
  return { app: 'mytasks', schema: SCHEMA_VERSION, tables, settings };
}

/** Whether `incoming` should replace `current` (the later edit wins). */
function newer(incoming: { modifiedAt?: string }, current: { modifiedAt?: string } | undefined): boolean {
  return !current || (incoming.modifiedAt ?? '') >= (current.modifiedAt ?? '');
}

/**
 * Write the gist's newer records and settings in one transaction. Each is
 * checked again against this device's current copy, so an edit made while
 * the gist was being read is never overwritten by an older one. These
 * changes are not undo steps and are not pushed back.
 */
export function applyRemote(changes: RemoteChanges): Promise<void> {
  return tx(
    async () => {
      for (const [table, rows] of Object.entries(changes.tables) as [EntityName, BaseRecord[]][]) {
        const current = await db.table(table).bulkGet(rows.map((r) => r.id));
        const put = rows.filter((r, i) => newer(r, current[i] as BaseRecord | undefined));
        if (put.length) await db.table(table).bulkPut(put);
      }
      const synced = new Set<string>(SYNCED_SETTINGS);
      for (const s of changes.settings.filter((x) => synced.has(x.key))) {
        if (newer(s, (await db.settings.get(s.key)) as SettingEntry | undefined)) await db.settings.put(s);
      }
    },
    { track: false, fromSync: true },
  );
}
