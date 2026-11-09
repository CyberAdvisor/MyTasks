/**
 * Reactive app state.
 *
 * - `snapshot`: the whole database as one live value. Dexie re-runs the
 *   query whenever any table changes, so every view stays current. For a
 *   personal task list (thousands of items) this is fast and keeps the list
 *   rules as plain functions.
 * - `settings`: app settings merged over the defaults.
 * - `todayDate`: the local date, refreshed at midnight and whenever the app
 *   becomes visible again (FR-3.5 day rollover). Each refresh also runs the
 *   automatic priority rules (FR-14.9, FR-14.10).
 */
import { liveQuery } from 'dexie';
import { readable, type Readable } from 'svelte/store';
import { db } from '../db/database';
import { sweepPriorities } from '../db/repo';
import { msUntilMidnight, today } from '../model/dates';
import type { Snapshot } from '../model/lists';
import { DEFAULT_SETTINGS, readSettings, type AppSettings } from '../model/settings';
import type { LocalDate } from '../model/types';

const EMPTY: Snapshot = {
  areas: [],
  projects: [],
  headings: [],
  todos: [],
  tags: [],
  checklistItems: [],
  savedSearches: [],
};

/** Drop tombstoned records. */
const live = <T extends { deletedAt: string | null }>(rows: T[]) => rows.filter((r) => r.deletedAt === null);

/** Live view of all records the lists need. */
export const snapshot: Readable<Snapshot> = readable<Snapshot>(EMPTY, (set) => {
  const sub = liveQuery(async () => {
    const [areas, projects, headings, todos, tags, checklistItems, savedSearches] = await Promise.all([
      db.areas.toArray(),
      db.projects.toArray(),
      db.headings.toArray(),
      db.todos.toArray(),
      db.tags.toArray(),
      db.checklistItems.toArray(),
      db.savedSearches.toArray(),
    ]);
    return {
      areas: live(areas),
      projects: live(projects),
      headings: live(headings),
      todos: live(todos),
      tags: live(tags),
      checklistItems: live(checklistItems),
      savedSearches: live(savedSearches),
    } satisfies Snapshot;
  }).subscribe({ next: set, error: (e) => console.error('Snapshot query failed', e) });
  return () => sub.unsubscribe();
});

/** Live app settings. */
export const settings: Readable<AppSettings> = readable<AppSettings>(DEFAULT_SETTINGS, (set) => {
  const sub = liveQuery(async () => readSettings(await db.settings.toArray())).subscribe({
    next: set,
    error: (e) => console.error('Settings query failed', e),
  });
  return () => sub.unsubscribe();
});

/** Today's local date, updated at midnight and on resume. */
export const todayDate: Readable<LocalDate> = readable<LocalDate>(today(), (set) => {
  let timer: ReturnType<typeof setTimeout>;
  const refresh = () => {
    set(today());
    sweepPriorities().catch((e) => console.error('Priority sweep failed', e));
    clearTimeout(timer);
    timer = setTimeout(refresh, msUntilMidnight() + 1000);
  };
  const onVisible = () => {
    if (document.visibilityState === 'visible') refresh();
  };
  refresh();
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisible);
  };
});
