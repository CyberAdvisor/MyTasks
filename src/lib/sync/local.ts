/**
 * This device's side of sync: read the whole list as a payload, write the
 * changes that came from the gist (FR-19.4), and write a restored backup
 * (FR-12.8).
 */
import { db, SCHEMA_VERSION } from '../db/database';
import { tx } from '../db/history';
import { tombstone } from '../model/tombstone';
import type { BaseRecord, EntityName, SettingEntry } from '../model/types';
import { SYNCED_SETTINGS, SYNCED_TABLES, isOldTombstone, replacement, type Payload, type RemoteChanges } from './payload';
import { nowIso } from '../model/ids';

/**
 * Delete this device's tombstones older than TOMBSTONE_DAYS (payload.ts). Run
 * at launch, on each return to the app and before each sync. Not an undo
 * step, and not a change to sync: the gist drops its own at the next merge.
 */
export function dropOldTombstones(now = nowIso()): Promise<void> {
  return tx(
    async () => {
      for (const t of SYNCED_TABLES) {
        const old = ((await db.table(t).toArray()) as BaseRecord[]).filter((r) => isOldTombstone(r, now)).map((r) => r.id);
        if (old.length) await db.table(t).bulkDelete(old);
      }
    },
    { track: false, fromSync: true },
  );
}

/**
 * Make this device's list exactly the gist's `remote` (Replace With Gist, for
 * a device away longer than AWAY_DAYS): every synced table and synced
 * setting replaced. Settings that stay on the device (theme) are kept. Not an
 * undo step.
 */
export function adoptRemote(remote: Payload): Promise<void> {
  return tx(
    async () => {
      for (const t of SYNCED_TABLES) {
        await db.table(t).clear();
        await db.table(t).bulkPut(remote.tables[t].map(tombstone));
      }
      const keys = new Set<string>(SYNCED_SETTINGS);
      await db.settings.bulkDelete((await db.settings.toArray()).filter((s) => keys.has(s.key)).map((s) => s.key));
      await db.settings.bulkPut(remote.settings.filter((s) => keys.has(s.key)));
    },
    { track: false, fromSync: true },
  );
}

/**
 * Every record (deleted ones as tombstones only) and the settings that sync,
 * read in one transaction, so the copy is one consistent snapshot even
 * while another window is making changes.
 */
export function readLocal(): Promise<Payload> {
  const stores = [...SYNCED_TABLES.map((t) => db.table(t)), db.settings];
  return db.transaction('r', stores, async () => {
    const tables = {} as Record<EntityName, BaseRecord[]>;
    for (const t of SYNCED_TABLES) tables[t] = ((await db.table(t).toArray()) as BaseRecord[]).map(tombstone);
    const keys = new Set<string>(SYNCED_SETTINGS);
    const settings = (await db.settings.toArray()).filter((s) => keys.has(s.key));
    return { app: 'mytasks' as const, schema: SCHEMA_VERSION, tables, settings };
  });
}

/**
 * Whether `incoming` should replace `current`. While this device still has
 * the time the merge saw (`seen`), the merge's choice stands: that is how a
 * corrected future time replaces the future one. Otherwise only a later or
 * equal edit replaces it, so an edit made during the sync is kept.
 */
function replaces(
  incoming: { modifiedAt?: string },
  current: { modifiedAt?: string } | undefined,
  seen: Map<object, string | undefined> | undefined,
): boolean {
  if (!current) return true;
  if (seen?.has(incoming) && seen.get(incoming) === current.modifiedAt) return true;
  return (incoming.modifiedAt ?? '') >= (current.modifiedAt ?? '');
}

/**
 * Write the merge's changes in one transaction: the gist's newer records and
 * settings, and this device's corrected times. Each is checked again against
 * this device's current copy, so an edit made while the gist was being read
 * is never overwritten. These changes are not undo steps and are not pushed
 * back.
 */
export function applyRemote(changes: RemoteChanges): Promise<void> {
  return tx(
    async () => {
      for (const [table, rows] of Object.entries(changes.tables) as [EntityName, BaseRecord[]][]) {
        const current = await db.table(table).bulkGet(rows.map((r) => r.id));
        const put = rows.filter((r, i) => replaces(r, current[i] as BaseRecord | undefined, changes.seen));
        if (put.length) await db.table(table).bulkPut(put);
      }
      const synced = new Set<string>(SYNCED_SETTINGS);
      for (const s of changes.settings.filter((x) => synced.has(x.key))) {
        if (replaces(s, (await db.settings.get(s.key)) as SettingEntry | undefined, changes.seen)) await db.settings.put(s);
      }
    },
    { track: false, fromSync: true },
  );
}

/**
 * Replace everything on this device with a backup (FR-12.8), in one
 * transaction: `replacement` (payload.ts) stamps the backup's records and
 * settings as changed `now`, and makes a tombstone of every other record,
 * on this device or in the gist (`gistIds`). This device's ids are read
 * inside the transaction, so a record another window added meanwhile is
 * covered too. Not an undo step.
 */
export function replaceLocal(backup: Payload, gistIds: Partial<Record<EntityName, string[]>>, now: string): Promise<void> {
  return tx(
    async () => {
      const known = {} as Record<EntityName, string[]>;
      for (const t of SYNCED_TABLES) known[t] = [...((await db.table(t).toCollection().primaryKeys()) as string[]), ...(gistIds[t] ?? [])];
      const next = replacement(backup, known, now);
      for (const t of SYNCED_TABLES) await db.table(t).bulkPut(next.tables[t]);
      await db.settings.bulkPut(next.settings);
    },
    { track: false, fromSync: true },
  );
}
