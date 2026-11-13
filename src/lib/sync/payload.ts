/**
 * The list as stored in the gist, and how two copies merge (FR-19.4).
 *
 * Pure functions, no storage access, so the rules are easy to unit-test.
 *
 * Merge rule: record by record, the copy with the later `modifiedAt` wins.
 * Records are never removed; a deletion is a tombstone (`deletedAt`), which
 * merges like any other change and keeps only `id`, `deletedAt` and
 * `modifiedAt` (model/tombstone.ts). Settings that sync merge the same way, key
 * by key. Nothing is lost when two devices change different records.
 *
 * A `modifiedAt` from the gist later than now (another device's clock runs
 * ahead) counts as now, and the corrected copy is pushed, so that device's
 * edits don't win every merge until real time catches up.
 */
import { nowIso } from '../model/ids';
import { keepsContent, tombstone } from '../model/tombstone';
import type { BaseRecord, EntityName, SettingEntry } from '../model/types';
import type { SettingKey } from '../model/settings';

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

/** Records and settings the remote copy has newer than this device. */
export interface RemoteChanges {
  tables: Partial<Record<EntityName, BaseRecord[]>>;
  settings: SettingEntry[];
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

/** Check a decrypted payload's shape before anything is applied or pushed. */
export function isPayload(x: unknown): x is Payload {
  const p = x as Partial<Payload> | null;
  if (!p || p.app !== 'mytasks' || !Number.isInteger(p.schema) || !p.tables || !Array.isArray(p.settings)) return false;
  for (const t of SYNCED_TABLES) {
    const rows = (p.tables as Record<string, unknown>)[t];
    if (!Array.isArray(rows)) return false;
    for (const r of rows as Partial<BaseRecord>[]) {
      if (!r || typeof r.id !== 'string' || typeof r.modifiedAt !== 'string') return false;
    }
  }
  return p.settings.every((s) => !!s && typeof s.key === 'string');
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

/**
 * Merge this device's copy with the gist's. Deleted records on both sides
 * are reduced to tombstones first, and the gist's timestamps later than
 * `now` count as `now`. Either correction is pushed, so the gist itself is
 * cleaned.
 */
export function mergePayloads(local: Payload, remote: Payload, now = nowIso()): MergeResult {
  const tables = {} as Record<EntityName, BaseRecord[]>;
  const toApply: RemoteChanges = { tables: {}, settings: [] };
  let pushNeeded = false;
  for (const t of SYNCED_TABLES) {
    const fromGist = notAfter(remote.tables[t].map(tombstone), now);
    const m = mergeRows(local.tables[t].map(tombstone), fromGist.rows, (r) => r.id);
    tables[t] = m.merged;
    if (m.fromRemote.length) toApply.tables[t] = m.fromRemote;
    pushNeeded ||= m.localNewer || fromGist.clamped || remote.tables[t].some(keepsContent);
  }
  const settingsFromGist = notAfter(remote.settings, now);
  pushNeeded ||= settingsFromGist.clamped;
  const s = mergeRows(local.settings, settingsFromGist.rows, (r) => r.key);
  toApply.settings = s.fromRemote;
  pushNeeded ||= s.localNewer;
  return {
    toApply,
    merged: { app: 'mytasks', schema: Math.max(local.schema, remote.schema), tables, settings: s.merged },
    pushNeeded,
  };
}
