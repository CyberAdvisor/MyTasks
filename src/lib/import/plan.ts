/**
 * Import's plan (FR-12.6): from checked rows and what the device already
 * holds, the records to add and the tags to add to existing areas and
 * projects. Pure, so the preview and the import itself build the same plan
 * (the import builds it again inside its transaction).
 *
 * Matching, decided 2026-11-18: an area, project, heading (within its
 * project), tag or context with the same name, ignoring capitals, is added
 * to; when two existing ones share the name, a new one is made. A repeating
 * project's row always makes a new project, its template, as a repeating
 * task's row always makes a new task (FR-4.6). Names a row
 * mentions that don't exist yet are created. Items keep the file's order,
 * after what is already in each list.
 */
import { isReminderAt, templateReminder } from '../model/reminder';
import { keyAtEnd, keyBetween } from '../model/order';
import { firstDate } from '../model/repeat';
import { weekday } from '../model/dates';
import type {
  Area,
  BaseRecord,
  ChecklistItem,
  Context,
  Heading,
  ID,
  LocalDate,
  Project,
  RepeatRule,
  Tag,
  Todo,
} from '../model/types';
import { ImportError, type ImportRow, type RowType } from './rows';

/** What the device holds now: live records (not deleted). */
export interface Existing {
  areas: Area[];
  projects: Project[];
  headings: Heading[];
  todos: Todo[];
  checklistItems: ChecklistItem[];
  tags: Tag[];
  contexts: Context[];
}

export interface ImportPlan {
  add: {
    areas: Area[];
    projects: Project[];
    headings: Heading[];
    todos: Todo[];
    checklistItems: ChecklistItem[];
    tags: Tag[];
    contexts: Context[];
  };
  /** Tags the file gives an area or project the device already has. */
  tagPatches: { entity: 'areas' | 'projects'; id: ID; tagIds: ID[] }[];
  /** How many existing areas, projects, headings, tags and contexts the file adds to. */
  matched: { areas: number; projects: number; headings: number; tags: number; contexts: number };
}

/** Build the plan. `ref` is today; `at` the time to stamp; `newId` makes ids. */
export function buildPlan(rows: ImportRow[], existing: Existing, ref: LocalDate, at: string, newId: () => ID): ImportPlan {
  const p = new Planner(existing, ref, at, newId);
  // Containers first, so rows can point forward to them by parent_id.
  for (const type of ['area', 'project', 'heading', 'task', 'checklist'] as RowType[]) {
    for (const row of rows) if (row.type === type) p.row(row);
  }
  return p.plan;
}

const norm = (s: string) => s.trim().toLocaleLowerCase();
/** A date at local noon, as a timestamp, so it stays that day in any nearby time zone. */
const noon = (d: LocalDate) => {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day, 12).toISOString();
};

class Planner {
  plan: ImportPlan = {
    add: { areas: [], projects: [], headings: [], todos: [], checklistItems: [], tags: [], contexts: [] },
    tagPatches: [],
    matched: { areas: 0, projects: 0, headings: 0, tags: 0, contexts: 0 },
  };
  /** Records by the file's ids, and the type of row that made them. */
  private byFileId = new Map<string, { type: RowType; id: ID }>();
  /** Task records by row number, for checklist rows under them. */
  private taskByLine = new Map<number, ID>();
  /** The last sort key used in each list. */
  private lastKey = new Map<string, string>();
  private areas: Area[];
  private projects: Project[];
  private headings: Heading[];
  private tags: Tag[];
  private contexts: Context[];
  private matchedIds = new Set<ID>();

  constructor(
    private existing: Existing,
    private ref: LocalDate,
    private at: string,
    private newId: () => ID,
  ) {
    this.areas = [...existing.areas];
    this.projects = existing.projects.filter((x) => !x.trashedAt);
    this.headings = existing.headings.filter((h) => !h.archived);
    this.tags = [...existing.tags];
    this.contexts = [...existing.contexts];
  }

  row(r: ImportRow): void {
    if (r.type === 'area') this.areaRow(r);
    else if (r.type === 'project') this.projectRow(r);
    else if (r.type === 'heading') this.headingRow(r);
    else if (r.type === 'task') this.taskRow(r);
    else this.checklistRow(r);
  }

  // -- Base fields and order -------------------------------------------------

  private base(list: string, siblings: () => string[], created: LocalDate | null): BaseRecord {
    const last = this.lastKey.get(list);
    const key = last === undefined ? keyAtEnd(siblings()) : keyBetween(last, null);
    this.lastKey.set(list, key);
    return { id: this.newId(), createdAt: created ? noon(created) : this.at, modifiedAt: this.at, deletedAt: null, sortKey: key };
  }

  private remember(r: ImportRow, id: ID): void {
    if (r.id !== null) this.byFileId.set(r.id, { type: r.type, id });
  }

  /** The record a row's parent_id names, which must be one of `types`. */
  private parent(r: ImportRow, types: RowType[]): { type: RowType; id: ID } | null {
    if (r.parentId === null) return null;
    const p = this.byFileId.get(r.parentId);
    if (!p) throw new ImportError(r.line, `parent_id “${r.parentId}” isn’t the id of any row.`);
    if (!types.includes(p.type)) throw new ImportError(r.line, `parent_id “${r.parentId}” is a ${p.type}; a ${r.type} goes in a ${types.join(' or ')}.`);
    return p;
  }

  /**
   * The record a name means: the one this file made with that name, else
   * the one existing record with it; undefined when none, or when two share
   * it. The file's own comes first, so a row naming a project the file just
   * made isn't sent to a new one by older projects sharing its name.
   */
  private only<T extends { title: string; id: ID }>(list: T[], name: string): T | undefined {
    const found = list.filter((x) => norm(x.title) === norm(name));
    const made = found.filter((x) => this.isNew(x.id));
    if (made.length) return made.length === 1 ? made[0] : undefined;
    return found.length === 1 ? found[0] : undefined;
  }

  private match<T extends { id: ID }>(found: T | undefined, kind: keyof ImportPlan['matched']): T | undefined {
    if (found && !this.matchedIds.has(found.id) && !this.isNew(found.id)) {
      this.matchedIds.add(found.id);
      this.plan.matched[kind]++;
    }
    return found;
  }

  private isNew(id: ID): boolean {
    const a = this.plan.add;
    return [a.areas, a.projects, a.headings, a.tags, a.contexts].some((l) => l.some((x) => x.id === id));
  }

  // -- Areas, projects, headings -----------------------------------------------

  private areaRow(r: ImportRow): void {
    const area = this.areaNamed(r.title, r.createdDate);
    this.addTags('areas', area, r);
    this.remember(r, area.id);
  }

  private areaNamed(name: string, created: LocalDate | null = null): Area {
    const found = this.match(this.only(this.areas, name), 'areas');
    if (found) return found;
    const area: Area = { ...this.base('areas', () => this.existing.areas.map((a) => a.sortKey), created), title: name, tagIds: [], collapsed: false };
    this.areas.push(area);
    this.plan.add.areas.push(area);
    return area;
  }

  private projectRow(r: ImportRow): void {
    const parent = this.parent(r, ['area']);
    const areaId = parent?.id ?? (r.area ? this.areaNamed(r.area).id : null);
    const project = this.projectNamed(r.title, areaId, r);
    this.addTags('projects', project, r);
    this.remember(r, project.id);
  }

  private projectNamed(name: string, areaId: ID | null, r: ImportRow | null = null): Project {
    const found = r?.repeat ? undefined : this.match(this.only(this.projects, name), 'projects');
    if (found) return found;
    const siblings = () => this.existing.projects.filter((x) => x.areaId === areaId).map((x) => x.sortKey);
    // A repeating project is the template: its start date is its first copy's, as for a task.
    const rule = r?.repeat ? this.ruleFor(r) : null;
    const when = rule
      ? { start: 'unscheduled' as const, startDate: rule.next }
      : r
        ? this.start(r)
        : { start: 'unscheduled' as const, startDate: null };
    const project: Project = {
      ...this.base(`projects:${areaId ?? ''}`, siblings, r?.createdDate ?? null),
      title: name,
      notes: r?.notes ?? '',
      status: r?.status ?? 'open',
      start: when.start === 'deferred' ? 'deferred' : 'unscheduled',
      startDate: when.startDate,
      deadline: r?.deadline ?? null,
      tagIds: [],
      areaId,
      ...this.closed(r),
      trashedAt: null,
      sortByDate: false,
      repeat: rule?.rule ?? null,
      repeatOf: null,
    };
    this.projects.push(project);
    this.plan.add.projects.push(project);
    return project;
  }

  private headingRow(r: ImportRow): void {
    const parent = this.parent(r, ['project']);
    const projectId = parent?.id ?? (r.project ? this.projectNamed(r.project, null).id : null);
    if (!projectId) throw new ImportError(r.line, 'A heading needs a project (or a parent_id).');
    this.remember(r, this.headingNamed(r.title, projectId, r.createdDate).id);
  }

  private headingNamed(name: string, projectId: ID, created: LocalDate | null = null): Heading {
    const inProject = this.headings.filter((h) => h.projectId === projectId);
    const found = this.match(this.only(inProject, name), 'headings');
    if (found) return found;
    const siblings = () => this.existing.headings.filter((h) => h.projectId === projectId).map((h) => h.sortKey);
    const heading: Heading = {
      ...this.base(`headings:${projectId}`, siblings, created),
      title: name,
      projectId,
      archived: false,
      collapsed: false,
      sortByDate: false,
    };
    this.headings.push(heading);
    this.plan.add.headings.push(heading);
    return heading;
  }

  // -- Tasks and checklists ------------------------------------------------------

  private taskRow(r: ImportRow): void {
    const place = this.placeOf(r);
    const list = place.projectId ? `todos:p:${place.projectId}` : place.areaId ? `todos:a:${place.areaId}` : 'todos:inbox';
    const siblings = () =>
      this.existing.todos
        .filter((t) =>
          place.projectId ? t.projectId === place.projectId : place.areaId ? t.areaId === place.areaId && !t.projectId : !t.projectId && !t.areaId,
        )
        .map((t) => t.sortKey);
    const contained = place.projectId !== null || place.areaId !== null;
    const when = this.start(r);
    const rule = r.repeat ? this.ruleFor(r) : null;
    // A repeating project's template keeps no dates or repeats on its tasks: they belong to its copies (FR-4.6).
    if (place.projectId && this.projects.find((x) => x.id === place.projectId)?.repeat && (when.startDate || r.deadline || rule))
      throw new ImportError(r.line, 'A task in a repeating project takes no start date, deadline or repeat: each copy of the project gets its own.');
    // A repeating task, or one in a repeating project's template, keeps its reminder's time only (FR-3.8).
    const inTemplate = !!(place.projectId && this.projects.find((x) => x.id === place.projectId)?.repeat);
    if (r.reminder && !rule && !inTemplate && !isReminderAt(r.reminder))
      throw new ImportError(r.line, 'A reminder written as a time only is for a repeating task: give it a date, as YYYY-MM-DD HH:MM.');
    const todo: Todo = {
      ...this.base(list, siblings, r.createdDate),
      title: r.title,
      notes: r.notes,
      status: r.status,
      // A task with a place or a date leaves the Inbox (as repo.normalizeStart).
      start: when.start === 'inbox' && (contained || when.startDate) ? 'unscheduled' : when.start,
      startDate: when.startDate,
      todaySortKey: null,
      deadline: rule ? null : r.deadline,
      reminder: rule || inTemplate ? templateReminder(r.reminder) : r.reminder,
      priority: r.priority,
      prioritySource: r.priority ? 'user' : null,
      priorityBeforeAuto: null,
      tagIds: this.tagIds(r),
      contextId: r.context ? this.contextNamed(r.context).id : null,
      ...place,
      ...this.closed(r),
      trashedAt: null,
      releasedBy: null,
      releasedFrom: null,
      repeat: rule?.rule ?? null,
      repeatOf: null,
    };
    if (rule) Object.assign(todo, { start: 'unscheduled', startDate: rule.next });
    this.plan.add.todos.push(todo);
    this.taskByLine.set(r.line, todo.id);
    this.remember(r, todo.id);
  }

  /** Where a task goes: its parent_id, or its project and heading, or its area, or the Inbox. */
  private placeOf(r: ImportRow): Pick<Todo, 'areaId' | 'projectId' | 'headingId'> {
    const parent = this.parent(r, ['area', 'project', 'heading']);
    if (parent?.type === 'area') return { areaId: parent.id, projectId: null, headingId: null };
    if (parent?.type === 'project') return { areaId: null, projectId: parent.id, headingId: null };
    if (parent?.type === 'heading') {
      const h = this.headings.find((x) => x.id === parent.id)!;
      return { areaId: null, projectId: h.projectId, headingId: h.id };
    }
    if (r.project) {
      const areaId = r.area ? this.areaNamed(r.area).id : null;
      const project = this.projectNamed(r.project, areaId);
      return { areaId: null, projectId: project.id, headingId: r.heading ? this.headingNamed(r.heading, project.id).id : null };
    }
    if (r.heading) throw new ImportError(r.line, 'heading is set, but project is empty.');
    return { areaId: r.area ? this.areaNamed(r.area).id : null, projectId: null, headingId: null };
  }

  private checklistRow(r: ImportRow): void {
    const todoId = this.parent(r, ['task'])?.id ?? this.taskByLine.get(r.taskAbove!)!;
    const siblings = () => this.existing.checklistItems.filter((c) => c.todoId === todoId).map((c) => c.sortKey);
    const item: ChecklistItem = { ...this.base(`checklist:${todoId}`, siblings, r.createdDate), todoId, title: r.title, completed: r.checked };
    this.plan.add.checklistItems.push(item);
    this.remember(r, item.id);
  }

  // -- Field helpers ---------------------------------------------------------------

  /** A row's start and start date. A date of today or earlier puts it in Today. */
  private start(r: ImportRow): { start: Todo['start']; startDate: LocalDate | null } {
    switch (r.start) {
      case 'today':
        return { start: 'unscheduled', startDate: this.ref };
      case 'date':
        return { start: 'unscheduled', startDate: r.startDate };
      case 'deferred':
        return { start: 'deferred', startDate: null };
      case 'unscheduled':
        return { start: 'unscheduled', startDate: null };
      default:
        return { start: 'inbox', startDate: null };
    }
  }

  /** Completed or canceled rows go straight to Completed, with their date. */
  private closed(r: ImportRow | null): { completedAt: string | null; loggedAt: string | null } {
    if (!r || r.status === 'open') return { completedAt: null, loggedAt: null };
    const when = r.completedDate ? noon(r.completedDate) : this.at;
    return { completedAt: when, loggedAt: when };
  }

  /**
   * A repeating task's or project's rule with its blanks filled from its first date (or
   * today): a weekly repeat on that weekday, a monthly one on that day, a
   * yearly one in that month. `next` is the template's start date: its first
   * copy's date (as the Repeat dialog sets it).
   */
  private ruleFor(r: ImportRow): { rule: RepeatRule; next: LocalDate } {
    const from = r.repeatFirst ?? this.ref;
    const rule = { ...r.repeat!, weekdays: [...r.repeat!.weekdays], days: [...r.repeat!.days] };
    if (rule.mode === 'fixed') {
      if (rule.unit === 'week' && !rule.weekdays.length) rule.weekdays = [weekday(from)];
      if ((rule.unit === 'month' || rule.unit === 'year') && !rule.days.length) rule.days = [{ ordinal: Number(from.slice(8)), weekday: null }];
      if (rule.unit === 'year' && rule.month === null) rule.month = Number(from.slice(5, 7));
      const next = firstDate(rule, from);
      if (!next) throw new ImportError(r.line, 'This repeat has no dates.');
      return { rule, next };
    }
    return { rule, next: from };
  }

  private tagIds(r: ImportRow): ID[] {
    return [...new Set(r.tags.map((path) => this.tagAt(path).id))];
  }

  private addTags(entity: 'areas' | 'projects', rec: Area | Project, r: ImportRow): void {
    const ids = this.tagIds(r).filter((id) => !rec.tagIds.includes(id));
    if (!ids.length) return;
    rec.tagIds = [...rec.tagIds, ...ids];
    if (!this.isNew(rec.id)) {
      const existing = this.plan.tagPatches.find((x) => x.id === rec.id);
      if (existing) existing.tagIds = rec.tagIds;
      else this.plan.tagPatches.push({ entity, id: rec.id, tagIds: rec.tagIds });
    }
  }

  /**
   * The tag at a path. One name matches a tag with that name anywhere; a
   * path walks from a top-level tag down through nested ones.
   */
  private tagAt(path: string[]): Tag {
    if (path.length === 1) {
      const found = this.match(this.only(this.tags, path[0]), 'tags');
      return found ?? this.newTag(path[0], null);
    }
    let parent = null as Tag | null;
    for (const name of path) {
      const level = this.tags.filter((t) => t.parentTagId === (parent?.id ?? null));
      parent = this.match(this.only(level, name), 'tags') ?? this.newTag(name, parent?.id ?? null);
    }
    return parent!;
  }

  private newTag(title: string, parentTagId: ID | null): Tag {
    const tag: Tag = { ...this.base('tags', () => this.existing.tags.map((t) => t.sortKey), null), title, shortcut: null, parentTagId };
    this.tags.push(tag);
    this.plan.add.tags.push(tag);
    return tag;
  }

  private contextNamed(name: string): Context {
    const found = this.match(this.only(this.contexts, name), 'contexts');
    if (found) return found;
    const context: Context = { ...this.base('contexts', () => this.existing.contexts.map((c) => c.sortKey), null), title: name };
    this.contexts.push(context);
    this.plan.add.contexts.push(context);
    return context;
  }
}

/** "120 tasks, 8 projects, 2 headings, 3 areas and 14 checklist items", for the preview and the result. */
export function planCounts(plan: ImportPlan): string {
  const a = plan.add;
  const parts = (
    [
    [a.todos.length, 'task'],
    [a.projects.length, 'project'],
    [a.headings.length, 'heading'],
    [a.areas.length, 'area'],
    [a.checklistItems.length, 'checklist item'],
  ] as [number, string][]
  ).filter(([n]) => n)
    .map(([n, w]) => `${n} ${w}${n === 1 ? '' : 's'}`);
  if (!parts.length) return 'nothing new';
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

/** "2 areas and 5 tags you already have", or '' when the file adds to none. */
export function planMatches(plan: ImportPlan): string {
  const m = plan.matched;
  const parts = (
    [
      [m.areas, 'area'],
      [m.projects, 'project'],
      [m.headings, 'heading'],
      [m.tags, 'tag'],
      [m.contexts, 'context'],
    ] as [number, string][]
  )
    .filter(([n]) => n)
    .map(([n, w]) => `${n} ${w}${n === 1 ? '' : 's'}`);
  if (!parts.length) return '';
  return `${parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`} you already have`;
}
