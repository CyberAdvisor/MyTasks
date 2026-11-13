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
 */
import { PRIORITIES, MOVE_TO_COMPLETED } from '../model/settings';
import type { EntityName, SettingEntry } from '../model/types';

/** A check for one field's value. */
type Rule = (v: unknown) => boolean;

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

const str: Rule = (v) => typeof v === 'string';
const id: Rule = (v) => typeof v === 'string' && v.length > 0;
const bool: Rule = (v) => typeof v === 'boolean';
const timestamp: Rule = (v) => typeof v === 'string' && ISO_TIMESTAMP.test(v);
const date: Rule = (v) => typeof v === 'string' && LOCAL_DATE.test(v);
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

/** Fields every record carries (BaseRecord), for a record that isn't deleted. */
const BASE: Record<string, Rule> = {
  id,
  createdAt: timestamp,
  modifiedAt: timestamp,
  deletedAt: oneOf(null),
  sortKey: str,
};

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
  },
  headings: { title: str, projectId: id, archived: bool },
  todos: {
    title: str,
    notes: str,
    status,
    start: oneOf('inbox', 'unscheduled', 'deferred'),
    startDate: orNull(date),
    todaySortKey: orNull(str),
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
  },
  checklistItems: { todoId: id, title: str, completed: bool },
  tags: { title: str, shortcut: orNull(str), parentTagId: orNull(id) },
  contexts: { title: str },
  savedSearches: { title: str, query: str, tagIds: ids, contextId: orNull(id) },
};

/** Whether every field of `x` is listed in `rules` and passes, and none is missing. */
function matches(x: Record<string, unknown>, rules: Record<string, Rule>): boolean {
  const keys = Object.keys(x);
  return keys.length === Object.keys(rules).length && keys.every((k) => k in rules && rules[k](x[k]));
}

/** Whether `x` is a valid record of `table`. */
export function isValidRecord(table: EntityName, x: unknown): boolean {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  const r = x as Record<string, unknown>;
  if (r.deletedAt !== null) return id(r.id) && timestamp(r.deletedAt) && timestamp(r.modifiedAt);
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
};

/** Whether `x` is a valid synced setting: a known key, its value's type, and an optional change time. */
export function isValidSetting(x: unknown): x is SettingEntry {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  const s = x as Record<string, unknown>;
  const rule = typeof s.key === 'string' && Object.hasOwn(SETTING_VALUES, s.key) ? SETTING_VALUES[s.key] : null;
  const fieldsOk = Object.keys(s).every((k) => k === 'key' || k === 'value' || k === 'modifiedAt');
  return !!rule && fieldsOk && rule(s.value) && (s.modifiedAt === undefined || timestamp(s.modifiedAt));
}
