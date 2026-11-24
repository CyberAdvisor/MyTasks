/**
 * Which gist this device is working in (FR-19.11).
 *
 * Each gist on the device has its own task database. The first gist's is
 * `mytasks`, the database every device had before 1.11, so nothing moves on
 * upgrade; a gist added later gets `mytasks-<gist id>`. The active one is
 * named in localStorage so that `database.ts` can open it synchronously at
 * start-up; `mytasks-device` (sync/device.ts) holds each gist's settings and
 * is the record of which gists exist.
 */

/** The first gist's database: the one every device had before 1.11. */
export const FIRST_DB = 'mytasks';

const ACTIVE_KEY = 'mytasks.activeDb';

/** The database name for an added gist. */
export function dbNameFor(gistId: string): string {
  return `${FIRST_DB}-${gistId}`;
}

/** Whether `name` is one of the app's task database names. */
export function isTaskDbName(name: unknown): name is string {
  return typeof name === 'string' && /^mytasks(-[0-9A-Za-z]+)?$/.test(name);
}

/** The active gist's database name; the first gist's when none is saved. */
export function activeDbName(): string {
  try {
    const saved = localStorage.getItem(ACTIVE_KEY);
    return isTaskDbName(saved) ? saved : FIRST_DB;
  } catch {
    return FIRST_DB;
  }
}

/** Make `name` the active gist's database; takes effect at the next reload. */
export function setActiveDbName(name: string): void {
  if (!isTaskDbName(name)) throw new Error(`Not a task database: ${name}`);
  try {
    if (name === FIRST_DB) localStorage.removeItem(ACTIVE_KEY);
    else localStorage.setItem(ACTIVE_KEY, name);
  } catch {
    // Storage unavailable: the first gist stays active.
  }
}

/**
 * A localStorage key for something kept per gist (the focused area). The
 * first gist keeps the key it had before 1.11; others add their gist id.
 */
export function perGistKey(base: string, dbName = activeDbName()): string {
  return dbName === FIRST_DB ? base : `${base}.${dbName.slice(FIRST_DB.length + 1)}`;
}
