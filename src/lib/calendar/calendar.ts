/**
 * The calendar events this device shows (FR-21.2): calendar.json from the
 * gist, decrypted with the same key as the tasks, as a live value.
 *
 * Each sync hands over the file it read (`receiveCalendar`); it is opened
 * only when it changed (a new IV, random for every write the helper makes),
 * and kept encrypted on the device (device.ts), so the events show at
 * launch and offline (`showSavedCalendar`). Nothing here can fail a sync:
 * a file that can't be opened shows no events and a problem in Settings.
 */
import { readable, writable, type Readable } from 'svelte/store';
import { DecryptError, parseEnvelope, unseal } from '../sync/crypto';
import { loadCalendarFile, saveCalendarFile, type DeviceConfig } from '../sync/device';
import { readCalendar, type CalendarData } from './events';

/**
 * Why the calendar file shows no events:
 * - `passphrase`: it was written with another passphrase (setup on the Mac
 *   predates a passphrase change); the helper's setup must be run again
 * - `unreadable`: it isn't a calendar file this version can read
 */
export type CalendarProblem = 'passphrase' | 'unreadable';

export interface CalendarState {
  /** The events, or null when there is no file or it can't be opened. */
  data: CalendarData | null;
  /** When the helper last wrote the file (its envelope's time), or null with no file. */
  updatedAt: string | null;
  problem: CalendarProblem | null;
}

const NONE: CalendarState = { data: null, updatedAt: null, problem: null };

const state = writable<CalendarState>(NONE);

/** This device's calendar events, as last read from the gist. */
export const calendar: Readable<CalendarState> = { subscribe: state.subscribe };

/** The IV of the file now shown, so an unchanged file isn't decrypted again. */
let shownIv: string | null = null;

/** The key and its derivation settings, which the calendar file must match. */
type Keys = Pick<DeviceConfig, 'key' | 'salt' | 'iterations'>;

/** Open a calendar file into a state; never throws. */
async function open(keys: Keys, file: string): Promise<CalendarState> {
  const env = parseEnvelope(file, 'mytasks-calendar');
  if (!env) return { ...NONE, problem: 'unreadable' };
  const updatedAt = env.updatedAt;
  if (env.kdf.salt !== keys.salt || env.kdf.iterations !== keys.iterations) return { data: null, updatedAt, problem: 'passphrase' };
  try {
    const data = readCalendar(JSON.parse(await unseal(keys.key, env)));
    return data ? { data, updatedAt, problem: null } : { data: null, updatedAt, problem: 'unreadable' };
  } catch (e) {
    // The same salt but a key that doesn't open it: a damaged file.
    if (!(e instanceof DecryptError) && !(e instanceof SyntaxError)) console.error('Calendar file failed', e);
    return { data: null, updatedAt, problem: 'unreadable' };
  }
}

/** Show `file` (opened with `keys`); remember its IV once it opened, so it isn't opened again. */
async function show(keys: Keys, file: string): Promise<void> {
  const next = await open(keys, file);
  shownIv = next.data ? parseEnvelope(file, 'mytasks-calendar')!.cipher.iv : null;
  state.set(next);
}

/** At launch: show the calendar file saved on this device, if any. */
export async function showSavedCalendar(keys: Keys): Promise<void> {
  try {
    const file = await loadCalendarFile();
    if (file !== null) await show(keys, file);
  } catch (e) {
    console.error('Reading the saved calendar failed', e);
  }
}

/**
 * After a sync read the gist: show its calendar file (null when the gist
 * has none, e.g. the helper isn't set up) and save it on this device.
 */
export async function receiveCalendar(keys: Keys, file: string | null): Promise<void> {
  try {
    if (file === null) {
      shownIv = null;
      state.set(NONE);
      await saveCalendarFile(null);
      return;
    }
    if (shownIv !== null && parseEnvelope(file, 'mytasks-calendar')?.cipher.iv === shownIv) return;
    await saveCalendarFile(file);
    await show(keys, file);
  } catch (e) {
    console.error('Reading the calendar failed', e);
  }
}

/**
 * The current time, updated at the start of every minute, so ended events
 * dim as they end (FR-21.3).
 */
export const minuteClock: Readable<Date> = readable(new Date(), (set) => {
  let timer: ReturnType<typeof setTimeout>;
  const tick = () => {
    set(new Date());
    timer = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
  };
  tick();
  return () => clearTimeout(timer);
});
