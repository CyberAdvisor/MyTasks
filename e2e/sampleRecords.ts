/**
 * Record builders for the screenshot samples (e2e/sampleData.ts for the
 * README and website, e2e/marcusData.ts for the book): every record of a
 * backup file, with readable ids, sort keys in the order created, and dates
 * relative to the day the sample is built, so Today and Scheduled always
 * read the same.
 */
import { generateKeyBetween } from 'fractional-indexing';
import type {
  Area,
  BaseRecord,
  ChecklistItem,
  Context,
  EntityName,
  Heading,
  Project,
  RepeatRule,
  SavedSearch,
  SettingEntry,
  Tag,
  Todo,
} from '../src/lib/model/types';
import { SCHEMA_VERSION } from '../src/lib/db/database';
import type { BackupFile } from '../src/lib/backup';

/** A local `YYYY-MM-DD`, `days` from `today`. */
export function localDate(today: Date, days = 0): string {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + days);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Days from `today` to the next `weekday` (0 Sunday … 6 Saturday); 0 when today is that day. */
export function daysUntil(today: Date, weekday: number): number {
  return (weekday - today.getDay() + 7) % 7;
}

/** A repeat rule, as the Repeat dialog saves it, with the given changes. */
export function rule(fields: Partial<RepeatRule>): RepeatRule {
  return {
    mode: 'fixed',
    unit: 'week',
    interval: 1,
    weekdays: [],
    days: [],
    month: null,
    endCount: null,
    endDate: null,
    made: 0,
    deadlineDays: null,
    paused: false,
    ...fields,
  };
}

/** Builders for one sample, built for `today`. */
export function sampleRecords(today: Date) {
  /** Every record was last changed the day before. */
  const at = new Date(today.getTime() - 86_400_000).toISOString();
  const day = (days = 0) => localDate(today, days);
  let sortKey: string | null = null;
  let todayKey: string | null = null;
  let items = 0;

  /** Fields every record shares. */
  const base = (id: string): BaseRecord => {
    sortKey = generateKeyBetween(sortKey, null);
    return { id, createdAt: at, modifiedAt: at, deletedAt: null, sortKey, ft: {} };
  };

  const area = (id: string, title: string): Area => ({ ...base(id), title, tagIds: [], collapsed: false });

  const project = (id: string, title: string, fields: Partial<Project> = {}): Project => ({
    ...base(id),
    title,
    notes: '',
    status: 'open',
    start: 'unscheduled',
    startDate: null,
    deadline: null,
    tagIds: [],
    areaId: null,
    completedAt: null,
    loggedAt: null,
    trashedAt: null,
    sortByDate: false,
    repeat: null,
    repeatOf: null,
    ...fields,
  });

  const heading = (id: string, projectId: string, title: string): Heading => ({
    ...base(id),
    title,
    projectId,
    archived: false,
    collapsed: false,
    sortByDate: false,
  });

  /** A task; one starting today joins Today's order, in the order created. */
  const todo = (id: string, title: string, fields: Partial<Todo> = {}): Todo => {
    const inToday = fields.startDate === day();
    const closed = fields.status === 'completed' || fields.status === 'canceled';
    return {
      ...base(id),
      title,
      notes: '',
      status: 'open',
      start: fields.projectId || fields.areaId ? 'unscheduled' : 'inbox',
      startDate: null,
      todaySortKey: inToday ? (todayKey = generateKeyBetween(todayKey, null)) : null,
      deadline: null,
      reminder: null,
      priority: null,
      prioritySource: fields.priority ? 'user' : null,
      priorityBeforeAuto: null,
      tagIds: [],
      contextId: null,
      areaId: null,
      projectId: null,
      headingId: null,
      completedAt: closed ? at : null,
      loggedAt: closed ? at : null,
      trashedAt: null,
      releasedBy: null,
      releasedFrom: null,
      repeat: null,
      repeatOf: null,
      ...fields,
    };
  };

  const context = (id: string, title: string): Context => ({ ...base(id), title });

  const tag = (id: string, title: string, parentTagId: string | null = null): Tag => ({
    ...base(id),
    title,
    shortcut: null,
    parentTagId,
  });

  const item = (todoId: string, title: string, completed = false): ChecklistItem => ({
    ...base(`${todoId}-item-${++items}`),
    todoId,
    title,
    completed,
  });

  const search = (id: string, title: string, fields: Partial<SavedSearch> = {}): SavedSearch => ({
    ...base(id),
    title,
    query: '',
    tagIds: [],
    contextId: null,
    ...fields,
  });

  /** The backup file's text. */
  const backup = (tables: Record<EntityName, BaseRecord[]>, settings: SettingEntry[] = []): string => {
    const file: BackupFile = {
      // backup.ts's BACKUP_FORMAT and BACKUP_FORMAT_VERSION, written out so the
      // screenshot run doesn't load the sync code in Node.
      format: 'mytasks-backup',
      formatVersion: 1,
      savedAt: at,
      appVersion: 'sample',
      app: 'mytasks',
      schema: SCHEMA_VERSION,
      tables,
      settings: settings.map((s) => ({ ...s, modifiedAt: at })),
    };
    return JSON.stringify(file, null, 1);
  };

  return { at, day, area, project, heading, todo, context, tag, item, search, backup };
}
