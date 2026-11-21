/**
 * Selecting several tasks (FR-10.1). Pure, so each
 * gesture is easy to test; `ui` keeps the current selection and the rows'
 * screen order comes from the view.
 *
 * - `active` is the row the keyboard is on (and the one a single click chose).
 * - `anchor` is where a Shift selection starts; Shift-click and Shift+arrows
 *   select everything from it to the new active row.
 * - Cmd/Ctrl-click adds or removes one row and makes it the new anchor.
 */
import type { ID } from './types';

export interface Selection {
  /** The selected rows, in the order they were chosen (ranges in screen order). */
  ids: ID[];
  active: ID | null;
  anchor: ID | null;
}

export const NO_SELECTION: Selection = { ids: [], active: null, anchor: null };

/** One row selected, or none. */
export function single(id: ID | null): Selection {
  return id ? { ids: [id], active: id, anchor: id } : NO_SELECTION;
}

/** Cmd/Ctrl-click: add the row, or remove it if it was selected. */
export function toggle(s: Selection, id: ID): Selection {
  if (!s.ids.includes(id)) return { ids: [...s.ids, id], active: id, anchor: id };
  const ids = s.ids.filter((x) => x !== id);
  const last = ids[ids.length - 1] ?? null;
  return { ids, active: last, anchor: last };
}

/** Shift-click: every row from the anchor to `id`, in screen order; the anchor stays. */
export function rangeTo(s: Selection, order: ID[], id: ID): Selection {
  const anchor = s.anchor && order.includes(s.anchor) ? s.anchor : id;
  const [a, b] = [order.indexOf(anchor), order.indexOf(id)];
  if (b < 0) return s;
  const ids = order.slice(Math.min(a, b), Math.max(a, b) + 1);
  return { ids, active: id, anchor };
}

/**
 * Shift+Up (-1) or Shift+Down (+1): move the active row by one and select
 * from the anchor to it. With nothing selected, select the first or last row.
 */
export function extend(s: Selection, order: ID[], delta: -1 | 1): Selection {
  if (!order.length) return s;
  const i = s.active ? order.indexOf(s.active) : -1;
  if (i < 0) return single(order[delta > 0 ? 0 : order.length - 1]);
  const next = order[Math.max(0, Math.min(order.length - 1, i + delta))];
  return rangeTo(s, order, next);
}

/** Select All: every row, keeping the active row if it is one of them. */
export function selectAll(s: Selection, order: ID[]): Selection {
  if (!order.length) return s;
  const active = s.active && order.includes(s.active) ? s.active : order[0];
  return { ids: [...order], active, anchor: order[0] };
}

/** The selected rows still on screen, in screen order: what an action acts on. */
export function inOrder(s: Selection, order: ID[]): ID[] {
  return order.filter((id) => s.ids.includes(id));
}
