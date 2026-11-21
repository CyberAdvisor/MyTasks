/**
 * Drag and drop with pointer events (FR-10.3 to FR-10.10, FR-15.5).
 *
 * Native HTML drag and drop is unreliable on iOS touch, so every drag uses
 * pointer events: with a mouse or pen a drag starts after a small movement;
 * on touch it starts after a long press, so a plain swipe still scrolls.
 *
 * Two Svelte actions mark up the page:
 * - `dragItem` on each thing that can be dragged (a row, a heading, a sidebar
 *   project, area or saved search, a checklist item). A checklist item is
 *   dragged only by its handle, and on touch the handle drags at once, with
 *   no long press (its `handle` flag).
 * - `dropZone` on each container that orders things of one type. Its `drop`
 *   callback receives the new order of the zone's items and writes it.
 * - `dropTarget` on a single thing an item can be dropped onto, rather than
 *   into a position: a sidebar project or area (FR-10.11), or a sidebar list
 *   (FR-10.3b), takes to-dos. A target under the pointer wins over any zone.
 *
 * Dragging a to-do that is one of several selected carries all of them, in
 * screen order, with their count on the floating copy (FR-10.3b):
 * into a zone they land together where the line shows; onto a
 * target, those it accepts go.
 *
 * Zones of the same type with the same `group` accept each other's items (a
 * to-do dragged under another heading, a project dragged to another area);
 * without a group, a zone only reorders its own items. While dragging, a line
 * shows where the item will land (in a `slide` zone, a checklist, the other
 * items slide apart instead), and a zone other than the one the drag came
 * from is highlighted. Escape cancels. Every drop is one undoable change.
 */
import { rowLimit } from '../state/rowLimit.svelte';
import type { Action } from 'svelte/action';
import { undoGroup } from '../db/history';
import { ui } from '../state/ui.svelte';
import type { ID } from '../model/types';
import { insertionIndex, orderWithAll, sameOrder, shiftedOrder } from './plan';

/** Kinds of things that can be dragged. */
type DragType = 'todo' | 'heading' | 'area' | 'project' | 'saved' | 'checklist';

/** One draggable thing. */
interface DragItem {
  type: DragType;
  id: ID;
  /**
   * Dragged only by an element marked `data-drag-handle` inside it. A press
   * on the handle starts a drag after a small move, on touch too: the handle
   * doesn't scroll (`touch-action: none`), so no long press is needed.
   */
  handle?: boolean;
}

/** A container that orders items of one type. */
export interface DropZone {
  type: DragType;
  /** Zones sharing a group accept each other's items. */
  group?: string;
  /** Place item `id` so the zone's items read `order`. */
  drop(id: ID, order: ID[]): Promise<void> | void;
  /** No "Moved" message with Undo after a drop (a checklist: Undo stays on the keyboard). */
  quiet?: boolean;
  /**
   * Show where the item will land by sliding the other items apart, with the
   * dragged one lifted under the finger, rather
   * than a line. For short rows (a checklist), where the floating copy would
   * cover the line. Reorders its own items only (no `group`).
   */
  slide?: boolean;
}

/** A single thing items can be dropped onto (a sidebar project, area or list). */
export interface DropTarget {
  type: DragType;
  /** Whether item `id` may be dropped here (not where it already is). */
  accepts(id: ID): boolean;
  /**
   * Move the items `ids` (those it accepts) here, as one undo step. Returning
   * false says Undo is offered elsewhere: after a date is picked, or by the
   * Trash's own message.
   */
  drop(ids: ID[]): Promise<boolean | void> | boolean | void;
}

const LONG_PRESS_MS = 400;
/** Movement that starts a pointer drag, or cancels a touch long press (px). */
const START_DISTANCE = { mouse: 4, touch: 8 };
/** Distance from a scroll container's edge where auto-scroll starts (px). */
const SCROLL_EDGE = 48;
const SCROLL_SPEED = 12;
/** A pointer in the gap between zones drops into the nearest one within this distance (px). */
const SNAP_DISTANCE = 28;

const zones = new WeakMap<Element, DropZone>();
const targets = new WeakMap<Element, DropTarget>();

/** Mark an element as a drop zone. Passing null leaves it inert. */
export const dropZone: Action<HTMLElement, DropZone | null> = (node, zone) => {
  const set = (z: DropZone | null) => {
    node.classList.remove('drop-zone', ...[...node.classList].filter((c) => c.startsWith('drop-zone-')));
    if (!z) {
      zones.delete(node);
      return;
    }
    zones.set(node, z);
    node.classList.add('drop-zone', `drop-zone-${z.type}`);
  };
  set(zone);
  return { update: set, destroy: () => zones.delete(node) };
};

/** Mark an element as something to drop onto. Passing null leaves it inert. */
export const dropTarget: Action<HTMLElement, DropTarget | null> = (node, target) => {
  const set = (t: DropTarget | null) => {
    if (t) targets.set(node, t);
    else targets.delete(node);
  };
  set(target);
  return { update: set, destroy: () => targets.delete(node) };
};

/**
 * The drop target at or above `el` that takes at least one of the items
 * `ids` of `type`, if any. Exported for tests.
 */
export function targetAt(el: Element | null, type: DragType, ids: readonly ID[]): Element | null {
  for (let n = el; n; n = n.parentElement) {
    const t = targets.get(n);
    if (t?.type === type) return ids.some((id) => t.accepts(id)) ? n : null;
  }
  return null;
}

/**
 * What a drag starting on `node` carries: every selected to-do on screen, in
 * screen order, when `node` is one of several selected; otherwise just it.
 */
function carried(node: HTMLElement, item: DragItem): HTMLElement[] {
  if (item.type !== 'todo' || !ui.multiple || !ui.isSelected(item.id)) return [node];
  const rows = [...document.querySelectorAll<HTMLElement>('[data-drag-type="todo"]')].filter((el) =>
    ui.isSelected(el.dataset.dragId!),
  );
  return rows.includes(node) ? rows : [node];
}

/** Mark an element as draggable. Passing null leaves it inert. */
export const dragItem: Action<HTMLElement, DragItem | null> = (node, initial) => {
  let item = initial;
  const set = (i: DragItem | null) => {
    item = i;
    if (i) {
      node.dataset.dragType = i.type;
      node.dataset.dragId = i.id;
    } else {
      delete node.dataset.dragType;
      delete node.dataset.dragId;
    }
  };
  set(initial);
  const onDown = (e: PointerEvent) => {
    if (item) pointerDown(e, node, item);
  };
  // Links and images would otherwise start a native drag.
  const onNativeDrag = (e: DragEvent) => e.preventDefault();
  node.addEventListener('pointerdown', onDown);
  node.addEventListener('dragstart', onNativeDrag);
  return {
    update: set,
    destroy() {
      node.removeEventListener('pointerdown', onDown);
      node.removeEventListener('dragstart', onNativeDrag);
    },
  };
};

// ---------------------------------------------------------------------------
// Zone lookup
// ---------------------------------------------------------------------------

/** The nearest zone at or above `el` that holds items of `type`. */
function closestZone(el: Element | null, type: DragType): Element | null {
  for (let n = el; n; n = n.parentElement) if (zones.get(n)?.type === type) return n;
  return null;
}

/** The items of a zone, in order (not those of zones nested inside it). */
function itemsOf(zoneEl: Element, type: DragType): HTMLElement[] {
  return [...zoneEl.querySelectorAll<HTMLElement>(`[data-drag-type="${type}"]`)].filter(
    (el) => closestZone(el.parentElement, type) === zoneEl,
  );
}

/** The ids of a zone's items, in order. */
function idsOf(zoneEl: Element, type: DragType): ID[] {
  return itemsOf(zoneEl, type).map((el) => el.dataset.dragId!);
}

/** Whether a drag that started in `origin` may drop into `target`. */
function accepts(origin: Element, target: Element): boolean {
  if (origin === target) return true;
  const group = zones.get(origin)?.group;
  return group !== undefined && zones.get(target)?.group === group;
}

/**
 * The zone holding the element `el` (an item), with the ids of its items in
 * order. Used to place a new to-do next to the selected one.
 */
export function zoneOf(el: Element, type: DragType): { zone: DropZone; ids: ID[] } | null {
  const z = closestZone(el.parentElement, type);
  return z ? { zone: zones.get(z)!, ids: idsOf(z, type) } : null;
}

/**
 * Move the item element `el` up (-1) or down (+1) one place within its zone,
 * as Cmd/Ctrl+Up and Down do (Section 7). Returns whether it moved.
 */
export async function moveByKeyboard(el: HTMLElement, delta: number): Promise<boolean> {
  const type = el.dataset.dragType as DragType | undefined;
  const z = type ? closestZone(el.parentElement, type) : null;
  if (!type || !z) return false;
  // Moving the last drawn row down: its next neighbour may not be drawn yet (NFR-7).
  if (delta > 0 && itemsOf(z, type).at(-1) === el) rowLimit.drawAll();
  const order = shiftedOrder(idsOf(z, type), el.dataset.dragId!, delta);
  if (!order) return false;
  await zones.get(z)!.drop(el.dataset.dragId!, order);
  return true;
}

// ---------------------------------------------------------------------------
// The drag itself
// ---------------------------------------------------------------------------

interface Session {
  node: HTMLElement;
  item: DragItem;
  /** The elements being dragged (the pressed one, or all selected), and their ids. */
  nodes: HTMLElement[];
  ids: ID[];
  origin: Element;
  touch: boolean;
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
  timer?: ReturnType<typeof setTimeout>;
  ghost?: HTMLElement;
  line?: HTMLElement;
  /** Where a drop would go: a position in a zone, or onto a target. */
  target: { zone: Element; order: ID[] } | { onto: Element } | null;
  highlighted?: Element;
  frame?: number;
  /** A `slide` zone: its other items and their places before the drag, and the dragged item's height. */
  slide?: { items: HTMLElement[]; rects: DOMRect[]; step: number };
}

let session: Session | null = null;

function pointerDown(e: PointerEvent, node: HTMLElement, item: DragItem): void {
  const target = e.target as Element;
  if (session || e.button !== 0 || !e.isPrimary) return;
  // Only the innermost item starts a drag, never from a field being edited or
  // a checkbox. An unfocused title field (a heading's) can be dragged by.
  if (target.closest('[data-drag-type]') !== node) return;
  if (item.handle && !target.closest('[data-drag-handle]')) return;
  if (target.closest('textarea, select, [contenteditable="true"], [data-no-drag]')) return;
  if (target instanceof HTMLInputElement && target === document.activeElement) return;
  const origin = closestZone(node.parentElement, item.type);
  if (!origin) return;

  // A handle never scrolls, so a touch on it drags as a mouse does.
  const touch = e.pointerType === 'touch' && !item.handle;
  session = { node, item, nodes: [node], ids: [item.id], origin, touch, startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, active: false, target: null };
  if (touch) session.timer = setTimeout(start, LONG_PRESS_MS);
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', cancel);
  document.addEventListener('contextmenu', onContextMenu);
  // On a handle, a finger never scrolls the page: Safari on iPhone doesn't
  // honour the handle's touch-action alone, and would scroll and cancel the
  // drag before it starts (seen in the 1.3.2 live test).
  if (item.handle && e.pointerType === 'touch') document.addEventListener('touchmove', preventDefault, { passive: false });
}

function onMove(e: PointerEvent): void {
  const s = session;
  if (!s) return;
  s.x = e.clientX;
  s.y = e.clientY;
  if (!s.active) {
    const moved = Math.hypot(s.x - s.startX, s.y - s.startY);
    if (s.touch && moved > START_DISTANCE.touch) end();
    else if (!s.touch && moved > START_DISTANCE.mouse) start();
    return;
  }
  e.preventDefault();
  track();
}

/** Turn a press into a drag: show the floating copy and start tracking. */
function start(): void {
  const s = session;
  if (!s) return;
  s.active = true;
  // Drop positions need the whole list (NFR-7: long lists are drawn in steps).
  if (s.item.type === 'todo') rowLimit.drawAll();
  // A press on a title field focused it; dragging is not editing.
  if (document.activeElement instanceof HTMLInputElement && s.node.contains(document.activeElement)) document.activeElement.blur();
  getSelection()?.removeAllRanges();
  s.nodes = carried(s.node, s.item);
  s.ids = s.nodes.map((el) => el.dataset.dragId!);
  const rect = s.node.getBoundingClientRect();
  const ghost = s.node.cloneNode(true) as HTMLElement;
  // A copy doesn't keep a field's typed value (a checklist item's text).
  const fields = s.node.querySelectorAll('input');
  ghost.querySelectorAll('input').forEach((f, i) => (f.value = fields[i]?.value ?? ''));
  ghost.classList.add('drag-ghost');
  ghost.removeAttribute('data-drag-type');
  if (s.ids.length > 1) {
    const count = document.createElement('span');
    count.className = 'drag-count';
    count.textContent = String(s.ids.length);
    ghost.append(count);
  }
  Object.assign(ghost.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px` });
  document.body.append(ghost);
  s.ghost = ghost;
  s.line = document.createElement('div');
  s.line.className = 'drop-line';
  document.body.append(s.line);
  const zone = zones.get(s.origin);
  if (zone?.slide) {
    const items = itemsOf(s.origin, s.item.type).filter((el) => el !== s.node);
    s.slide = { items, rects: items.map((el) => el.getBoundingClientRect()), step: rect.height };
    s.node.classList.add('drag-lifted');
    s.line.hidden = true;
  } else {
    for (const el of s.nodes) el.classList.add('drag-source');
  }
  document.body.classList.add('is-dragging', `dragging-${s.item.type}`);
  document.addEventListener('keydown', onKey, true);
  // Stop the page scrolling under a touch drag.
  document.addEventListener('touchmove', preventDefault, { passive: false });
  track();
  autoScroll();
}

/** Follow the pointer: move the copy, find the drop position and show it. */
function track(): void {
  const s = session!;
  if (s.slide) return trackSlide(s, s.slide);
  s.ghost!.style.transform = `translate(${s.x - s.startX}px, ${s.y - s.startY}px)`;

  const onto = targetAt(document.elementFromPoint(s.x, s.y), s.item.type, s.ids);
  const zone = onto ? null : zoneAt(s.x, s.y, s.item.type, s.origin);
  s.target = onto ? { onto } : null;
  if (zone) {
    const items = itemsOf(zone, s.item.type).filter((el) => !s.nodes.includes(el));
    const rects = items.map((el) => el.getBoundingClientRect());
    const index = insertionIndex(rects, s.y);
    s.target = { zone, order: orderWithAll(items.map((el) => el.dataset.dragId!), s.ids, index) };
    showLine(zone, rects, index);
  } else {
    s.line!.hidden = true;
  }
  const into = zone && (zone !== s.origin || !itemsOf(zone, s.item.type).length);
  const highlight = onto ?? (into ? zone : undefined);
  if (highlight !== s.highlighted) {
    s.highlighted?.classList.remove('drop-target');
    highlight?.classList.add('drop-target');
    s.highlighted = highlight;
  }
}

/**
 * A `slide` zone: the lifted item follows the finger up and down, and the
 * other items move aside to open a gap where it will land. Places are worked
 * out from where the items were before the drag, so moving them doesn't feed
 * back into the answer.
 */
function trackSlide(s: Session, slide: NonNullable<Session['slide']>): void {
  s.ghost!.style.transform = `translateY(${s.y - s.startY}px)`;
  const index = insertionIndex(slide.rects, s.y);
  const from = itemsOf(s.origin, s.item.type).indexOf(s.node);
  slide.items.forEach((el, k) => {
    const was = k < from ? k : k + 1;
    const now = k < index ? k : k + 1;
    el.style.transform = now === was ? '' : `translateY(${(now - was) * slide.step}px)`;
  });
  s.target = { zone: s.origin, order: orderWithAll(slide.items.map((el) => el.dataset.dragId!), s.ids, index) };
}

/** Put a slide zone's items back where they are, without animating, once the new order is drawn (or at once). */
function settleSlide(s: Session, waitForOrder: boolean): void {
  const slide = s.slide!;
  const clear = () => {
    for (const el of [...slide.items, s.node]) {
      el.classList.add('drag-settling');
      el.style.transform = '';
      el.classList.remove('drag-lifted');
    }
    requestAnimationFrame(() => {
      for (const el of [...slide.items, s.node]) el.classList.remove('drag-settling');
    });
  };
  if (!waitForOrder) return clear();
  // Until the saved order is drawn, keep the items where the drop showed them.
  const zoneEl = s.origin;
  const watch = new MutationObserver(() => done());
  const timer = setTimeout(() => done(), 600);
  const done = () => {
    watch.disconnect();
    clearTimeout(timer);
    clear();
  };
  watch.observe(zoneEl, { childList: true });
}

/**
 * The zone that takes a drop at (x, y): the one under the pointer, or, in the
 * gap between two zones, the one just above the gap (so the space above a
 * project's first heading drops after its loose to-dos), else the one just
 * below it.
 */
function zoneAt(x: number, y: number, type: DragType, origin: Element): Element | null {
  const under = closestZone(document.elementFromPoint(x, y), type);
  if (under) return accepts(origin, under) ? under : null;
  let above: { el: Element; d: number } | null = null;
  let below: { el: Element; d: number } | null = null;
  for (const el of document.querySelectorAll(`.drop-zone-${type}`)) {
    const r = el.getBoundingClientRect();
    if (x < r.left || x > r.right || !accepts(origin, el)) continue;
    if (y > r.bottom && y - r.bottom <= SNAP_DISTANCE && (!above || y - r.bottom < above.d)) above = { el, d: y - r.bottom };
    if (y < r.top && r.top - y <= SNAP_DISTANCE && (!below || r.top - y < below.d)) below = { el, d: r.top - y };
  }
  return (above ?? below)?.el ?? null;
}

/** Draw the drop line above item `index`, or under the last item. */
function showLine(zone: Element, rects: DOMRect[], index: number): void {
  const line = session!.line!;
  if (!rects.length) {
    line.hidden = true;
    return;
  }
  const box = zone.getBoundingClientRect();
  const y = index < rects.length ? rects[index].top : rects[rects.length - 1].bottom;
  line.hidden = false;
  Object.assign(line.style, { left: `${box.left}px`, width: `${box.width}px`, top: `${y - 1}px` });
}

/** Scroll the list under the pointer while it is near the top or bottom edge. */
function autoScroll(): void {
  const s = session;
  if (!s?.active) return;
  const scroller = scrollParent(document.elementFromPoint(s.x, s.y) ?? s.node);
  if (scroller) {
    const box = scroller.getBoundingClientRect();
    const step = s.y < box.top + SCROLL_EDGE ? -SCROLL_SPEED : s.y > box.bottom - SCROLL_EDGE ? SCROLL_SPEED : 0;
    if (step) {
      scroller.scrollTop += step;
      track();
    }
  }
  s.frame = requestAnimationFrame(autoScroll);
}

/** The nearest ancestor that scrolls vertically. */
function scrollParent(el: Element): HTMLElement | null {
  for (let n: HTMLElement | null = el as HTMLElement; n; n = n.parentElement) {
    const y = getComputedStyle(n).overflowY;
    if ((y === 'auto' || y === 'scroll') && n.scrollHeight > n.clientHeight) return n;
  }
  return null;
}

function onUp(): void {
  const s = session;
  if (!s) return;
  const target = s.active ? s.target : null;
  if (s.active) suppressNextClick();
  // A slide zone keeps its items in place until the new order is drawn.
  const moved = !!target && 'zone' in target && !sameOrder(idsOf(s.origin, s.item.type), target.order);
  if (s.slide) s.ghost!.hidden = true;
  end(s.slide ? moved : undefined);
  if (!target) return;
  if ('onto' in target) {
    const t = targets.get(target.onto);
    if (!t) return;
    void Promise.resolve(t.drop(s.ids.filter((id) => t.accepts(id)))).then((done) => {
      if (done !== false) ui.offerUndo('Moved');
    });
    return;
  }
  const zone = zones.get(target.zone)!;
  const before = target.zone === s.origin ? idsOf(s.origin, s.item.type) : null;
  if (before && sameOrder(before, target.order)) return;
  // Each item is placed in turn against the final order, as one undo step.
  void undoGroup(async () => {
    for (const id of s.ids) await zone.drop(id, target.order);
  }).then(() => {
    if (!zone.quiet) ui.offerUndo('Moved');
  });
}

/** Escape cancels the drag (FR-10.10). */
function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  e.preventDefault();
  e.stopPropagation();
  end();
}

/** A long press must not open the touch context menu. */
function onContextMenu(e: Event): void {
  if (session?.touch) e.preventDefault();
}

/** Stop the drag (or the press that might become one) and remove everything it added. */
/** A cancelled pointer (the browser took it over) ends the drag with no drop. */
function cancel(): void {
  end();
}

/** `settle`: for a slide zone, whether to wait for a new order to be drawn before putting its items back. */
function end(settle = false): void {
  const s = session;
  if (!s) return;
  session = null;
  if (s.slide) settleSlide(s, settle);
  clearTimeout(s.timer);
  if (s.frame) cancelAnimationFrame(s.frame);
  s.ghost?.remove();
  s.line?.remove();
  s.highlighted?.classList.remove('drop-target');
  for (const el of s.nodes) el.classList.remove('drag-source');
  document.body.classList.remove('is-dragging', `dragging-${s.item.type}`);
  document.removeEventListener('pointermove', onMove);
  document.removeEventListener('pointerup', onUp);
  document.removeEventListener('pointercancel', cancel);
  document.removeEventListener('contextmenu', onContextMenu);
  document.removeEventListener('keydown', onKey, true);
  document.removeEventListener('touchmove', preventDefault);
}

function preventDefault(e: Event): void {
  e.preventDefault();
}

/** The click that ends a mouse drag must not also select a row or follow a link. */
function suppressNextClick(): void {
  const stop = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };
  window.addEventListener('click', stop, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 0);
}
