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
  Todo,
} from '../model/types';

export class MyTasksDB extends Dexie {
  areas!: Table<Area, string>;
  projects!: Table<Project, string>;
  headings!: Table<Heading, string>;
  todos!: Table<Todo, string>;
  checklistItems!: Table<ChecklistItem, string>;
  tags!: Table<Tag, string>;
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
  }
}

/** The app's single database instance. */
export const db = new MyTasksDB();
