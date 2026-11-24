/**
 * Archive (FR-12.11, v1.4.2): completed and canceled items older than a
 * number of days are written to a CSV file in the import format (FR-12.9),
 * then removed for good, so the gist stays small. Each archive is its own
 * dated file (Michael chose a new file over appending, 2026-11-19).
 *
 * What's archived, finished before the cutoff and moved to Completed:
 * - closed projects, with their headings and every task in them (and those
 *   tasks' checklists);
 * - closed tasks elsewhere, repeat copies included, with their checklists.
 * Repeating tasks themselves are always open, so they're never archived.
 * Items in the Trash are left to Empty Trash.
 */
import { addDays, LOCALE, localDay, parseLocalDate } from './model/dates';
import { bySortKey } from './model/order';
import type { Area, ChecklistItem, Context, Heading, ID, LocalDate, Project, Tag, Todo } from './model/types';
import type { Existing } from './import/plan';
import { toCsv } from './import/csv';
import { COLUMN_NAMES } from './import/rows';
import { gistFileName, type GistLabel } from './model/settings';

export interface ArchiveSelection {
  /** The cutoff: items completed before this day. */
  before: LocalDate;
  projects: Project[];
  headings: Heading[];
  todos: Todo[];
  checklistItems: ChecklistItem[];
}

/** The day items must have been completed before: `days` days before `ref`. */
export function archiveCutoff(ref: LocalDate, days: number): LocalDate {
  return addDays(ref, -days);
}

/** "Aug 21, 2026". */
export function longDate(d: LocalDate): string {
  return new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric', year: 'numeric' }).format(parseLocalDate(d));
}

/** Closed, moved to Completed, finished before `before`, not in the Trash. */
function archivable(r: Todo | Project, before: LocalDate): boolean {
  return r.status !== 'open' && r.loggedAt !== null && r.completedAt !== null && !r.trashedAt && localDay(r.completedAt) < before;
}

/** The items to archive from live records. */
export function selectArchive(live: Existing, before: LocalDate): ArchiveSelection {
  const projects = live.projects.filter((p) => archivable(p, before));
  const inProject = new Set(projects.map((p) => p.id));
  const todos = live.todos.filter(
    (t) => !t.repeat && ((t.projectId !== null && inProject.has(t.projectId) && !t.trashedAt) || archivable(t, before)),
  );
  const todoIds = new Set(todos.map((t) => t.id));
  return {
    before,
    projects,
    headings: live.headings.filter((h) => inProject.has(h.projectId)),
    todos,
    checklistItems: live.checklistItems.filter((c) => todoIds.has(c.todoId)),
  };
}

/** "312 tasks and 4 projects", or "1 task". */
export function archiveCounts(s: ArchiveSelection): string {
  const n = (k: number, w: string) => `${k} ${w}${k === 1 ? '' : 's'}`;
  return s.projects.length ? `${n(s.todos.length, 'task')} and ${n(s.projects.length, 'project')}` : n(s.todos.length, 'task');
}

/** The archive file's name, from the gist's name and the day: My Tasks Work archive 2026-11-24.csv. */
export function archiveFileName(day: LocalDate, gist: GistLabel): string {
  return `My Tasks ${gistFileName(gist)} archive ${day}.csv`;
}

/**
 * The selection as a CSV file in the import format. Archived projects and
 * their headings and tasks are linked by id; a task in a project that stays
 * names its project, heading and area, so importing the file again puts it
 * back where it was.
 */
export function archiveCsv(s: ArchiveSelection, live: Pick<Existing, 'areas' | 'projects' | 'headings' | 'tags' | 'contexts'>): string {
  const byId = <T extends { id: ID }>(l: T[]) => new Map(l.map((x) => [x.id, x]));
  const areas = byId<Area>(live.areas);
  const projects = byId<Project>(live.projects);
  const headings = byId<Heading>(live.headings);
  const tags = byId<Tag>(live.tags);
  const contexts = byId<Context>(live.contexts);
  const archived = new Set([...s.projects, ...s.headings].map((x) => x.id));

  const tagPath = (id: ID): string => {
    const names: string[] = [];
    const seen = new Set<ID>();
    for (let t = tags.get(id); t && !seen.has(t.id); t = t.parentTagId ? tags.get(t.parentTagId) : undefined) {
      seen.add(t.id);
      names.unshift(t.title);
    }
    return names.join('/');
  };
  const tagList = (ids: ID[]) => ids.map(tagPath).filter(Boolean).join('; ');
  const day = (iso: string | null) => (iso ? localDay(iso) : '');
  const row = (v: Partial<Record<string, string>>) => COLUMN_NAMES.map((c) => v[c] ?? '');
  // Import needs a title, and an item can have none (a heading often).
  const title = (t: string) => t.trim() || 'Untitled';

  const rows: string[][] = [COLUMN_NAMES];
  const closed = (r: Todo | Project) => ({
    status: r.status,
    completed_date: day(r.completedAt),
    created_date: day(r.createdAt),
    notes: r.notes,
    tags: tagList(r.tagIds),
    deadline: r.deadline ?? '',
  });

  for (const p of bySortKey(s.projects)) {
    rows.push(row({ type: 'project', id: p.id, title: title(p.title), area: p.areaId ? (areas.get(p.areaId)?.title ?? '') : '', ...closed(p) }));
    for (const h of bySortKey(s.headings.filter((h) => h.projectId === p.id)))
      rows.push(row({ type: 'heading', id: h.id, parent_id: p.id, title: title(h.title), created_date: day(h.createdAt) }));
  }
  for (const t of bySortKey(s.todos)) {
    const place: Partial<Record<string, string>> = {};
    if (t.headingId && archived.has(t.headingId)) place.parent_id = t.headingId;
    else if (t.projectId && archived.has(t.projectId)) place.parent_id = t.projectId;
    else if (t.projectId) {
      const p = projects.get(t.projectId);
      place.project = p?.title ?? '';
      place.area = p?.areaId ? (areas.get(p.areaId)?.title ?? '') : '';
      place.heading = t.headingId ? (headings.get(t.headingId)?.title ?? '') : '';
    } else if (t.areaId) place.area = areas.get(t.areaId)?.title ?? '';
    rows.push(
      row({
        type: 'task',
        id: t.id,
        title: title(t.title),
        priority: t.priority ? String(t.priority) : '',
        context: t.contextId ? (contexts.get(t.contextId)?.title ?? '') : '',
        ...place,
        ...closed(t),
      }),
    );
    for (const c of bySortKey(s.checklistItems.filter((c) => c.todoId === t.id)))
      rows.push(row({ type: 'checklist', parent_id: t.id, title: title(c.title), checked: c.completed ? 'yes' : 'no' }));
  }
  return toCsv(rows);
}
