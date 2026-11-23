/**
 * Reactive app state.
 *
 * - `fullSnapshot`: the whole database as one live value. Dexie re-runs the
 *   query whenever any table changes, so every view stays current. For a
 *   personal task list (thousands of items) this is fast and keeps the list
 *   rules as plain functions.
 * - `snapshot`: the same, narrowed to the focused area when there is one
 *   (FR-22.1). Views read this, so lists, counts, Quick Find and saved
 *   searches all follow the focus. Tags and contexts are kept whole. Only
 *   the Move dialog's places, which must offer every area, read
 *   `fullSnapshot`. The sidebar's counts read it, so they change at once.
 * - `listSnapshot`: the same with held tasks listed where they were (the
 *   open card's task, and tasks moved out of the Inbox while it shows;
 *   src/lib/model/hold.ts). The lists and pages read this.
 * - `todoById`: every task as saved, for a row or card to show its
 *   current values while it's held.
 * - `settings`: app settings merged over the defaults.
 * - `todayDate`: the local date, refreshed at midnight and whenever the app
 *   becomes visible again (FR-3.5 day rollover). Each refresh also runs the
 *   return check (`returnCheck`): once that return's sync has settled, the
 *   automatic rules (a reached deadline sets When, FR-3.7; priorities,
 *   FR-14.9, FR-14.10) and the move of completed items that are due to
 *   Completed (FR-12.2).
 */
import { liveQuery } from 'dexie';
import { derived, readable, type Readable } from 'svelte/store';
import { db } from '../db/database';
import { sweepCompleted, sweepRules } from '../db/repo';
import { clearChangeLog } from '../db/history';
import { dropOldTombstones } from '../sync/local';
import { msUntilMidnight, today } from '../model/dates';
import { onReturn } from '../pwa/onReturn';
import { sync } from '../sync/sync.svelte';
import { activeFocus, focusSnapshot } from '../model/focus';
import { focusArea } from './focus';
import { held } from './held';
import { holdPlacement } from '../model/hold';
import type { Snapshot } from '../model/lists';
import { DEFAULT_SETTINGS, readSettings, type AppSettings } from '../model/settings';
import type { ID, LocalDate, Todo } from '../model/types';

const EMPTY: Snapshot = {
  areas: [],
  projects: [],
  headings: [],
  todos: [],
  tags: [],
  contexts: [],
  checklistItems: [],
  savedSearches: [],
};

/** Drop tombstoned records. */
const live = <T extends { deletedAt: string | null }>(rows: T[]) => rows.filter((r) => r.deletedAt === null);

/** Live view of all records the lists need, in every area. */
export const fullSnapshot: Readable<Snapshot> = readable<Snapshot>(EMPTY, (set) => {
  const sub = liveQuery(async () => {
    const [areas, projects, headings, todos, tags, contexts, checklistItems, savedSearches] = await Promise.all([
      db.areas.toArray(),
      db.projects.toArray(),
      db.headings.toArray(),
      db.todos.toArray(),
      db.tags.toArray(),
      db.contexts.toArray(),
      db.checklistItems.toArray(),
      db.savedSearches.toArray(),
    ]);
    return {
      areas: live(areas),
      projects: live(projects),
      headings: live(headings),
      todos: live(todos),
      tags: live(tags),
      contexts: live(contexts),
      checklistItems: live(checklistItems),
      savedSearches: live(savedSearches),
    } satisfies Snapshot;
  }).subscribe({ next: set, error: (e) => console.error('Snapshot query failed', e) });
  return () => sub.unsubscribe();
});

/** The live view narrowed to the focused area, if any (FR-22.1). */
export const snapshot: Readable<Snapshot> = derived([fullSnapshot, focusArea], ([s, areaId]) => focusSnapshot(s, areaId));

/** What the lists show: held tasks where they were, narrowed to the focus (FR-22.1). */
export const listSnapshot: Readable<Snapshot> = derived([fullSnapshot, held, focusArea], ([s, h, areaId]) =>
  focusSnapshot(holdPlacement(s, h), areaId),
);

/** How many tasks count toward the limit (NFR-7): every one not deleted, Trash and Completed included. */
export const taskCount: Readable<number> = derived(fullSnapshot, (s) => s.todos.length);

/** Every task as saved, by id. */
export const todoById: Readable<ReadonlyMap<ID, Todo>> = derived(fullSnapshot, (s) => new Map(s.todos.map((t) => [t.id, t])));

/** The focused area while it exists, else null: what the sidebar band and new tasks follow. */
export const focusedArea: Readable<ID | null> = derived([fullSnapshot, focusArea], ([s, areaId]) => activeFocus(s, areaId));

/** Live app settings. */
export const settings: Readable<AppSettings> = readable<AppSettings>(DEFAULT_SETTINGS, (set) => {
  const sub = liveQuery(async () => readSettings(await db.settings.toArray())).subscribe({
    next: set,
    error: (e) => console.error('Settings query failed', e),
  });
  return () => sub.unsubscribe();
});

/**
 * The return check's rules (FR-3.5) and the move of completed items
 * (FR-12.2), run at launch, on coming back and at midnight. They wait for
 * that moment's sync to settle (or fail, offline), so they act on what the
 * other devices changed meanwhile. Run on this device's older copy first,
 * they would give a task completed elsewhere a newer change (moved into
 * Today), and the merge, where the later change wins, would reopen it.
 */
export async function returnCheck(): Promise<void> {
  await sync.settled();
  await sweepRules().catch((e) => console.error('Rules sweep failed', e));
  await sweepCompleted().catch((e) => console.error('Completed sweep failed', e));
}

/** Today's local date, updated at midnight and on coming back to the app (FR-3.5). */
export const todayDate: Readable<LocalDate> = readable<LocalDate>(today(), (set) => {
  let timer: ReturnType<typeof setTimeout>;
  const refresh = () => {
    set(today());
    void returnCheck();
    clearChangeLog().catch((e) => console.error('Clearing the change log failed', e));
    dropOldTombstones().catch((e) => console.error('Dropping old tombstones failed', e));
    clearTimeout(timer);
    timer = setTimeout(refresh, msUntilMidnight() + 1000);
  };
  refresh();
  const stopListening = onReturn(refresh);
  return () => {
    clearTimeout(timer);
    stopListening();
  };
});
