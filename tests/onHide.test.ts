/** Saving what's waiting when the app is hidden or closed (lib/state/onHide.ts, review C7). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onHide } from '../src/lib/state/onHide';

const setVisibility = (state: 'hidden' | 'visible') => {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
};

afterEach(() => {
  setVisibility('visible');
  vi.restoreAllMocks();
});

describe('onHide', () => {
  it('runs every registered save when the page is hidden or closed, until removed', () => {
    const a = vi.fn();
    const b = vi.fn();
    const stopA = onHide(a);
    const stopB = onHide(b);
    setVisibility('hidden');
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    setVisibility('visible'); // coming back saves nothing
    expect(a).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('pagehide'));
    expect(a).toHaveBeenCalledTimes(2);
    stopA();
    setVisibility('hidden');
    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(3);
    stopB();
  });

  it('one failing save does not stop the others', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const later = vi.fn();
    const stops = [
      onHide(() => {
        throw new Error('x');
      }),
      onHide(later),
    ];
    setVisibility('hidden');
    expect(later).toHaveBeenCalled();
    stops.forEach((stop) => stop());
  });
});
