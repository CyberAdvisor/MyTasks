/**
 * The list as stored in the gist, and how two copies merge (FR-19.4).
 *
 * Pure functions, no storage access, so the rules are easy to unit-test.
 *
 * Merge rule: record by record, the copy with the later `modifiedAt` wins.
 * Records are never removed; a deletion is a tombstone (`deletedAt`), which
 * merges like any other change and keeps only `id`, `deletedAt` and
 * `modifiedAt` (model/tombstone.ts). Settings that sync merge the same way, key
 * by key. Changes to different records on two devices are both kept once both
 * devices have synced.
 *
 * A `modifiedAt` later than now, from the gist or on this device (a clock
 * that ran ahead), counts as now. The corrected copy is pushed, and saved on
 * this device, so those edits don't win every merge until real time catches
 * up.
 */
import { nowIso } from '../model/ids';
import { keepsContent, tombstone } from '../model/tombstone';
import type { BaseRecord, EntityName, SettingEntry } from '../model/types';
import type { SettingKey } from '../model/settings';
import { isValidRecord, isValidSetting } from './validate';

/** Entity tables that sync: every one except the local change log. */
export const SYNCED_TABLES: EntityName[] = [
  'areas',
  'projects',
  'headings',
  'todos',
  'checklistItems',
  'tags',
  'contexts',
  'savedSearches',
];

/**
 * Settings that sync (decided 2026-11-11). Theme stays per device, like the
 * sidebar's remembered collapsed state.
 */
export const SYNCED_SETTINGS: SettingKey[] = [
  'priorityLabels',
  'autoP1',
  'defaultP2',
  'todayGrouping',
  'moveToCompleted',
  'sinkCompleted',
  'sinkChecked',
];

/** The decrypted contents of the gist. */
export interface Payload {
  app: 'mytasks';
  /** Database schema version the records follow. */
  schema: number;
  tables: Record<EntityName, BaseRecord[]>;
  settings: SettingEntry[];
}

/**
 * What a merge writes on this device: records and settings the remote copy
 * has newer, and this device's own copies whose future time was corrected.
 */
export interface RemoteChanges {
  tables: Partial<Record<EntityName, BaseRecord[]>>;
  settings: SettingEntry[];
  /**
   * For each row above (the same object), the `modifiedAt` this device had
   * when the merge read it (undefined when it had none). While the device
   * still has that time, the merge's choice stands; once it has changed (an
   * edit made during the sync), only a later time replaces it.
   */
  seen?: Map<object, string | undefined>;
}

/** The result of merging this device's copy with the gist's. */
export interface MergeResult {
  /** What to write on this device. */
  toApply: RemoteChanges;
  /** The merged list, to write to the gist when `pushNeeded`. */
  merged: Payload;
  /** This device has something the gist lacks. */
  pushNeeded: boolean;
}

/**
 * Check a decrypted payload before anything is applied or pushed: its shape,
 * every record and setting field by field (sync/validate.ts), and no record
 * id or setting key twice.
 */
export function isPayload(x: unknown): x is Payload {
  const p = x as Partial<Payload> | null;
  if (!p || p.app !== 'mytasks' || !Number.isInteger(p.schema) || !p.tables || !Array.isArray(p.settings)) return false;
  for (const t of SYNCED_TABLES) {
    const rows = Object.hasOwn(p.tables, t) ? (p.tables as Record<string, unknown>)[t] : undefined;
    if (!Array.isArray(rows) || !rows.every((r) => isValidRecord(t, r)) || !unique(rows.map((r) => (r as BaseRecord).id))) return false;
  }
  return p.settings.every(isValidSetting) && unique(p.settings.map((s) => s.key));
}

/** Whether no value appears twice: one record per id, one entry per setting key. */
function unique(values: string[]): boolean {
  return new Set(values).size === values.length;
}

/** Whether `a` is a later edit than `b` (ISO timestamps compare as text). */
function later(a: string | undefined, b: string | undefined): boolean {
  return (a ?? '') > (b ?? '');
}

/** JSON with object keys sorted, so equal content gives equal text. */
function canonical(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(canonical).join(',')}]`;
  if (x && typeof x === 'object') {
    const o = x as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(x) ?? 'null';
}

/** The same content, ignoring key order. */
function same(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

/**
 * Merge records keyed by `keyOf`, the later `modifiedAt` winning. On a tie
 * with different content the remote copy wins, so every device settles on
 * the same version.
 */
function mergeRows<T extends { modifiedAt?: string }>(
  local: T[],
  remote: T[],
  keyOf: (r: T) => string,
): { merged: T[]; fromRemote: T[]; localNewer: boolean } {
  const byKey = new Map(local.map((r) => [keyOf(r), r]));
  const fromRemote: T[] = [];
  for (const r of remote) {
    const l = byKey.get(keyOf(r));
    if (!l || later(r.modifiedAt, l.modifiedAt) || (r.modifiedAt === l.modifiedAt && !same(r, l))) {
      byKey.set(keyOf(r), r);
      fromRemote.push(r);
    }
  }
  const remoteByKey = new Map(remote.map((r) => [keyOf(r), r]));
  const localNewer = local.some((l) => {
    const r = remoteByKey.get(keyOf(l));
    return !r || later(l.modifiedAt, r.modifiedAt);
  });
  return { merged: [...byKey.values()], fromRemote, localNewer };
}

/**
 * A copy of `rows` with every `modifiedAt` later than `now` set to `now`.
 * `clamped` tells whether any changed.
 */
function notAfter<T extends { modifiedAt?: string }>(rows: T[], now: string): { rows: T[]; clamped: boolean } {
  let clamped = false;
  const out = rows.map((r) => {
    if (!r.modifiedAt || r.modifiedAt <= now) return r;
    clamped = true;
    return { ...r, modifiedAt: now };
  });
  return { rows: out, clamped };
}

/** The result of merging one table, or the settings, keyed by `keyOf`. */
interface SideResult<T> {
  merged: T[];
  /** Rows to write on this device. */
  toApply: T[];
  pushNeeded: boolean;
}

/**
 * Merge one table (or the settings) after correcting future times on both
 * sides. Rows to write here are the gist's newer ones and this device's own
 * corrected winners, each recorded in `seen` with the time this device had.
 */
function mergeSide<T extends { modifiedAt?: string }>(
  localRows: T[],
  remoteRows: T[],
  keyOf: (r: T) => string,
  now: string,
  seen: Map<object, string | undefined>,
): SideResult<T> {
  const local = notAfter(localRows, now);
  const remote = notAfter(remoteRows, now);
  const m = mergeRows(local.rows, remote.rows, keyOf);
  const before = new Map(localRows.map((r) => [keyOf(r), r.modifiedAt]));
  for (const r of m.fromRemote) seen.set(r, before.get(keyOf(r)));
  // This device's corrected copies that won: save the correction here too.
  const kept = new Set(m.merged);
  const corrected = local.rows.filter((r, i) => r !== localRows[i] && kept.has(r));
  for (const r of corrected) seen.set(r, before.get(keyOf(r)));
  return {
    merged: m.merged,
    toApply: [...m.fromRemote, ...corrected],
    pushNeeded: m.localNewer || local.clamped || remote.clamped,
  };
}

/**
 * Merge this device's copy with the gist's. Deleted records on both sides
 * are reduced to tombstones first, and times later than `now`, on either
 * side, count as `now`. Every correction is pushed, so the gist itself is
 * cleaned, and this device's corrections are written back here too.
 */
export function mergePayloads(local: Payload, remote: Payload, now = nowIso()): MergeResult {
  const tables = {} as Record<EntityName, BaseRecord[]>;
  const seen = new Map<object, string | undefined>();
  const toApply: RemoteChanges = { tables: {}, settings: [], seen };
  let pushNeeded = false;
  for (const t of SYNCED_TABLES) {
    const m = mergeSide(local.tables[t].map(tombstone), remote.tables[t].map(tombstone), (r) => r.id, now, seen);
    tables[t] = m.merged;
    if (m.toApply.length) toApply.tables[t] = m.toApply;
    pushNeeded ||= m.pushNeeded || remote.tables[t].some(keepsContent);
  }
  const s = mergeSide(local.settings, remote.settings, (r) => r.key, now, seen);
  toApply.settings = s.toApply;
  pushNeeded ||= s.pushNeeded;
  return {
    toApply,
    merged: { app: 'mytasks', schema: Math.max(local.schema, remote.schema), tables, settings: s.merged },
    pushNeeded,
  };
}
