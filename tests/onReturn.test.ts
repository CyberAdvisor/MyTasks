/**
 * Coming back to the app (FR-3.5, FR-19.5): the window gaining focus counts,
 * as well as it becoming visible, because Safari's Dock app on a Mac doesn't
 * hide the page when the user switches apps (found in live testing of 1.1.10).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { PAIR_MS, onReturn } from '../src/lib/pwa/onReturn';
import { SyncEngine } from '../src/lib/sync/sync.svelte';
import { todayDate } from '../src/lib/state/live';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const focus = () => window.dispatchEvent(new Event('focus'));
const visible = () => document.dispatchEvent(new Event('visibilitychange'));

describe('onReturn', () => {
  it('runs on window focus and on becoming visible, once for a pair, and stops', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const back = vi.fn();
    const stop = onReturn(back);
    focus();
    visible(); // jsdom's page is always visible: the same return
    expect(back).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + PAIR_MS);
    visible();
    expect(back).toHaveBeenCalledTimes(2);
    vi.setSystemTime(Date.now() + PAIR_MS);
    stop();
    focus();
    expect(back).toHaveBeenCalledTimes(2);
  });
});

describe('coming back to the Dock app', () => {
  it('syncs when the window gains focus (FR-19.5)', async () => {
    const engine = new SyncEngine();
    const syncNow = vi.spyOn(engine, 'syncNow').mockResolvedValue();
    await engine.start();
    const atLaunch = syncNow.mock.calls.length;
    focus();
    expect(syncNow).toHaveBeenCalledTimes(atLaunch + 1);
  });

  it('runs the return check when the window gains focus, so Today moves on to a new day (FR-3.5)', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 14, 23, 0));
    const seen: string[] = [];
    const stop = todayDate.subscribe((d) => seen.push(d));
    expect(get(todayDate)).toBe('2026-11-14');
    // The Mac slept past midnight; the midnight timer hasn't run.
    vi.setSystemTime(new Date(2026, 10, 15, 8, 0));
    focus();
    expect(seen.at(-1)).toBe('2026-11-15');
    stop();
  });
});
