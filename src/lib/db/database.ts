/**
 * IndexedDB storage through Dexie (FR-DM.1).
 *
 * One object store per entity. Schema changes must add a new
 * `this.version(n)` block with a forward migration; downgrades are not
 * supported (design doc, Section 4, Rules).
 */
import Dexie, { type Table } from 'dexie';
import type {
  Area,
  ChangeLogEntry,
  ChecklistItem,
  Heading,
  Project,
  SavedSearch,
  SettingEntry,
  Tag,
  Context,
  Todo,
} from '../model/types';

/** The current schema version; synced lists record it (FR-19.4). */
export const SCHEMA_VERSION = 3;

export class MyTasksDB extends Dexie {
  areas!: Table<Area, string>;
  projects!: Table<Project, string>;
  headings!: Table<Heading, string>;
  todos!: Table<Todo, string>;
  checklistItems!: Table<ChecklistItem, string>;
  tags!: Table<Tag, string>;
  contexts!: Table<Context, string>;
  savedSearches!: Table<SavedSearch, string>;
  changeLog!: Table<ChangeLogEntry, number>;
  settings!: Table<SettingEntry, string>;

  constructor(name = 'mytasks') {
    super(name);
    // Version 1: initial schema. Only indexed fields are listed.
    this.version(1).stores({
      areas: 'id, sortKey',
      projects: 'id, areaId, status, sortKey',
      headings: 'id, projectId, sortKey',
      todos: 'id, projectId, areaId, headingId, status, startDate, deadline, sortKey',
      checklistItems: 'id, todoId, sortKey',
      tags: 'id, parentTagId, sortKey',
      savedSearches: 'id, sortKey',
      changeLog: '++seq, entity, entityId, at',
      settings: 'key',
    });
    // Version 2: contexts (FR-18). Existing to-dos and saved searches get no context.
    this.version(2)
      .stores({
        todos: 'id, projectId, areaId, headingId, status, startDate, deadline, sortKey, contextId',
        contexts: 'id, sortKey',
      })
      .upgrade(async (tx) => {
        await tx.table('todos').toCollection().modify((t) => {
          t.contextId ??= null;
        });
        await tx.table('savedSearches').toCollection().modify((x) => {
          x.contextId ??= null;
        });
      });
    // Version 3: completed items wait in their list until moved to Completed
    // (FR-12.2). Everything already completed or canceled counts as moved.
    this.version(3).stores({}).upgrade(async (tx) => {
      const markMoved = (x: { status: string; completedAt: string | null; modifiedAt: string; loggedAt?: string | null }) => {
        x.loggedAt ??= x.status === 'open' ? null : (x.completedAt ?? x.modifiedAt);
      };
      await tx.table('todos').toCollection().modify(markMoved);
      await tx.table('projects').toCollection().modify(markMoved);
    });
  }
}

/** The app's single database instance. */
export const db = new MyTasksDB();
