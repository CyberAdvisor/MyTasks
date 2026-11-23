/**
 * Parts of a task or project, and when each last changed (FR-19.10).
 *
 * A task's fields are grouped into parts whose fields always change
 * together (its dates, say, are one part, so a merge can never pair one
 * device's start with the other's start date). Every task and project
 * carries `ft`: for each part changed since the record was created, the
 * time of that change, in whole seconds since 1970. A part with no time
 * counts as older than any part with one.
 *
 * Two copies of a record merge part by part (`mergeParts`): each part comes
 * from the copy that changed it later, so one device completing a task and
 * another adding a note keeps both. Other records (areas, headings,
 * checklist items, tags, contexts, saved searches) have no parts; their
 * `ft` stays empty and they merge whole, as tombstones do.
 *
 * Pure functions, no storage access.
 */
import { canonical } from './canonical';
import type { BaseRecord, EntityName, FieldTimes } from './types';

/** A task's parts, by key, and the fields each holds. */
export const TODO_PARTS: Record<string, readonly string[]> = {
  /** Completion: done or open, and when it was completed, moved to Completed or trashed. */
  s: ['status', 'completedAt', 'loggedAt', 'trashedAt'],
  t: ['title'],
  n: ['notes'],
  /** Dates: when it starts, its deadline, Today's order, its repeat, and a sequential release. */
  d: ['start', 'startDate', 'todaySortKey', 'deadline', 'repeat', 'repeatOf', 'releasedBy', 'releasedFrom'],
  p: ['priority', 'prioritySource', 'priorityBeforeAuto'],
  c: ['contextId'],
  g: ['tagIds'],
  /** Place: its area, project and heading, and its order there. */
  l: ['areaId', 'projectId', 'headingId', 'sortKey'],
};

/** A project's parts, as a task's where it has the same fields. */
export const PROJECT_PARTS: Record<string, readonly string[]> = {
  s: ['status', 'completedAt', 'loggedAt', 'trashedAt'],
  t: ['title'],
  n: ['notes'],
  d: ['start', 'startDate', 'deadline', 'repeat', 'repeatOf'],
  g: ['tagIds'],
  l: ['areaId', 'sortKey'],
  /** Other: whether its tasks are listed by date. */
  o: ['sortByDate'],
};

/** Fields that belong to no part: identity and the times that describe the whole record. */
export const RECORD_FIELDS = ['id', 'createdAt', 'modifiedAt', 'deletedAt', 'ft'];

/** Part times older than this are dropped when the record next changes, as tombstones are. */
const PART_DAYS = 180;
const DAY_SECONDS = 86_400;

/** The parts of a table's records, or null for a table that merges whole. */
export function partsOf(table: EntityName): Record<string, readonly string[]> | null {
  if (table === 'todos') return TODO_PARTS;
  if (table === 'projects') return PROJECT_PARTS;
  return null;
}

/** An ISO time as whole seconds since 1970. */
export function toSeconds(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000);
}

/** Whether two records hold the same values in `fields`. */
export function sameFields(a: Record<string, unknown>, b: Record<string, unknown>, fields: readonly string[]): boolean {
  return fields.every((f) => canonical(a[f]) === canonical(b[f]));
}

/** The parts whose values differ between two copies of a record. */
export function changedParts(parts: Record<string, readonly string[]>, before: object, after: object): string[] {
  const a = before as Record<string, unknown>;
  const b = after as Record<string, unknown>;
  return Object.keys(parts).filter((p) => !sameFields(a, b, parts[p]));
}

/**
 * The part times after a change made at `at` to `changed`: those parts get
 * `at`, the others keep their times, and times older than PART_DAYS are
 * dropped.
 */
export function stampParts(ft: FieldTimes | undefined, changed: string[], at: string): FieldTimes {
  const now = toSeconds(at);
  const next: FieldTimes = {};
  for (const [p, t] of Object.entries(ft ?? {})) if (now - t <= PART_DAYS * DAY_SECONDS) next[p] = t;
  for (const p of changed) next[p] = now;
  return next;
}

/** Every part of `parts` changed at `at`: a restored backup's records win every part (FR-12.8). */
export function allParts(parts: Record<string, readonly string[]>, at: string): FieldTimes {
  return Object.fromEntries(Object.keys(parts).map((p) => [p, toSeconds(at)]));
}

/**
 * Merge two copies of a task or project. `winner` is the copy that wins as
 * a whole (the later `modifiedAt`); each part the other copy changed later,
 * with a different value, is taken from it instead. Part times later than
 * `nowSeconds` count as now. Returns `winner` itself when nothing is taken
 * from the other copy, else a new record with the later `modifiedAt` and
 * each part's later time.
 */
export function mergeParts<T extends BaseRecord>(
  parts: Record<string, readonly string[]>,
  winner: T,
  other: T,
  nowSeconds: number,
): T {
  if (winner.deletedAt || other.deletedAt) return winner;
  const timeOf = (r: T, p: string) => Math.min(r.ft?.[p] ?? -1, nowSeconds);
  const w = winner as unknown as Record<string, unknown>;
  const o = other as unknown as Record<string, unknown>;
  const taken = Object.keys(parts).filter((p) => timeOf(other, p) > timeOf(winner, p) && !sameFields(w, o, parts[p]));
  if (!taken.length) return winner;
  const merged: Record<string, unknown> = { ...w };
  for (const p of taken) for (const f of parts[p]) merged[f] = o[f];
  const ft: FieldTimes = { ...winner.ft };
  for (const p of taken) ft[p] = timeOf(other, p);
  merged.ft = ft;
  return merged as unknown as T;
}
