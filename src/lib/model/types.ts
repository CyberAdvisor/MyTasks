/**
 * Core data types for My Tasks (design doc, Section 4: Data model).
 *
 * Every record carries the sync-ready fields from BaseRecord so a future
 * sync release can merge changes without a schema rewrite.
 */

/** Stable record identity: a UUID v7 string (time-ordered). */
export type ID = string;

/** A calendar date with no time, stored as local `YYYY-MM-DD`. */
export type LocalDate = string;

/** An ISO-8601 timestamp, e.g. `2026-11-09T15:04:05.000Z`. */
type Timestamp = string;

/** Lifecycle of a to-do or project. */
export type Status = 'open' | 'completed' | 'canceled';

/**
 * Where a to-do sits before dates are considered.
 * - `inbox`: captured, not yet organized (no container, no When date)
 * - `unscheduled`: active and available (may also carry a When date)
 * - `deferred`: parked until the user promotes it
 */
export type TodoStart = 'inbox' | 'unscheduled' | 'deferred';

/** Projects are never in the Inbox. */
type ProjectStart = 'unscheduled' | 'deferred';

/** Priority 1 (highest) to 5. */
export type Priority = 1 | 2 | 3 | 4 | 5;

/**
 * Who set a to-do's priority (FR-14.1). `user` with no priority means the
 * user chose "None", which the automatic rules respect.
 */
type PrioritySource = 'user' | 'auto';

/** Fields shared by every stored entity. */
export interface BaseRecord {
  id: ID;
  createdAt: Timestamp;
  modifiedAt: Timestamp;
  /** Tombstone set when a record is permanently deleted (after Trash is emptied). */
  deletedAt: Timestamp | null;
  /** Fractional index giving manual order within the parent. */
  sortKey: string;
  /**
   * When each part of a task or project last changed (FR-19.10,
   * model/parts.ts), in seconds since 1970; empty for other records. Not
   * on a tombstone.
   */
  ft?: FieldTimes;
}

/** Part key → the time it last changed, in whole seconds since 1970 (FR-19.10). */
export type FieldTimes = Record<string, number>;

export interface Area extends BaseRecord {
  title: string;
  tagIds: ID[];
  collapsed: boolean;
}

export interface Project extends BaseRecord {
  title: string;
  notes: string;
  status: Status;
  start: ProjectStart;
  startDate: LocalDate | null;
  deadline: LocalDate | null;
  tagIds: ID[];
  areaId: ID | null;
  completedAt: Timestamp | null;
  /** When it was moved to Completed (FR-12.2); null while open or still waiting in its list. */
  loggedAt: Timestamp | null;
  trashedAt: Timestamp | null;
  /** Its tasks under no heading listed by start date (FR-2.8, schema 8); synced. */
  sortByDate: boolean;
  /**
   * Set on a repeating project's template (FR-4.6, schema 11): the rule that
   * makes its copies. As for a task, the template's `startDate` is its next
   * copy's date, or null while an after-completion repeat waits.
   */
  repeat: RepeatRule | null;
  /** On a copy made by a repeating project: its template's id; otherwise null. */
  repeatOf: ID | null;
}

export interface Heading extends BaseRecord {
  title: string;
  projectId: ID;
  archived: boolean;
  /** Its tasks hidden on the project page (FR-2.7); synced, like an area's. */
  collapsed: boolean;
  /** Its tasks listed by start date (FR-2.8, schema 8); synced. */
  sortByDate: boolean;
}

export interface Todo extends BaseRecord {
  title: string;
  notes: string;
  status: Status;
  start: TodoStart;
  startDate: LocalDate | null;
  /** Manual order inside the Today list (separate from container order). */
  todaySortKey: string | null;
  deadline: LocalDate | null;
  priority: Priority | null;
  prioritySource: PrioritySource | null;
  /** Automatic value held before an automatic P1, restored by FR-14.11. */
  priorityBeforeAuto: Priority | null;
  tagIds: ID[];
  /** The to-do's context, one of those defined in Settings (FR-18.1). */
  contextId: ID | null;
  areaId: ID | null;
  projectId: ID | null;
  headingId: ID | null;
  completedAt: Timestamp | null;
  /** When it was moved to Completed (FR-12.2); null while open or still waiting in its list. */
  loggedAt: Timestamp | null;
  trashedAt: Timestamp | null;
  /**
   * Sequential projects (FR-17.5): the task whose completion moved this one
   * into Today, or null (also when the launch check released it).
   */
  releasedBy: ID | null;
  /** Where a released task was before it moved into Today, to return it there; null if not released. */
  releasedFrom: ReleasedFrom | null;
  /**
   * Set on a repeating task's template (FR-4.1, schema 9): the rule that makes
   * its copies. A template's `startDate` is the date of its next copy, or
   * null while an after-completion repeat waits for its copy to be done.
   */
  repeat: RepeatRule | null;
  /** On a copy made by a repeating task: its template's id (FR-4.4); otherwise null. */
  repeatOf: ID | null;
}

/** The unit a repeat counts in (FR-4.1). */
export type RepeatUnit = 'day' | 'week' | 'month' | 'year';

/**
 * A day within a month for a monthly or yearly repeat: the 16th day
 * (`ordinal` 16, `weekday` null), the 2nd Tuesday (2, 2), or the last day
 * (−1, null).
 */
export interface RepeatDay {
  /** 1 to 31, or −1 for the last. */
  ordinal: number;
  /** 0 Sunday to 6 Saturday, or null for the day of the month. */
  weekday: number | null;
}

/**
 * How a task repeats (FR-4.1, FR-4.2, FR-4.4). A fixed
 * schedule makes a copy on each date whether or not the last was done; after
 * completion makes the next copy `interval` units after the last is done.
 */
export interface RepeatRule {
  mode: 'fixed' | 'afterCompletion';
  unit: RepeatUnit;
  /** Every 1, 2, 3… units. */
  interval: number;
  /** Weekly: the days, 0 Sunday to 6 Saturday. Empty for other units. */
  weekdays: number[];
  /** Monthly and yearly: the days in the month. Empty for other units. */
  days: RepeatDay[];
  /** Yearly: the month, 1 to 12; null for other units. */
  month: number | null;
  /** Fixed schedule: end after this many copies (FR-4.2), or null. */
  endCount: number | null;
  /** Fixed schedule: no copy after this date (FR-4.2), or null. */
  endDate: LocalDate | null;
  /** Copies made so far, for `endCount`. */
  made: number;
  /** Copies get the scheduled date as their deadline and start this many days earlier; null for no deadline (FR-4.2). */
  deadlineDays: number | null;
  /** Paused: no copies are made until it resumes (FR-4.4). */
  paused: boolean;
}

/**
 * A task's start before a sequential project released it, and the context
 * the release gave it (null if none), so returning it undoes both (FR-17.5,
 * FR-17.6).
 */
interface ReleasedFrom {
  start: TodoStart;
  startDate: LocalDate | null;
  givenContextId: ID | null;
}

export interface ChecklistItem extends BaseRecord {
  todoId: ID;
  title: string;
  completed: boolean;
}

export interface Tag extends BaseRecord {
  title: string;
  shortcut: string | null;
  parentTagId: ID | null;
}

/**
 * A context a to-do can be in, e.g. Home or Phone (FR-18). Defined in
 * Settings; to-dos point to it by id, so renaming never touches them.
 */
export interface Context extends BaseRecord {
  title: string;
}

export interface SavedSearch extends BaseRecord {
  title: string;
  query: string;
  tagIds: ID[];
  /** Only to-dos in this context; null for any (FR-18.6). */
  contextId: ID | null;
}

/** Entity names, used by the change log (FR-DM.3). */
export type EntityName =
  | 'areas'
  | 'projects'
  | 'headings'
  | 'todos'
  | 'checklistItems'
  | 'tags'
  | 'contexts'
  | 'savedSearches';

/**
 * Every entity table, in one list (review C14): the tables that sync, that
 * undo tracks, and that a backup holds. The schema's old upgrade steps keep
 * their own lists, which must stay as they were at that version.
 */
export const ENTITY_NAMES: readonly EntityName[] = [
  'areas',
  'projects',
  'headings',
  'todos',
  'checklistItems',
  'tags',
  'contexts',
  'savedSearches',
];

/** One row of the old local change log, no longer written (since 1.3.7; see `clearChangeLog`). */
export interface ChangeLogEntry {
  seq?: number;
  entity: EntityName;
  entityId: ID;
  /** Changed field names; `*` for create or delete. */
  fields: string[];
  at: Timestamp;
}

/** Key/value settings record. */
export interface SettingEntry {
  key: string;
  value: unknown;
  /** When it was last changed, so settings merge like records when synced (FR-19.4). */
  modifiedAt?: Timestamp;
}
