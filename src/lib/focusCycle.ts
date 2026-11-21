/**
 * Tab through an open task card or Quick Entry: the title, the
 * notes and any checklist items, then Start Date, Tags, Checklist, Deadline,
 * Priority and Context (the last two are additions), whether each shows as a
 * chip or a button, and back to the title. Shift+Tab goes backwards.
 *
 * Reaching a picker opens it, focused on its typing field or current choice
 * (Popover.svelte); Tab or Shift+Tab inside an open picker moves on from its
 * button, and the picker closes as focus leaves it. Move, ⋯, the complete
 * checkbox and the project link aren't stops. The card moves
 * focus itself because Safari on the Mac sends Tab only to text fields.
 */

/** The pickers in order, by their Popover label (or the checklist button). */
const PICKERS = ['Start Date', 'Tags', 'Checklist', 'Deadline', 'Priority', 'Context'];

/** Text fields first: title, notes (the box, or the styled note that becomes it), checklist items, in page order. */
const FIELDS = 'input.title, textarea.title, textarea.notes, .notes-view, input[data-item], [data-item-view]';

const shown = (el: HTMLElement | null): el is HTMLElement =>
  el !== null && !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0;

/** A picker's button: the first button in its Popover, before its panel. */
function pickerButton(container: HTMLElement, label: string): HTMLElement | null {
  if (label === 'Checklist') return container.querySelector<HTMLElement>('button[aria-label="Add checklist"]');
  return container.querySelector<HTMLElement>(`[data-popover="${CSS.escape(label)}"] button`);
}

/** The stops Tab moves between, in order. */
function tabStops(container: HTMLElement): HTMLElement[] {
  const fields = [...container.querySelectorAll<HTMLElement>(FIELDS)].filter(shown);
  const pickers = PICKERS.map((label) => pickerButton(container, label)).filter(shown);
  return [...fields, ...pickers];
}

/** A keydown handler for `container`: Tab and Shift+Tab move through its stops. */
export function cycleTab(e: KeyboardEvent, container: HTMLElement): void {
  if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey) return;
  const from = document.activeElement;
  if (!(from instanceof HTMLElement) || !container.contains(from)) return;
  const stops = tabStops(container);
  if (stops.length === 0) return;

  // Inside a picker, count from its button.
  const wrap = from.closest<HTMLElement>('[data-popover]');
  const at = wrap ? (wrap.querySelector<HTMLElement>('button') ?? from) : from;
  const i = stops.indexOf(at);
  // A picker that isn't a stop (Move) keeps Tab for itself.
  if (i === -1 && wrap) return;

  e.preventDefault();
  const by = e.shiftKey ? -1 : 1;
  const next = stops[i === -1 ? (by > 0 ? 0 : stops.length - 1) : (i + by + stops.length) % stops.length];
  next.focus();
  // A picker opens as soon as Tab reaches it.
  const nextWrap = next.closest<HTMLElement>('[data-popover]');
  if (nextWrap && !nextWrap.querySelector('[data-popover-panel]')) next.click();
}
