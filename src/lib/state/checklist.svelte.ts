/**
 * Checklist storage behind the Checklist component (FR-7.1, FR-7.2).
 *
 * The same component edits a stored to-do's checklist (in the to-do card) and
 * a draft's checklist (in Quick Entry, saved only when the draft is saved).
 * Both sides implement `ChecklistOps`.
 */
import * as repo from '../db/repo';
import { uuidv7 } from '../model/ids';
import type { ID } from '../model/types';

/** The fields of a checklist item the component shows. */
export interface ChecklistRow {
  id: ID;
  title: string;
  completed: boolean;
}

/** What the Checklist component can do to a checklist. */
export interface ChecklistOps {
  /** Add items after `afterId` (or at the end when null); returns the new ids. */
  add(titles: string[], afterId: ID | null): Promise<ID[]>;
  update(id: ID, changes: Partial<Pick<ChecklistRow, 'title' | 'completed'>>): Promise<void>;
  remove(id: ID): Promise<void>;
  move(id: ID, direction: 'up' | 'down'): Promise<void>;
  /** Put item `id` where `order` (every item's id, in stored order) says. */
  place(id: ID, order: ID[]): Promise<void>;
}

/**
 * The stored order after dragging `id` to where `shown` (the items as
 * displayed) has it: just after the nearest item shown before it, or, when
 * there is none, just before the nearest item shown after it; the others
 * keep their stored order. With checked items shown at the bottom (FR-7.5),
 * `together` limits those neighbours to items shown in the same part
 * (checked or not), so the drop shows where it was made.
 */
export function droppedOrder(
  stored: readonly ID[],
  shown: readonly ID[],
  id: ID,
  together: (other: ID) => boolean = () => true,
): ID[] {
  const i = shown.indexOf(id);
  if (i < 0) return [...stored];
  const rest = stored.filter((x) => x !== id);
  const before = shown.slice(0, i).reverse().find(together);
  const after = shown.slice(i + 1).find(together);
  if (before !== undefined) rest.splice(rest.indexOf(before) + 1, 0, id);
  else if (after !== undefined) rest.splice(rest.indexOf(after), 0, id);
  else return [...stored];
  return rest;
}

/** Operations on a stored to-do's checklist, written straight to the database. */
export function storedChecklist(todoId: ID): ChecklistOps {
  return {
    add: (titles, afterId) => repo.addChecklistItems(todoId, titles, afterId),
    update: (id, changes) => repo.updateChecklistItem(id, changes),
    remove: (id) => repo.deleteChecklistItem(id),
    move: (id, direction) => repo.moveChecklistItem(id, direction),
    place: (id, order) => repo.placeChecklistItem(id, order),
  };
}

/** A checklist kept in memory until its draft is saved. */
export class DraftChecklist implements ChecklistOps {
  items = $state<ChecklistRow[]>([]);

  async add(titles: string[], afterId: ID | null): Promise<ID[]> {
    const rows = titles.map((title) => ({ id: uuidv7(), title, completed: false }));
    const at = afterId === null ? this.items.length : this.items.findIndex((c) => c.id === afterId) + 1;
    this.items.splice(at, 0, ...rows);
    return rows.map((r) => r.id);
  }

  async update(id: ID, changes: Partial<Pick<ChecklistRow, 'title' | 'completed'>>): Promise<void> {
    const item = this.items.find((c) => c.id === id);
    if (item) Object.assign(item, changes);
  }

  async remove(id: ID): Promise<void> {
    this.items = this.items.filter((c) => c.id !== id);
  }

  async move(id: ID, direction: 'up' | 'down'): Promise<void> {
    const i = this.items.findIndex((c) => c.id === id);
    const j = direction === 'up' ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= this.items.length) return;
    [this.items[i], this.items[j]] = [this.items[j], this.items[i]];
  }

  async place(_id: ID, order: ID[]): Promise<void> {
    const byId = new Map(this.items.map((c) => [c.id, c]));
    const placed = order.map((x) => byId.get(x)).filter((c): c is ChecklistRow => !!c);
    this.items = [...placed, ...this.items.filter((c) => !order.includes(c.id))];
  }

  /** Items to save: titles trimmed, empty ones dropped. */
  toSave(): { title: string; completed: boolean }[] {
    return this.items.filter((c) => c.title.trim()).map((c) => ({ title: c.title.trim(), completed: c.completed }));
  }
}
