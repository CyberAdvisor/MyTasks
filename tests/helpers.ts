/** Shared test helpers. */
import { db } from '../src/lib/db/database';
import { uuidv7 } from '../src/lib/model/ids';
import type { Snapshot } from '../src/lib/model/lists';
import type { Project, Todo } from '../src/lib/model/types';

/** Load the current database contents the way the app does. */
export async function snap(): Promise<Snapshot> {
  const [areas, projects, headings, todos, tags, checklistItems] = await Promise.all([
    db.areas.toArray(),
    db.projects.toArray(),
    db.headings.toArray(),
    db.todos.toArray(),
    db.tags.toArray(),
    db.checklistItems.toArray(),
  ]);
  return {
    areas: areas.filter((a) => !a.deletedAt),
    projects: projects.filter((p) => !p.deletedAt),
    headings: headings.filter((h) => !h.deletedAt),
    todos: todos.filter((t) => !t.deletedAt),
    tags: tags.filter((t) => !t.deletedAt),
    checklistItems: checklistItems.filter((c) => !c.deletedAt),
  };
}

/** An empty snapshot with the given overrides. */
export function snapshotOf(over: Partial<Snapshot> = {}): Snapshot {
  return { areas: [], projects: [], headings: [], todos: [], tags: [], checklistItems: [], ...over };
}

/** Build a to-do with sensible defaults for list-rule tests. */
export function todo(over: Partial<Todo> = {}): Todo {
  return {
    id: uuidv7(),
    createdAt: '',
    modifiedAt: '',
    deletedAt: null,
    sortKey: 'a0',
    title: 't',
    notes: '',
    status: 'open',
    start: 'unscheduled',
    startDate: null,
    todaySortKey: null,
    deadline: null,
    priority: null,
    prioritySource: null,
    priorityBeforeAuto: null,
    tagIds: [],
    areaId: null,
    projectId: null,
    headingId: null,
    completedAt: null,
    trashedAt: null,
    ...over,
  };
}

/** Build a project with sensible defaults. */
export function project(over: Partial<Project> = {}): Project {
  return {
    id: uuidv7(),
    createdAt: '',
    modifiedAt: '',
    deletedAt: null,
    sortKey: 'a0',
    title: 'p',
    notes: '',
    status: 'open',
    start: 'unscheduled',
    startDate: null,
    deadline: null,
    tagIds: [],
    areaId: null,
    completedAt: null,
    trashedAt: null,
    ...over,
  };
}
