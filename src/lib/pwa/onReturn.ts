/**
 * Coming back to the app (FR-3.5, FR-19.5, NFR-8). The window becoming
 * visible again is the usual sign, but Safari's Dock app on a Mac doesn't
 * hide the page when the user switches to another app, so the window gaining
 * focus counts too. The two often fire together; a second sign within
 * `PAIR_MS` of the first is ignored, so one return runs the callback once.
 */

/** Signs closer together than this are one return. */
export const PAIR_MS = 1000;

/** Call `callback` each time the user comes back to the app. Returns a function that stops listening. */
export function onReturn(callback: () => void): () => void {
  let last = -Infinity;
  const returned = () => {
    if (Date.now() - last < PAIR_MS) return;
    last = Date.now();
    callback();
  };
  const onVisibility = () => {
    if (document.visibilityState === 'visible') returned();
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('focus', returned);
  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('focus', returned);
  };
}
