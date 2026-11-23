/**
 * What this device lost in a merge (FR-19.12): changes it made since its
 * last sync that a later change from another device replaced.
 *
 * Tasks and projects are compared part by part (model/parts.ts): a part
 * this device changed since `since` that the merge took from the gist,
 * with a different value, was lost. A checklist item changed here and
 * replaced is reported under its task as "checklist". A task or project
 * changed here and deleted on another device is reported as deleted.
 *
 * Left out: an automatic priority, a completion when both devices completed
 * it (only the moment differs), and records made on both devices with the
 * same content, such as a repeat's copy.
 *
 * Pure functions, no storage access.
 */
import { canonical } from '../model/canonical';
import { partsOf, sameFields, toSeconds } from '../model/parts';
import type { BaseRecord, ChecklistItem, Project, Todo } from '../model/types';
import type { Payload } from './payload';

/** One task or project whose change was replaced. */
export interface LostChange {
  kind: 'todo' | 'project';
  id: string;
  /** Its title now, as the user will find it. */
  title: string;
  /** What was lost, such as "title" or "completed"; empty when it was deleted. */
  what: string[];
  /** Deleted on another device. */
  deleted: boolean;
}

/** How each part is named in the notice. */
const PART_NAMES: Record<string, string> = {
  t: 'title',
  n: 'notes',
  d: 'dates',
  p: 'priority',
  c: 'context',
  g: 'tags',
  l: 'place',
  o: 'sort by date',
};

/** The completion part's loss in words, or null when only the moment of completion differs. */
function completionLoss(mine: Todo | Project, now: Todo | Project): string | null {
  if (mine.status !== now.status) return mine.status === 'open' ? 'reopened' : mine.status === 'canceled' ? 'canceled' : 'completed';
  if (Boolean(mine.trashedAt) !== Boolean(now.trashedAt)) return mine.trashedAt ? 'moved to Trash' : 'put back';
  return null;
}

/** A record's content, without the times that only describe when it changed. */
function content(r: BaseRecord): string {
  const { modifiedAt: _m, createdAt: _c, ft: _f, ...rest } = r;
  return canonical(rest);
}

/**
 * The changes in `local` (this device before the merge) that `merged` (the
 * result) replaced, for records this device changed after `since`.
 */
export function lostChanges(local: Payload, merged: Payload, since: string): LostChange[] {
  const sinceSeconds = toSeconds(since);
  const found = new Map<string, LostChange>();
  /** Record that `r` lost `what` (nothing when `what` is null). */
  const note = (kind: LostChange['kind'], r: Todo | Project, what: string | null) => {
    if (!what) return;
    const key = `${kind}:${r.id}`;
    const entry = found.get(key) ?? { kind, id: r.id, title: r.title, what: [], deleted: false };
    if (!entry.what.includes(what)) entry.what.push(what);
    found.set(key, entry);
  };

  const tables = [
    ['todos', 'todo'],
    ['projects', 'project'],
  ] as const;
  for (const [table, kind] of tables) {
    const parts = partsOf(table)!;
    const after = new Map(merged.tables[table].map((r) => [r.id, r as Todo | Project]));
    for (const row of local.tables[table] as (Todo | Project)[]) {
      const now = after.get(row.id);
      if (!now || row.deletedAt || now === row) continue;
      const changedHere = Object.keys(parts).filter((p) => (row.ft?.[p] ?? -1) > sinceSeconds);
      if (now.deletedAt) {
        if (changedHere.length) found.set(`${kind}:${row.id}`, { kind, id: row.id, title: row.title, what: [], deleted: true });
        continue;
      }
      for (const p of changedHere) {
        if (sameFields(row as never, now as never, parts[p])) continue;
        if (p === 'p' && (row as Todo).prioritySource === 'auto') continue;
        note(kind, now, p === 's' ? completionLoss(row, now) : PART_NAMES[p]);
      }
    }
  }

  // Checklist items: reported under their task.
  const todosNow = new Map(merged.tables.todos.map((r) => [r.id, r as Todo]));
  const itemsNow = new Map(merged.tables.checklistItems.map((r) => [r.id, r as ChecklistItem]));
  for (const item of local.tables.checklistItems as ChecklistItem[]) {
    if (item.deletedAt || !item.modifiedAt || toSeconds(item.modifiedAt) <= sinceSeconds) continue;
    const now = itemsNow.get(item.id);
    if (!now || now === item || content(now) === content(item)) continue;
    const todo = todosNow.get(item.todoId);
    if (todo && !todo.deletedAt) note('todo', todo, 'checklist');
  }
  return [...found.values()];
}

/** The notice's title: "1 of your changes was replaced…" (FR-19.12). */
export function lostTitle(count: number): string {
  return count === 1
    ? '1 of your changes was replaced by a later change from another device'
    : `${count} of your changes were replaced by later changes from another device`;
}

/** What a task or project lost, as the notice says it: "completed, notes" or "deleted on another device". */
export function lostWhat(change: LostChange): string {
  return change.deleted ? 'deleted on another device' : change.what.join(', ');
}

/** How many lost changes the notice lists before "and N more". */
export const LOST_SHOWN = 10;
