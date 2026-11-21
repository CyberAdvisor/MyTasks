/**
 * Helpers shared by the right-click menus (RowMenu for tasks, SidebarMenu
 * for sidebar items): placing a menu inside the window, moving between its
 * items with the arrow keys, and closing it on a click outside.
 */

/** Space kept between a menu and the window's edges. */
export const MARGIN = 8;
/** Items a keyboard user can move between. */
const ITEM = '[role^="menuitem"]:not(:disabled)';

/** Keep `v` between `lo` and `hi`. */
export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(v, hi));

/** Focus item `index` of a menu (negative counts from the end). */
export function focusItem(container: HTMLElement | undefined, index: number): void {
  const list = container ? [...container.querySelectorAll<HTMLElement>(ITEM)] : [];
  list.at(index)?.focus();
}

/** Move focus up or down a menu, wrapping around. */
export function step(container: HTMLElement, by: number): void {
  const list = [...container.querySelectorAll<HTMLElement>(ITEM)];
  const i = list.indexOf(document.activeElement as HTMLElement);
  // From the menu itself (nothing highlighted yet), Down goes to the first item and Up to the last.
  const next = i === -1 ? (by > 0 ? 0 : list.length - 1) : (i + by + list.length) % list.length;
  list[next]?.focus();
}

/**
 * Call `close` on a pointer press outside the menu's `parts`, on scrolling
 * outside them, or when the window loses focus or is resized. Returns the
 * function that stops listening.
 */
export function closeOnOutside(parts: () => (HTMLElement | undefined)[], close: () => void): () => void {
  const outside = (e: Event) => {
    const t = e.target as Node;
    if (parts().some((p) => p?.contains(t))) return;
    close();
  };
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('scroll', outside, true);
  window.addEventListener('blur', close);
  window.addEventListener('resize', close);
  return () => {
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('scroll', outside, true);
    window.removeEventListener('blur', close);
    window.removeEventListener('resize', close);
  };
}
