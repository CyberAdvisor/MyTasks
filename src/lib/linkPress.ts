/**
 * Shown text with links that turns into a text box when pressed (formatted notes
 * and checklist items, FR-7.4, FR-7.1): a press on a link opens the link, and a
 * press anywhere else, or focus arriving by Tab, starts editing.
 *
 * With a mouse the press on a link is cancelled, so it can't focus the shown
 * text (Safari doesn't focus links, so the text would take focus instead). A touch
 * must not be cancelled, or iPhone drops the tap; the focus that comes with it is
 * ignored instead.
 */
export interface LinkPress {
  onpointerdown: (e: PointerEvent) => void;
  onclick: (e: MouseEvent) => void;
  onfocus: () => void;
  onkeydown: (e: KeyboardEvent) => void;
}

const onLink = (e: Event) => (e.target as Element).closest('a') !== null;

/** The handlers for one piece of shown text; `edit` switches it to its text box. */
export function linkPress(edit: () => void): LinkPress {
  let pressingLink = false;
  return {
    onpointerdown(e) {
      if (!onLink(e)) return;
      if (e.pointerType === 'mouse') e.preventDefault();
      else {
        pressingLink = true;
        setTimeout(() => (pressingLink = false), 1000);
      }
    },
    onclick(e) {
      if (onLink(e)) pressingLink = false;
      else edit();
    },
    onfocus() {
      if (!pressingLink) edit();
    },
    onkeydown(e) {
      if (e.key === 'Enter' && !onLink(e)) edit();
    },
  };
}
