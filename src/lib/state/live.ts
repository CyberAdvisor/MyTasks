/**
 * Reactive app state.
 *
 * - `snapshot`: the whole database as one live value. Dexie re-runs the
 *   query whenever any table changes, so every view stays current. For a
 *   personal task list (thousands of items) this is fast and keeps the list
 *   rules as plain functions.
 * - `todayDate`: the local date, refreshed at midnight and whenever the app
 *   becomes visible again (FR-3.5 day rollover).
 */
import { liveQuery } from 'dexie';
import { readable, type Readable } from 'svelte/store';
import { db } from '../db/database';
import { msUntilMidnight, today } from '../model/dates';
import type { Snapshot } from '../model/lists';
import type { LocalDate } from '../model/types';

const EMPTY: Snapshot = { areas: [], projects: [], headings: [], todos: [] };

/** Live view of all records the lists need. */
export const snapshot: Readable<Snapshot> = readable<Snapshot>(EMPTY, (set) => {
  const sub = liveQuery(async () => {
    const [areas, projects, headings, todos] = await Promise.all([
      db.areas.toArray(),
      db.projects.toArray(),
      db.headings.toArray(),
      db.todos.toArray(),
    ]);
    return {
      areas: areas.filter((a) => a.deletedAt === null),
      projects: projects.filter((p) => p.deletedAt === null),
      headings: headings.filter((h) => h.deletedAt === null),
      todos: todos.filter((t) => t.deletedAt === null),
    } satisfies Snapshot;
  }).subscribe({ next: set, error: (e) => console.error('Snapshot query failed', e) });
  return () => sub.unsubscribe();
});

/** Today's local date, updated at midnight and on resume. */
export const todayDate: Readable<LocalDate> = readable<LocalDate>(today(), (set) => {
  let timer: ReturnType<typeof setTimeout>;
  const refresh = () => {
    set(today());
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
