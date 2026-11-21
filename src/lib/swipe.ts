/**
 * Swipe actions on task rows (FR-10.4). On touch, a
 * row moved sideways follows the finger and shows what letting go will do:
 * past a third of the row's width, left to right opens the Start Date picker
 * and right to left starts Select mode with the task selected. Short of that
 * it springs back.
 *
 * Mouse and pen are left alone. A move that starts mostly up or down scrolls
 * the list as usual (rows allow only vertical panning, `touch-action:
 * pan-y`), and a swipe from the screen's left edge is left to the browser's
 * Back gesture. A long press still drags (lib/drag): it ends if the finger
 * moves first, and a swipe never starts once a drag has.
 *
 * The row's markup isn't changed: its children slide, and the row's own
 * background shows the action's colour and label in the gap they leave.
 */
import type { Action } from 'svelte/action';

export type SwipeAction = 'when' | 'select';

/** Movement before a press counts as a swipe or a scroll (px). */
const START = 10;
/** Swipes starting this close to the screen's left edge are the browser's (px). */
const EDGE = 24;
/** How far, as a share of the row's width, a swipe must go to act. */
const TRIGGER = 1 / 3;

/** The direction a move from the press has taken: across, up or down, or not yet clear. */
export function axisOf(dx: number, dy: number): 'across' | 'along' | null {
  if (Math.hypot(dx, dy) < START) return null;
  return Math.abs(dx) > Math.abs(dy) * 1.5 ? 'across' : 'along';
}

/** What letting go after moving `dx` across a row `width` wide does, if anything. */
export function swipeAction(dx: number, width: number): SwipeAction | null {
  if (Math.abs(dx) < width * TRIGGER) return null;
  return dx > 0 ? 'when' : 'select';
}

/** Whether a press at `x` is close enough to the screen's left edge to leave to the browser. */
export const atEdge = (x: number): boolean => x < EDGE;

const LABEL: Record<SwipeAction, string> = { when: 'Start Date', select: 'Select' };

/**
 * Mark a task row as swipeable; `onswipe` runs the chosen action. Passing
 * null leaves the row inert (in Completed and the Trash, in Select mode).
 */
export const swipeRow: Action<HTMLElement, ((action: SwipeAction) => void) | null> = (node, initial) => {
  let onswipe = initial;
  let start: { x: number; y: number; id: number } | null = null;
  let sliding = false;
  let dx = 0;

  const children = () => [...node.children] as HTMLElement[];

  /** Slide the row's contents and show the action under them. */
  function show(offset: number) {
    dx = offset;
    const action = swipeAction(dx, node.offsetWidth);
    for (const el of children()) el.style.transform = `translateX(${dx}px)`;
    node.style.setProperty('--swipe-gap', `${Math.abs(dx)}px`);
    node.dataset.swipe = dx > 0 ? 'when' : 'select';
    node.dataset.swipeLabel = LABEL[dx > 0 ? 'when' : 'select'];
    node.classList.toggle('swipe-ready', action !== null);
  }

  /** Put the row back, sliding its contents home. */
  function reset() {
    for (const el of children()) {
      el.style.transition = 'transform 0.18s ease-out';
      el.style.transform = '';
      el.addEventListener('transitionend', () => (el.style.transition = ''), { once: true });
    }
    node.style.removeProperty('--swipe-gap');
    delete node.dataset.swipe;
    delete node.dataset.swipeLabel;
    node.classList.remove('swiping', 'swipe-ready');
    sliding = false;
    start = null;
    dx = 0;
  }

  function onDown(e: PointerEvent) {
    if (!onswipe || e.pointerType !== 'touch' || !e.isPrimary || atEdge(e.clientX)) return;
    start = { x: e.clientX, y: e.clientY, id: e.pointerId };
  }

  function onMove(e: PointerEvent) {
    if (!start || e.pointerId !== start.id) return;
    const mx = e.clientX - start.x;
    const my = e.clientY - start.y;
    if (!sliding) {
      const axis = axisOf(mx, my);
      if (axis === null) return;
      // A drag that began with a long press keeps the finger.
      if (axis === 'along' || document.body.classList.contains('is-dragging')) {
        start = null;
        return;
      }
      sliding = true;
      node.classList.add('swiping');
    }
    show(mx);
  }

  function onUp(e: PointerEvent) {
    if (!start || e.pointerId !== start.id) return;
    if (!sliding) {
      start = null;
      return;
    }
    const action = swipeAction(dx, node.offsetWidth);
    suppressNextClick();
    reset();
    if (action) onswipe?.(action);
  }

  node.addEventListener('pointerdown', onDown);
  node.addEventListener('pointermove', onMove);
  node.addEventListener('pointerup', onUp);
  node.addEventListener('pointercancel', reset);
  return {
    update(next) {
      onswipe = next;
      if (!next && start) reset();
    },
    destroy() {
      node.removeEventListener('pointerdown', onDown);
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerup', onUp);
      node.removeEventListener('pointercancel', reset);
    },
  };
};

/** The tap that ends a swipe must not also open the task. */
function suppressNextClick(): void {
  const stop = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };
  window.addEventListener('click', stop, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 0);
}
