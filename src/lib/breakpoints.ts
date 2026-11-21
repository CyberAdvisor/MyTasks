/**
 * The app's one layout breakpoint (review C14): under 768 px wide is a phone
 * (single pane, sheets along the bottom, compact rows), 768 px and wider an
 * iPad or computer. Code uses these; stylesheets can't import a constant, so
 * each phone media query is written `@media (max-width: 767px)`, matching
 * PHONE_QUERY. Change both together.
 */
export const PHONE_MAX_WIDTH = 767;

/** The media query for a phone-width window. */
export const PHONE_QUERY = `(max-width: ${PHONE_MAX_WIDTH}px)`;

/** A touch screen, the primary pointer being a finger. */
export const TOUCH_QUERY = '(pointer: coarse)';

/** Whether the window is phone-width now. */
export function isPhoneWidth(width = typeof window === 'undefined' ? Infinity : window.innerWidth): boolean {
  return width <= PHONE_MAX_WIDTH;
}
