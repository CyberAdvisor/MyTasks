/**
 * Data operations for My Tasks.
 *
 * Every user change runs in a single IndexedDB transaction (FR-DM.2) and
 * appends to the local change log (FR-DM.3). UI code calls these functions;
 * it never writes to the database directly.
 */
import { db, type MyTasksDB } from './database';
import { nowIso, uuidv7 } from '../model/ids';
import { today } from '../model/dates';
import { keyAtEnd, keyAtStart, keyBetween } from '../model/order';
import type {
  Area,
  BaseRecord,
  EntityName,
  Heading,
  ID,
  LocalDate,
  Project,
  Todo,
  TodoStart,
} from '../model/types';

/** Tables that hold entities (everything except the log and settings). */
const ENTITY_TABLES: EntityName[] = [
  'areas',
  'projects',
  'headings',
  'todos',
  'checklistItems',
  'tags',
  'savedSearches',
];

/** Run `fn` in one read-write transaction over all entity tables plus the log. */
function tx<T>(fn: () => Promise<T>, database: MyTasksDB = db): Promise<T> {
  const tables = [...ENTITY_TABLES.map((n) => database.table(n)), database.changeLog];
  return database.transaction('rw', tables, fn);
}

/** Append one change-log row. */
function log(entity: EntityName, entityId: ID, fields: string[]): Promise<number> {
  return db.changeLog.add({ entity, entityId, fields, at: nowIso() });
}

/** Fresh base fields for a new record. */
function base(sortKey: string): BaseRecord {
  const at = nowIso();
  return { id: uuidv7(), createdAt: at, modifiedAt: at, deletedAt: null, sortKey };
}

/** Patch a record, stamp `modifiedAt` and log the changed fields. */
async function patch<T extends BaseRecord>(entity: EntityName, id: ID, changes: Partial<T>): Promise<void> {
  const fields = Object.keys(changes);
  if (!fields.length) return;
  await db.table(entity).update(id, { ...changes, modifiedAt: nowIso() });
  await log(entity, id, fields);
}

/** Sort keys of siblings matching `filter`, used to append at the end. */
async function siblingKeys<T extends BaseRecord>(entity: EntityName, filter: (r: T) => boolean): Promise<string[]> {
  const rows = (await db.table(entity).toArray()) as T[];
  return rows.filter((r) => r.deletedAt === null && filter(r)).map((r) => r.sortKey);
}

// ---------------------------------------------------------------------------
// To-do invariants
// ---------------------------------------------------------------------------

/**
 * Keep `start` consistent with a to-do's container and When date:
 * a to-do leaves the Inbox once it gets a container or a When date.
 * (A to-do may be Unscheduled with no container, as in Things' Anytime.)
 */
export function normalizeStart(t: Pick<Todo, 'start' | 'startDate' | 'areaId' | 'projectId'>): TodoStart {
  const contained = t.areaId !== null || t.projectId !== null;
  if (t.start === 'inbox' && (contained || t.startDate !== null)) return 'unscheduled';
  return t.start;
}

/** Where a new or moved to-do goes. `null` everywhere means the Inbox. */
export interface TodoPlacement {
  areaId?: ID | null;
  projectId?: ID | null;
  headingId?: ID | null;
}

// ---------------------------------------------------------------------------
// To-dos
// ---------------------------------------------------------------------------

/** Options for a new to-do. */
export interface NewTodo extends TodoPlacement {
  title?: string;
  /** Start state for a to-do with no container; defaults to the Inbox. */
  start?: TodoStart;
  startDate?: LocalDate | null;
  deferred?: boolean;
  /** Put the new to-do at the top of its container instead of the bottom. */
  atStart?: boolean;
}

/** Create a to-do and return its id (FR-1.1). */
export async function createTodo(opts: NewTodo = {}): Promise<ID> {
  return tx(async () => {
    const projectId = opts.projectId ?? null;
    const project = projectId ? await db.projects.get(projectId) : undefined;
    const areaId = projectId ? null : (opts.areaId ?? null);
    const headingId = projectId ? (opts.headingId ?? null) : null;
    const keys = await siblingKeys<Todo>('todos', (t) =>
      projectId ? t.projectId === projectId : areaId ? t.areaId === areaId && !t.projectId : !t.projectId && !t.areaId,
    );
    const startDate = opts.deferred ? null : (opts.startDate ?? null);
    const todo: Todo = {
      ...base(opts.atStart ? keyAtStart(keys) : keyAtEnd(keys)),
      title: opts.title ?? '',
      notes: '',
      status: 'open',
      start: normalizeStart({
        start: opts.deferred ? 'deferred' : (opts.start ?? 'inbox'),
        startDate,
        areaId,
        projectId,
      }),
      startDate,
      todaySortKey: null,
      deadline: null,
      priority: null,
      prioritySource: null,
      priorityBeforeAuto: null,
      tagIds: [],
      areaId,
      projectId: project ? projectId : null,
      headingId,
      completedAt: null,
      trashedAt: null,
    };
    await db.todos.add(todo);
    await log('todos', todo.id, ['*']);
    return todo.id;
  });
}

/** Edit title or notes. */
export function updateTodoText(id: ID, changes: Partial<Pick<Todo, 'title' | 'notes'>>): Promise<void> {
  return tx(() => patch<Todo>('todos', id, changes));
}

/** When choices from the When picker (FR-3.1). */
export type WhenChoice =
  | { kind: 'today' }
  | { kind: 'date'; date: LocalDate }
  | { kind: 'deferred' }
  | { kind: 'clear' };

/** Apply a When choice to a to-do. */
export function setWhen(id: ID, choice: WhenChoice): Promise<void> {
  return tx(async () => {
    const t = await db.todos.get(id);
    if (!t) return;
    let start: TodoStart = t.start === 'deferred' ? 'unscheduled' : t.start;
    let startDate: LocalDate | null = null;
    if (choice.kind === 'today') startDate = today();
    else if (choice.kind === 'date') startDate = choice.date;
    else if (choice.kind === 'deferred') start = 'deferred';
    // Clearing returns an unfiled to-do to the Inbox for processing.
    else start = t.areaId || t.projectId ? 'unscheduled' : 'inbox';
    start = normalizeStart({ start, startDate, areaId: t.areaId, projectId: t.projectId });
    await patch<Todo>('todos', id, { start, startDate });
  });
}

/** Set or clear a deadline (FR-3.3). */
export function setDeadline(id: ID, deadline: LocalDate | null): Promise<void> {
  return tx(() => patch<Todo>('todos', id, { deadline }));
}

/** Complete, cancel or reopen a to-do (FR-1.3, FR-1.4, FR-12.1). */
export function setTodoStatus(id: ID, status: Todo['status']): Promise<void> {
  return tx(() =>
    patch<Todo>('todos', id, { status, completedAt: status === 'open' ? null : nowIso() }),
  );
}

/** Move a to-do to Trash, or restore it (FR-1.5, FR-12.3). */
export function setTodoTrashed(id: ID, trashed: boolean): Promise<void> {
  return tx(() => patch<Todo>('todos', id, { trashedAt: trashed ? nowIso() : null }));
}

/** Duplicate a to-do just after the original (FR-1.5). */
export async function duplicateTodo(id: ID): Promise<ID | undefined> {
  return tx(async () => {
    const t = await db.todos.get(id);
    if (!t) return undefined;
    // Place the copy between the original and its next sibling.
    const keys = await siblingKeys<Todo>(
      'todos',
      (x) => x.projectId === t.projectId && x.areaId === t.areaId && x.sortKey > t.sortKey,
    );
    const next = keys.length ? keys.sort()[0] : null;
    const copy: Todo = {
      ...t,
      ...base(keyBetween(t.sortKey, next)),
      status: 'open',
      completedAt: null,
      trashedAt: null,
    };
    await db.todos.add(copy);
    await log('todos', copy.id, ['*']);
    return copy.id;
  });
}

/** Move a to-do into a project, heading, area, or the Inbox (FR-1.5). */
export function moveTodo(id: ID, to: TodoPlacement): Promise<void> {
  return tx(async () => {
    const t = await db.todos.get(id);
    if (!t) return;
    const projectId = to.projectId ?? null;
    const areaId = projectId ? null : (to.areaId ?? null);
    const headingId = projectId ? (to.headingId ?? null) : null;
    const keys = await siblingKeys<Todo>('todos', (x) =>
      x.id !== id &&
      (projectId ? x.projectId === projectId : areaId ? x.areaId === areaId && !x.projectId : !x.projectId && !x.areaId),
    );
    // Moving to "Inbox" (no container) files an undated, active to-do back there.
    const toInbox = !projectId && !areaId && t.start !== 'deferred' && t.startDate === null;
    const start = toInbox ? 'inbox' : normalizeStart({ start: t.start, startDate: t.startDate, areaId, projectId });
    await patch<Todo>('todos', id, { projectId, areaId, headingId, start, sortKey: keyAtEnd(keys) });
  });
}

/** Change a to-do's position among its siblings. */
export function setTodoSortKey(id: ID, sortKey: string): Promise<void> {
  return tx(() => patch<Todo>('todos', id, { sortKey }));
}

/** Turn a to-do into a project with the same title, notes and dates (FR-1.5). */
export function convertTodoToProject(id: ID): Promise<ID | undefined> {
  return tx(async () => {
    const t = await db.todos.get(id);
    if (!t) return undefined;
    const areaId = t.projectId ? ((await db.projects.get(t.projectId))?.areaId ?? null) : t.areaId;
    const projectId = await insertProject({
      title: t.title,
      notes: t.notes,
      areaId,
      startDate: t.startDate,
      deadline: t.deadline,
      deferred: t.start === 'deferred',
    });
    await patch<Todo>('todos', id, { deletedAt: nowIso() });
    return projectId;
  });
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

/** Options for a new project. */
export interface NewProject {
  title?: string;
  notes?: string;
  areaId?: ID | null;
  startDate?: LocalDate | null;
  deadline?: LocalDate | null;
  deferred?: boolean;
}

/** Insert a project; caller must already be inside a transaction. */
async function insertProject(opts: NewProject): Promise<ID> {
  const areaId = opts.areaId ?? null;
  const keys = await siblingKeys<Project>('projects', (p) => (p.areaId ?? null) === areaId);
  const project: Project = {
    ...base(keyAtEnd(keys)),
    title: opts.title ?? '',
    notes: opts.notes ?? '',
    status: 'open',
    start: opts.deferred ? 'deferred' : 'unscheduled',
    startDate: opts.deferred ? null : (opts.startDate ?? null),
    deadline: opts.deadline ?? null,
    tagIds: [],
    areaId,
    completedAt: null,
    trashedAt: null,
  };
  await db.projects.add(project);
  await log('projects', project.id, ['*']);
  return project.id;
}

/** Create a project (FR-2.1). */
export function createProject(opts: NewProject = {}): Promise<ID> {
  return tx(() => insertProject(opts));
}

/** Edit project fields. */
export function updateProject(
  id: ID,
  changes: Partial<Pick<Project, 'title' | 'notes' | 'deadline' | 'startDate' | 'start' | 'areaId'>>,
): Promise<void> {
  return tx(() => patch<Project>('projects', id, changes));
}

/**
 * Complete or cancel a project (FR-2.3). Open to-dos inside are completed or
 * canceled according to `openTodos`.
 */
export function closeProject(id: ID, status: 'completed' | 'canceled', openTodos: 'completed' | 'canceled'): Promise<void> {
  return tx(async () => {
    const at = nowIso();
    const todos = await db.todos.where('projectId').equals(id).toArray();
    for (const t of todos.filter((x) => x.status === 'open' && x.deletedAt === null && x.trashedAt === null)) {
      await patch<Todo>('todos', t.id, { status: openTodos, completedAt: at });
    }
    await patch<Project>('projects', id, { status, completedAt: at });
  });
}

/** Reopen a closed project. */
export function reopenProject(id: ID): Promise<void> {
  return tx(() => patch<Project>('projects', id, { status: 'open', completedAt: null }));
}

/** Move a project (and its to-dos) to Trash, or restore it. */
export function setProjectTrashed(id: ID, trashed: boolean): Promise<void> {
  return tx(() => patch<Project>('projects', id, { trashedAt: trashed ? nowIso() : null }));
}

// ---------------------------------------------------------------------------
// Headings
// ---------------------------------------------------------------------------

/** Add a heading at the end of a project (FR-2.4). */
export function createHeading(projectId: ID, title = ''): Promise<ID> {
  return tx(async () => {
    const keys = await siblingKeys<Heading>('headings', (h) => h.projectId === projectId);
    const heading: Heading = { ...base(keyAtEnd(keys)), title, projectId, archived: false };
    await db.headings.add(heading);
    await log('headings', heading.id, ['*']);
    return heading.id;
  });
}

export function renameHeading(id: ID, title: string): Promise<void> {
  return tx(() => patch<Heading>('headings', id, { title }));
}

/** Archive a heading; its to-dos are completed with it, as in Things. */
export function archiveHeading(id: ID): Promise<void> {
  return tx(async () => {
    const at = nowIso();
    const todos = await db.todos.where('headingId').equals(id).toArray();
    for (const t of todos.filter((x) => x.status === 'open')) {
      await patch<Todo>('todos', t.id, { status: 'completed', completedAt: at });
    }
    await patch<Heading>('headings', id, { archived: true });
  });
}

/** Delete a heading; its to-dos stay in the project without a heading. */
export function deleteHeading(id: ID): Promise<void> {
  return tx(async () => {
    const todos = await db.todos.where('headingId').equals(id).toArray();
    for (const t of todos) await patch<Todo>('todos', t.id, { headingId: null });
    await patch<Heading>('headings', id, { deletedAt: nowIso() });
  });
}

/** Turn a heading into a new project holding its to-dos (FR-2.4). */
export function convertHeadingToProject(id: ID): Promise<ID | undefined> {
  return tx(async () => {
    const h = await db.headings.get(id);
    if (!h) return undefined;
    const parent = await db.projects.get(h.projectId);
    const projectId = await insertProject({ title: h.title, areaId: parent?.areaId ?? null });
    const todos = await db.todos.where('headingId').equals(id).toArray();
    for (const t of todos) await patch<Todo>('todos', t.id, { projectId, headingId: null });
    await patch<Heading>('headings', id, { deletedAt: nowIso() });
    return projectId;
  });
}

// ---------------------------------------------------------------------------
// Areas
// ---------------------------------------------------------------------------

/** Create an area at the end of the sidebar (FR-2.5). */
export function createArea(title = ''): Promise<ID> {
  return tx(async () => {
    const keys = await siblingKeys<Area>('areas', () => true);
    const area: Area = { ...base(keyAtEnd(keys)), title, tagIds: [], collapsed: false };
    await db.areas.add(area);
    await log('areas', area.id, ['*']);
    return area.id;
  });
}

export function renameArea(id: ID, title: string): Promise<void> {
  return tx(() => patch<Area>('areas', id, { title }));
}

/**
 * Delete an area (FR-2.5). `contents` decides what happens to its projects
 * and to-dos: `keep` moves them out of the area, `trash` moves them to Trash.
 */
export function deleteArea(id: ID, contents: 'keep' | 'trash'): Promise<void> {
  return tx(async () => {
    const at = nowIso();
    const projects = await db.projects.where('areaId').equals(id).toArray();
    const todos = await db.todos.where('areaId').equals(id).toArray();
    for (const p of projects) {
      await patch<Project>('projects', p.id, contents === 'trash' ? { trashedAt: at, areaId: null } : { areaId: null });
    }
    for (const t of todos) {
      const start = normalizeStart({ start: t.start, startDate: t.startDate, areaId: null, projectId: t.projectId });
      await patch<Todo>('todos', t.id, contents === 'trash' ? { trashedAt: at, areaId: null } : { areaId: null, start });
    }
    await patch<Area>('areas', id, { deletedAt: at });
  });
}

// ---------------------------------------------------------------------------
// Trash
// ---------------------------------------------------------------------------

/** Permanently delete everything in Trash (FR-12.3). Tombstones stay for sync. */
export function emptyTrash(): Promise<void> {
  return tx(async () => {
    const at = nowIso();
    const todos = (await db.todos.toArray()).filter((t) => t.trashedAt && !t.deletedAt);
    const projects = (await db.projects.toArray()).filter((p) => p.trashedAt && !p.deletedAt);
    for (const p of projects) {
      await patch<Project>('projects', p.id, { deletedAt: at });
      const inside = await db.todos.where('projectId').equals(p.id).toArray();
      for (const t of inside.filter((x) => !x.deletedAt)) await patch<Todo>('todos', t.id, { deletedAt: at });
    }
    for (const t of todos) await patch<Todo>('todos', t.id, { deletedAt: at });
  });
}

