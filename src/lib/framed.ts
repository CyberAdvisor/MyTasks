/**
 * The app refuses to run inside another page's frame (security review,
 * 2026-11-13). GitHub Pages can't send the `frame-ancestors` header, so the
 * app checks for itself and, when framed, shows a short message with a link
 * that opens it directly instead of starting.
 */

/** True when `win` is inside a frame (or can't tell, which counts as framed). */
export function isFramed(win: Window = window): boolean {
  try {
    return win.self !== win.top;
  } catch {
    return true;
  }
}

/** Replace the app with the message and a link that opens the app in its own tab. */
export function showFramedNotice(target: HTMLElement): void {
  const message = document.createElement('p');
  message.className = 'framed-notice';
  message.textContent = 'My Tasks can’t run inside another page. ';
  const link = document.createElement('a');
  link.href = location.href;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = 'Open My Tasks';
  message.append(link);
  target.replaceChildren(message);
}
