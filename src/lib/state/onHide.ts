/**
 * Save what's waiting when the app is hidden or closed (review C7, F9).
 *
 * Typed text saves 300 ms after the last key, and a check-off after its
 * short delay. Switching apps, locking the phone or closing the tab inside
 * that time used to lose it: on iPhone a hidden Home Screen app is often
 * closed by the system before its timers run, and leaving the app doesn't
 * blur the field being typed in. Each place that holds unsaved work
 * registers its save here, and every one runs at once when the page is
 * hidden (`visibilitychange`) or closed (`pagehide`).
 */
const saves = new Set<() => void>();

/** Run `save` whenever the app is hidden or closed, until the returned function is called. */
export function onHide(save: () => void): () => void {
  saves.add(save);
  return () => saves.delete(save);
}

/** Run every registered save now. Exported for tests. */
function saveAllNow(): void {
  for (const save of [...saves]) {
    try {
      save();
    } catch (e) {
      // One failing save must not stop the others.
      console.error('Save failed', e);
    }
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveAllNow();
  });
  window.addEventListener('pagehide', saveAllNow);
}
