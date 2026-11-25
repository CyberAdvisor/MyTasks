/**
 * Schema upgrades, one record at a time (design doc, Section 4, Rules).
 *
 * The same steps upgrade this device's database (database.ts, Dexie's
 * upgrade blocks) and a list read from elsewhere: a gist last written by an
 * older version, or a backup file (FR-12.8). Each step changes a record in
 * place and is safe to run on a record that already has the field.
 *
 * Adding a schema version: add its step here, call it from a new
 * `this.version(n)` block in database.ts, add it to `STEPS`, and raise
 * SCHEMA_VERSION.
 */
import { tombstone } from '../model/tombstone';

/** A record as stored, before it is checked. */
type Row = Record<string, unknown>;

/** Version 2: tasks and saved searches gain a context (FR-18); existing ones have none. */
export function addContext(row: Row): void {
  row.contextId ??= null;
}

/**
 * Version 3: completed items wait in their list until moved to Completed
 * (FR-12.2). Tasks and projects already completed or canceled count as moved.
 */
export function markMoved(row: Row): void {
  row.loggedAt ??= row.status === 'open' ? null : (row.completedAt ?? row.modifiedAt);
}

/** Version 4: a deleted record keeps only `id`, `deletedAt` and `modifiedAt`. */
export function stripDeleted(row: Row): Row {
  return row.deletedAt ? tombstone(row as never) : row;
}

/**
 * Version 5: headings can be collapsed (FR-2.7); existing ones start
 * expanded. Deleted records stay tombstones, with no other fields.
 */
export function addCollapsed(row: Row): void {
  if (!row.deletedAt) row.collapsed ??= false;
}

/**
 * Version 6: tasks remember what released them in a sequential project
 * (FR-17.5); existing ones weren't released.
 */
export function addReleased(row: Row): void {
  if (row.deletedAt) return;
  row.releasedBy ??= null;
  row.releasedFrom ??= null;
}

/**
 * Version 7: release data also records the context a release gave
 * (`givenContextId`, FR-17.5). Version 6 existed only in local testing of
 * 1.1.9 (2026-11-14), whose release data lacked it; it was none.
 */
export function addGivenContext(row: Row): void {
  const from = row.releasedFrom;
  if (row.deletedAt || !from || typeof from !== 'object' || Array.isArray(from)) return;
  row.releasedFrom = { givenContextId: null, ...from };
}

/**
 * Version 8: projects and headings can list their tasks by start date
 * (FR-2.8); existing ones keep manual order. Deleted records stay tombstones.
 */
export function addSortByDate(row: Row): void {
  if (!row.deletedAt) row.sortByDate ??= false;
}

/**
 * Version 9: tasks can repeat (FR-4.1), and version 11 projects (FR-4.6): a
 * template carries its rule, a copy its template's id; existing records have
 * neither.
 */
export function addRepeat(row: Row): void {
  if (row.deletedAt) return;
  row.repeat ??= null;
  row.repeatOf ??= null;
}

/**
 * Version 13: records carry part times (FR-19.10), empty to begin with: no
 * part has a known change time, so the first merge still goes by the whole
 * record's `modifiedAt`. Deleted records stay tombstones.
 */
export function addFieldTimes(row: Row): void {
  if (!row.deletedAt) row.ft ??= {};
}

/** Version 15: tasks can have a reminder (FR-3.8); existing ones have none. */
export function addReminder(row: Row): void {
  if (!row.deletedAt) row.reminder ??= null;
}

/** Synced tables, as named in a list. */
const ALL_TABLES = ['areas', 'projects', 'headings', 'todos', 'checklistItems', 'tags', 'contexts', 'savedSearches'];

/** The step that brings a list from version n − 1 to n, keyed by n. */
const STEPS: Record<number, (tables: Record<string, Row[]>) => void> = {
  2: (t) => {
    t.contexts ??= [];
    t.todos.forEach(addContext);
    t.savedSearches.forEach(addContext);
  },
  3: (t) => {
    t.todos.forEach(markMoved);
    t.projects.forEach(markMoved);
  },
  4: (t) => {
    for (const name of ALL_TABLES) t[name] = t[name].map(stripDeleted);
  },
  5: (t) => {
    t.headings.forEach(addCollapsed);
  },
  6: (t) => {
    t.todos.forEach(addReleased);
  },
  7: (t) => {
    t.todos.forEach(addGivenContext);
  },
  8: (t) => {
    t.projects.forEach(addSortByDate);
    t.headings.forEach(addSortByDate);
  },
  9: (t) => {
    t.todos.forEach(addRepeat);
  },
  // Version 10 adds the synced setting showCalendarEvents (FR-21.3) and no
  // field: the version only makes older apps refuse a list holding it
  // ("newer") rather than fail it as not valid.
  10: () => {},
  11: (t) => {
    t.projects.forEach(addRepeat);
  },
  // Version 12 adds the synced setting unscheduledLimit (FR-23.1) and no
  // field, for the same reason as version 10.
  12: () => {},
  13: (t) => {
    for (const name of ALL_TABLES) t[name]?.forEach(addFieldTimes);
  },
  // Version 14 adds the synced setting gistLabel (FR-19.14) and no field, for
  // the same reason as version 10.
  14: () => {},
  15: (t) => {
    t.todos.forEach(addReminder);
  },
};

/**
 * A list saved at an older schema, brought up to `target` with the steps
 * above, as a new object (the input is not changed). Anything that isn't a
 * list at an older schema is returned as it is, for the checks to judge.
 * Version 1 lists have no `contexts` table; it is added, empty.
 */
export function upgradeList<T>(list: T, target: number): T {
  const l = list as { schema?: unknown; tables?: unknown } | null;
  if (!l || typeof l !== 'object' || !Number.isInteger(l.schema) || (l.schema as number) < 1) return list;
  if ((l.schema as number) >= target || !l.tables || typeof l.tables !== 'object') return list;
  const tables: Record<string, Row[]> = {};
  for (const [name, rows] of Object.entries(l.tables as Record<string, unknown>)) {
    // Rows that aren't objects are left for the checks to refuse.
    if (!Array.isArray(rows) || !rows.every((r) => r && typeof r === 'object' && !Array.isArray(r))) return list;
    tables[name] = (rows as Row[]).map((r) => ({ ...r }));
  }
  if (!ALL_TABLES.every((n) => n === 'contexts' || Array.isArray(tables[n]))) return list;
  for (let v = (l.schema as number) + 1; v <= target; v++) STEPS[v](tables);
  return { ...list, schema: target, tables };
}
