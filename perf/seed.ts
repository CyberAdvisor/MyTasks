/**
 * NFR-7 timing data: 4,000 open and 1,000 completed tasks, spread the way a
 * real list might be, for the timing run (perf/timing.spec.ts). Not part of
 * the app or its tests.
 *
 * Open tasks: 300 in Today, 600 scheduled, 300 deferred, 200 in the Inbox and
 * 2,600 unscheduled, in 10 areas of 5 projects each. A third have notes, one
 * in eight a checklist of 3 items, one in five a tag, one in four a context.
 */
import { generateNKeysBetween } from 'fractional-indexing';
import type { Area, ChecklistItem, Context, Project, Tag, Todo } from '../src/lib/model/types';

const WORDS = (
  'review plan call email draft book order fix update check send prepare write read clean pay renew ' +
  'schedule organise budget report invoice meeting garden kitchen car dentist passport website launch ' +
  'newsletter slides contract insurance taxes groceries library hotel flights paint shelves backup photos'
).split(' ');

/** A deterministic pseudo-random number in [0, 1), so every run has the same data. */
function rng(seed = 1): () => number {
  let x = seed;
  return () => ((x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
}

/** A local `YYYY-MM-DD`, `days` from today. */
function localDate(days = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export interface Seed {
  areas: Area[];
  projects: Project[];
  todos: Todo[];
  checklistItems: ChecklistItem[];
  tags: Tag[];
  contexts: Context[];
}

export function seed(open = 4000, completed = 1000): Seed {
  const r = rng();
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const phrase = (n: number) => Array.from({ length: n }, () => pick(WORDS)).join(' ');
  const at = new Date(Date.now() - 86_400_000).toISOString();
  const keys = generateNKeysBetween(null, null, open + completed + 3000);
  let k = 0;
  const base = (id: string) => ({ id, createdAt: at, modifiedAt: at, deletedAt: null, sortKey: keys[k++], ft: {} });

  const areas: Area[] = Array.from({ length: 10 }, (_, i) => ({ ...base(`area${i}`), title: `Area ${i} ${pick(WORDS)}`, tagIds: [], collapsed: false }));
  const projects: Project[] = Array.from({ length: 50 }, (_, i) => ({
    ...base(`proj${i}`),
    title: `${phrase(2)} ${i}`,
    notes: '',
    status: 'open',
    start: 'unscheduled',
    startDate: null,
    deadline: null,
    tagIds: [],
    areaId: `area${i % 10}`,
    completedAt: null,
    loggedAt: null,
    trashedAt: null,
    sortByDate: false,
    repeat: null,
    repeatOf: null,
  }) as Project);
  const tags: Tag[] = Array.from({ length: 10 }, (_, i) => ({ ...base(`tag${i}`), title: `Tag ${pick(WORDS)} ${i}`, shortcut: null, parentTagId: null }));
  const contexts: Context[] = ['Computer', 'Phone', 'Errands', 'Home'].map((t, i) => ({ ...base(`ctx${i}`), title: t }));

  const todayKeys = generateNKeysBetween(null, null, 300);
  const todos: Todo[] = [];
  const checklistItems: ChecklistItem[] = [];
  for (let i = 0; i < open + completed; i++) {
    const done = i >= open;
    // Which list an open task is in, by its index.
    const kind = done ? 'project' : i < 300 ? 'today' : i < 900 ? 'scheduled' : i < 1200 ? 'deferred' : i < 1400 ? 'inbox' : 'project';
    const inProject = kind !== 'inbox' && r() < 0.85;
    const id = `todo${i}`;
    const completedAt = done ? new Date(Date.now() - Math.floor(r() * 90) * 86_400_000).toISOString() : null;
    todos.push({
      ...base(id),
      title: `${phrase(3 + Math.floor(r() * 4))}`,
      notes: r() < 0.33 ? phrase(12 + Math.floor(r() * 20)) : '',
      status: done ? 'completed' : 'open',
      start: kind === 'inbox' ? 'inbox' : kind === 'deferred' ? 'deferred' : 'unscheduled',
      startDate: kind === 'today' ? localDate() : kind === 'scheduled' ? localDate(1 + Math.floor(r() * 120)) : null,
      todaySortKey: kind === 'today' ? todayKeys[i] : null,
      deadline: r() < 0.05 && !done ? localDate(Math.floor(r() * 30)) : null,
      priority: null,
      prioritySource: null,
      priorityBeforeAuto: null,
      tagIds: r() < 0.2 ? [pick(tags).id] : [],
      contextId: r() < 0.25 ? pick(contexts).id : null,
      areaId: kind !== 'inbox' && !inProject ? pick(areas).id : null,
      projectId: kind !== 'inbox' && inProject ? pick(projects).id : null,
      headingId: null,
      completedAt,
      loggedAt: completedAt,
      trashedAt: null,
      releasedBy: null,
      releasedFrom: null,
      repeat: null,
      repeatOf: null,
    } as Todo);
    if (r() < 0.125) {
      for (let c = 0; c < 3; c++) checklistItems.push({ ...base(`${id}-c${c}`), todoId: id, title: phrase(3), completed: false } as ChecklistItem);
    }
  }
  return { areas, projects, todos, checklistItems, tags, contexts };
}
