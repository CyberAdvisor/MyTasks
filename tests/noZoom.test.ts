/** No pinch zoom in the app (lib/pwa/noZoom.ts). */
import { describe, expect, it } from 'vitest';
import html from '../index.html?raw';
import { blockZoom } from '../src/lib/pwa/noZoom';

describe('pinch zoom', () => {
  it("cancels Safari's pinch events", () => {
    const target = new EventTarget();
    blockZoom(target as unknown as Document);
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
      const e = new Event(type, { cancelable: true });
      target.dispatchEvent(e);
      expect(e.defaultPrevented).toBe(true);
    }
  });

  it('keeps the page at its own scale, so a focused field is not zoomed into', () => {
    expect(html).toMatch(/name="viewport" content="[^"]*maximum-scale=1/);
  });
});
