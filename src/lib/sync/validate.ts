/**
 * Field-by-field checks for everything that sync reads or writes (security
 * review, 2026-11-13, fix 4). A gist file whose records or settings fail is
 * never applied, and this device's own list is checked the same way before
 * it is uploaded (FR-19.5).
 *
 * Every field of every record is listed here with its type, matching
 * model/types.ts. A record with a field missing, a field of the wrong type
 * or a field not listed fails. When a field is added to a record type, add
 * it here too (the unit tests build every kind of record through the app's
 * own functions, so a missing rule shows up as a failing test).
 *
 * Deleted records are checked on `id`, `deletedAt` and `modifiedAt` only:
 * anything else they still hold (written by 0.7.1 or earlier) is dropped by
 * the merge (model/tombstone.ts), never applied.
 *
 * Only a record's own fields count (never inherited names such as
 * `toString`), and a rule passes only by returning exactly `true`. Dates and
 * timestamps must be real ones, timestamps in the one form the app writes
 * (`toISOString()`, so they compare correctly as text), and ordering keys
 * must be keys fractional-indexing accepts. Duplicate ids and setting keys
 * are refused in payload.ts.
 */
import { generateKeyBetween } from 'fractional-indexing';
import { PRIORITIES, MOVE_TO_COMPLETED, UNSCHEDULED_LIMITS } from '../model/settings';
import type { EntityName, SettingEntry } from '../model/types';

/** A check for one field's value. */
type Rule = (v: unknown) => boolean;

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

const str: Rule = (v) => typeof v === 'string';
const id: Rule = (v) => typeof v === 'string' && v.length > 0;
const bool: Rule = (v) => typeof v === 'boolean';

/** A real time, written exactly as `toISOString()` writes it (2026-11-13T17:00:00.000Z). */
const timestamp: Rule = (v) => {
  if (typeof v !== 'string' || !ISO_TIMESTAMP.test(v)) return false;
  const t = new Date(v);
  return !Number.isNaN(t.getTime()) && t.toISOString() === v;
};

/** A real calendar date, YYYY-MM-DD (not 2026-02-30). */
const date: Rule = (v) => typeof v === 'string' && LOCAL_DATE.test(v) && timestamp(`${v}T00:00:00.000Z`);

/** An ordering key fractional-indexing accepts: it can place a key after it. */
const orderKey: Rule = (v) => {
  if (typeof v !== 'string') return false;
  try {
    generateKeyBetween(v, null);
    return true;
  } catch {
    return false;
  }
};
const ids: Rule = (v) => Array.isArray(v) && v.every(id);
const oneOf =
  (...values: unknown[]): Rule =>
  (v) =>
    values.includes(v);
const orNull =
  (rule: Rule): Rule =>
  (v) =>
    v === null || rule(v);

const status = oneOf('open', 'completed', 'canceled');
const priority = oneOf(...PRIORITIES);
const todoStart = oneOf('inbox', 'unscheduled', 'deferred');

/** A plain object (not an array). */
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A whole number from `min` to `max`. */
const int =
  (min: number, max: number): Rule =>
  (v) =>
    Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

/** A repeat rule (model/types.ts, RepeatRule; FR-4.1). */
const repeatRule: Rule = (v) =>
  isObject(v) &&
  matches(v, {
    mode: oneOf('fixed', 'afterCompletion'),
    unit: oneOf('day', 'week', 'month', 'year'),
    interval: int(1, 999),
    weekdays: (w) => Array.isArray(w) && w.every(int(0, 6)),
    days: (d) =>
      Array.isArray(d) &&
      d.every((x) => isObject(x) && matches(x, { ordinal: (o) => o === -1 || int(1, 31)(o), weekday: orNull(int(0, 6)) })),
    month: orNull(int(1, 12)),
    endCount: orNull(int(1, 9999)),
    endDate: orNull(date),
    made: int(0, Number.MAX_SAFE_INTEGER),
    deadlineDays: orNull(int(0, 999)),
    paused: bool,
  });

/** Fields every record carries (BaseRecord), for a record that isn't deleted. */
const BASE: Record<string, Rule> = {
  id,
  createdAt: timestamp,
  modifiedAt: timestamp,
  deletedAt: oneOf(null),
  sortKey: orderKey,
};

/** The three fields checked on a deleted record. */
const TOMBSTONE: Record<string, Rule> = { id, deletedAt: timestamp, modifiedAt: timestamp };

/** Each synced table's own fields (model/types.ts). */
const FIELDS: Record<EntityName, Record<string, Rule>> = {
  areas: { title: str, tagIds: ids, collapsed: bool },
  projects: {
    title: str,
    notes: str,
    status,
    start: oneOf('unscheduled', 'deferred'),
    startDate: orNull(date),
    deadline: orNull(date),
    tagIds: ids,
    areaId: orNull(id),
    completedAt: orNull(timestamp),
    loggedAt: orNull(timestamp),
    trashedAt: orNull(timestamp),
    sortByDate: bool,
    repeat: orNull(repeatRule),
    repeatOf: orNull(id),
  },
  headings: { title: str, projectId: id, archived: bool, collapsed: bool, sortByDate: bool },
  todos: {
    title: str,
    notes: str,
    status,
    start: todoStart,
    startDate: orNull(date),
    todaySortKey: orNull(orderKey),
    deadline: orNull(date),
    priority: orNull(priority),
    prioritySource: orNull(oneOf('user', 'auto')),
    priorityBeforeAuto: orNull(priority),
    tagIds: ids,
    contextId: orNull(id),
    areaId: orNull(id),
    projectId: orNull(id),
    headingId: orNull(id),
    completedAt: orNull(timestamp),
    loggedAt: orNull(timestamp),
    trashedAt: orNull(timestamp),
    releasedBy: orNull(id),
    releasedFrom: orNull((v) => isObject(v) && matches(v, { start: todoStart, startDate: orNull(date), givenContextId: orNull(id) })),
    repeat: orNull(repeatRule),
    repeatOf: orNull(id),
  },
  checklistItems: { todoId: id, title: str, completed: bool },
  tags: { title: str, shortcut: orNull(str), parentTagId: orNull(id) },
  contexts: { title: str },
  savedSearches: { title: str, query: str, tagIds: ids, contextId: orNull(id) },
};

/** Whether `rules` has its own rule for `key`, and `value` passes it (exactly `true`). */
function passes(rules: Record<string, Rule>, key: string, value: unknown): boolean {
  return Object.hasOwn(rules, key) && rules[key](value) === true;
}

/** Whether every own field of `x` is listed in `rules` and passes, and none is missing. */
function matches(x: Record<string, unknown>, rules: Record<string, Rule>): boolean {
  const keys = Object.keys(x);
  return keys.length === Object.keys(rules).length && keys.every((k) => passes(rules, k, x[k]));
}

/** Whether `x` is a valid record of `table`. */
export function isValidRecord(table: EntityName, x: unknown): boolean {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  const r = x as Record<string, unknown>;
  if (!Object.hasOwn(r, 'deletedAt')) return false;
  if (r.deletedAt !== null) return ['id', 'deletedAt', 'modifiedAt'].every((k) => passes(TOMBSTONE, k, r[k]));
  return matches(r, { ...BASE, ...FIELDS[table] });
}

/** Each synced setting's value (model/settings.ts). Settings not listed here don't sync. */
const SETTING_VALUES: Record<string, Rule> = {
  priorityLabels: (v) => Array.isArray(v) && v.length === 5 && v.every(str),
  autoP1: bool,
  defaultP2: bool,
  todayGrouping: oneOf('none', 'project', 'priority', 'context'),
  moveToCompleted: oneOf(...MOVE_TO_COMPLETED),
  sinkCompleted: bool,
  sinkChecked: bool,
  sequentialTags: (v) =>
    Array.isArray(v) &&
    v.every((t) => isObject(t) && matches(t, { tagId: id, priority: orNull(priority), contextId: orNull(id) })),
  showCalendarEvents: bool,
  unscheduledLimit: (v) => UNSCHEDULED_LIMITS.includes(v as number | null),
};

/** The settings the checks accept: exactly the ones that sync (SYNCED_SETTINGS in payload.ts). */
export const VALIDATED_SETTINGS = Object.keys(SETTING_VALUES);

/** Whether `x` is a valid synced setting: a known key, its value's type, and an optional change time. */
export function isValidSetting(x: unknown): x is SettingEntry {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  const s = x as Record<string, unknown>;
  const fieldsOk = Object.keys(s).every((k) => k === 'key' || k === 'value' || k === 'modifiedAt');
  return (
    fieldsOk &&
    typeof s.key === 'string' &&
    passes(SETTING_VALUES, s.key, s.value) &&
    (!Object.hasOwn(s, 'modifiedAt') || timestamp(s.modifiedAt) === true)
  );
}
