/**
 * Drag and drop with pointer events (FR-10.3 to FR-10.10, FR-15.5).
 *
 * Native HTML drag and drop is unreliable on iOS touch, so every drag uses
 * pointer events: with a mouse or pen a drag starts after a small movement;
 * on touch it starts after a long press, so a plain swipe still scrolls.
 *
 * Two Svelte actions mark up the page:
 * - `dragItem` on each thing that can be dragged (a row, a heading, a sidebar
 *   project, area or saved search).
 * - `dropZone` on each container that orders things of one type. Its `drop`
 *   callback receives the new order of the zone's items and writes it.
 *
 * Zones of the same type with the same `group` accept each other's items (a
 * to-do dragged under another heading, a project dragged to another area);
 * without a group, a zone only reorders its own items. While dragging, a line
 * shows where the item will land, and a zone other than the one the drag came
 * from is highlighted. Escape cancels. Every drop is one undoable change.
 */
import type { Action } from 'svelte/action';
import { ui } from '../state/ui.svelte';
import type { ID } from '../model/types';
import { insertionIndex, orderWith, sameOrder, shiftedOrder } from './plan';

/** Kinds of things that can be dragged. */
export type DragType = 'todo' | 'heading' | 'area' | 'project' | 'saved';

/** One draggable thing. */
export interface DragItem {
  type: DragType;
  id: ID;
}

/** A container that orders items of one type. */
export interface DropZone {
  type: DragType;
  /** Zones sharing a group accept each other's items. */
  group?: string;
  /** Place item `id` so the zone's items read `order`. */
  drop(id: ID, order: ID[]): Promise<void> | void;
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
  target: { zone: Element; order: ID[] } | null;
  highlighted?: Element;
  frame?: number;
}

let session: Session | null = null;

function pointerDown(e: PointerEvent, node: HTMLElement, item: DragItem): void {
  const target = e.target as Element;
  if (session || e.button !== 0 || !e.isPrimary) return;
  // Only the innermost item starts a drag, never from a field being edited or
  // a checkbox. An unfocused title field (a heading's) can be dragged by.
  if (target.closest('[data-drag-type]') !== node) return;
  if (target.closest('textarea, select, [contenteditable="true"], [data-no-drag]')) return;
  if (target instanceof HTMLInputElement && target === document.activeElement) return;
  const origin = closestZone(node.parentElement, item.type);
  if (!origin) return;

  const touch = e.pointerType === 'touch';
  session = { node, item, origin, touch, startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, active: false, target: null };
  if (touch) session.timer = setTimeout(start, LONG_PRESS_MS);
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', end);
  document.addEventListener('contextmenu', onContextMenu);
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
  // A press on a title field focused it; dragging is not editing.
  if (document.activeElement instanceof HTMLInputElement && s.node.contains(document.activeElement)) document.activeElement.blur();
  getSelection()?.removeAllRanges();
  const rect = s.node.getBoundingClientRect();
  const ghost = s.node.cloneNode(true) as HTMLElement;
  ghost.classList.add('drag-ghost');
  ghost.removeAttribute('data-drag-type');
  Object.assign(ghost.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px` });
  document.body.append(ghost);
  s.ghost = ghost;
  s.line = document.createElement('div');
  s.line.className = 'drop-line';
  document.body.append(s.line);
  s.node.classList.add('drag-source');
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
  s.ghost!.style.transform = `translate(${s.x - s.startX}px, ${s.y - s.startY}px)`;

  const zone = zoneAt(s.x, s.y, s.item.type, s.origin);
  s.target = null;
  if (zone) {
    const items = itemsOf(zone, s.item.type).filter((el) => el !== s.node);
    const rects = items.map((el) => el.getBoundingClientRect());
    const index = insertionIndex(rects, s.y);
    s.target = { zone, order: orderWith(items.map((el) => el.dataset.dragId!), s.item.id, index) };
    showLine(zone, rects, index);
  } else {
    s.line!.hidden = true;
  }
  const highlight = s.target && (s.target.zone !== s.origin || !itemsOf(s.target.zone, s.item.type).length) ? s.target.zone : undefined;
  if (highlight !== s.highlighted) {
    s.highlighted?.classList.remove('drop-target');
    highlight?.classList.add('drop-target');
    s.highlighted = highlight;
  }
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
  end();
  if (!target) return;
  const zone = zones.get(target.zone)!;
  const before = target.zone === s.origin ? idsOf(s.origin, s.item.type) : null;
  if (before && sameOrder(before, target.order)) return;
  void Promise.resolve(zone.drop(s.item.id, target.order)).then(() => ui.offerUndo('Moved'));
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
function end(): void {
  const s = session;
  if (!s) return;
  session = null;
  clearTimeout(s.timer);
  if (s.frame) cancelAnimationFrame(s.frame);
  s.ghost?.remove();
  s.line?.remove();
  s.highlighted?.classList.remove('drop-target');
  s.node.classList.remove('drag-source');
  document.body.classList.remove('is-dragging', `dragging-${s.item.type}`);
  document.removeEventListener('pointermove', onMove);
  document.removeEventListener('pointerup', onUp);
  document.removeEventListener('pointercancel', end);
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
