/**
 * The area this device is focused on (FR-22.1), or null for none.
 *
 * Kept on this device only, like the sidebar width: you can focus on one area
 * on the Mac while the phone shows everything. Never synced, so no schema
 * change. The rule itself is in `src/lib/model/focus.ts`.
 */
import { writable } from 'svelte/store';
import type { ID } from '../model/types';
import { readText, writeText } from './flags';

const KEY = 'mytasks.focusArea';

const store = writable<ID | null>(readText(KEY));

/** The focused area's id, as saved on this device. */
export const focusArea = { subscribe: store.subscribe };

/** Focus on an area, or end the focus with null. */
export function setFocus(areaId: ID | null): void {
  writeText(KEY, areaId);
  store.set(areaId);
}
