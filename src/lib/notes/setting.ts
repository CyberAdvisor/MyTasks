/**
 * Whether this device shows the calendar and daily notes (FR-24.1): Settings ›
 * Daily Notes, kept per device and off until switched on. A device with it
 * off still syncs the gist's notes, so nothing is lost when it's switched on.
 */
import { writable } from 'svelte/store';
import { readFlag, writeFlag } from '../state/flags';

const KEY = 'mytasks.dailyNotes';
const store = writable(readFlag(KEY));

/** Whether this device shows daily notes. */
export const dailyNotesOn = { subscribe: store.subscribe };

export function setDailyNotes(on: boolean): void {
  writeFlag(KEY, on);
  store.set(on);
}
