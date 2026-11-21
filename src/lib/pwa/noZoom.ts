/**
 * No pinch zoom in the app, as in a native app (Michael,
 * 2026-11-18). In the installed iPhone app a pinch could zoom in, and after
 * switching apps and back, Safari no longer let a pinch zoom out again, so
 * the app had to be closed. Text still follows the device's own text size.
 *
 * Safari ignores the viewport's `user-scalable=no`, so its pinch events
 * (`gesturestart`, WebKit only) are cancelled instead. `index.html` also sets
 * `maximum-scale=1`, which stops Safari zooming into a field as it is
 * focused, and app.css's `touch-action: manipulation` stops double-tap zoom.
 */
export function blockZoom(target: Pick<Document, 'addEventListener'> = document): void {
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    target.addEventListener(type, (e) => e.preventDefault(), { passive: false });
  }
}
