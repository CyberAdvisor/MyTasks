/**
 * This device's sync settings (FR-19.2, FR-19.6), one set per gist on the
 * device (FR-19.11): the token, the gist's id and the encryption key, and the
 * acknowledgment given at Setup. They live in their own small IndexedDB
 * database, never in the synced data, and are removed by Disconnect. Each
 * gist's last calendar.json read is kept with them.
 *
 * Every function here works on the active gist (gists/active.ts) unless it
 * says otherwise. An entry is keyed by its task database's name, which never
 * changes, rather than by the gist id.
 *
 * The key is a non-extractable CryptoKey: IndexedDB can store it, the app can
 * use it, but nothing can read the key itself back out. The passphrase is
 * never stored.
 */
import Dexie, { type Table } from 'dexie';
import { FIRST_DB, activeDbName, dbNameFor, isTaskDbName } from '../gists/active';
import { DEFAULT_SETTINGS, type GistLabel } from '../model/settings';

export interface DeviceConfig {
  /** GitHub personal access token (classic, `gist` scope). */
  token: string;
  gistId: string;
  /** Key derivation settings of the key below, as in the gist's envelope. */
  salt: string;
  iterations: number;
  key: CryptoKey;
  /** When this device last finished a sync. */
  lastSyncedAt: string | null;
  /**
   * The gist and this device as they were at the end of the last sync
   * (cycle.ts, `syncOnce`), so the next sync can skip what hasn't changed.
   * Missing before the first sync, on devices from v1.2.19 and earlier, and
   * after any action other than a sync (a full sync then follows).
   */
  lastSync?: SyncMark;
  /**
   * The risks and limitations the user acknowledged at Setup on this device.
   * Missing on devices connected before Setup asked (v0.6.0); they aren't asked again.
   */
  acknowledged?: Acknowledgment;
}

/** What `DeviceConfig.lastSync` records. */
export interface SyncMark {
  /** The IV of the gist's file: random for every write, so it identifies one version of the file. */
  iv: string;
  /** This device's records and synced settings (`stampOf`, payload.ts). */
  stamp: string;
  /** The gist file's length in characters, for Settings › Sync's file size (v1.4.3). Missing on older marks. */
  chars?: number;
  /**
   * When this sync read this device's records: every change made before it
   * is in the gist. The next sync's lost-change notice (FR-19.12) counts
   * only changes made after it. Missing on older marks.
   */
  readAt?: string;
  /** The daily notes file's mark (FR-24.1), like the tasks' own; missing while the gist has no notes. */
  notes?: NotesMark;
}

/** What a sync left of the gist's notes.json: its IV, this device's notes' fingerprint (`notesStamp`) and the file's length. */
export interface NotesMark {
  iv: string;
  stamp: string;
  chars: number;
}

/** Setup's "I have read and understand the risks and limitations" checkbox, as ticked. */
export interface Acknowledgment {
  /** When the box was ticked. */
  at: string;
  /** The Limitations page's "Last updated" date at the time (LIMITATIONS_UPDATED). */
  limitationsUpdated: string;
}

/** One gist on this device: its sync settings, its task database and its last calendar.json. */
export interface GistEntry extends DeviceConfig {
  /** The gist's task database (gists/active.ts). */
  db: string;
  /** The last calendar.json read from this gist (FR-21.2), still encrypted. */
  calendar?: string;
  /**
   * The gist's name and colour as last seen here (FR-19.15), so the switcher
   * and Settings can show gists that aren't open. The gist itself holds them
   * (the synced setting `gistLabel`); this copy follows it while the gist is
   * active (`saveLabel`). Missing until then: shown as Default.
   */
  label?: GistLabel;
}

/** A gist on this device, as the switcher and Settings › Sync list it. */
export interface GistSummary {
  db: string;
  gistId: string;
  label: GistLabel;
}

/** Version 1's rows: the one gist's settings and its calendar file. */
type V1Row = (DeviceConfig & { id: 'sync' }) | { id: 'calendar'; file: string };

class DeviceDB extends Dexie {
  gists!: Table<GistEntry, string>;

  constructor() {
    super('mytasks-device');
    this.version(1).stores({ config: 'id' });
    // Version 2 (v1.11.0): one entry per gist. The device's one gist becomes the
    // first gist's entry, on the database it already had.
    this.version(2)
      .stores({ config: null, gists: 'db, gistId' })
      .upgrade(async (tx) => {
        const rows = (await tx.table('config').toArray()) as V1Row[];
        const sync = rows.find((r) => r.id === 'sync');
        const calendar = rows.find((r) => r.id === 'calendar');
        if (!sync) return;
        const { id: _, ...config } = sync;
        const entry: GistEntry = { ...config, db: FIRST_DB };
        if (calendar) entry.calendar = calendar.file;
        await tx.table('gists').put(entry);
      });
  }
}

const deviceDb = new DeviceDB();

/** An entry's sync settings, without the device's own fields. */
function configOf(entry: GistEntry): DeviceConfig {
  const { db: _, calendar: __, label: ___, ...config } = entry;
  return config;
}

/** The active gist's sync settings, or null when it is not connected. */
export async function loadConfig(): Promise<DeviceConfig | null> {
  const entry = await deviceDb.gists.get(activeDbName());
  return entry ? configOf(entry) : null;
}

/** Save the active gist's sync settings, keeping its calendar file. */
export async function saveConfig(config: DeviceConfig): Promise<void> {
  const db = activeDbName();
  await deviceDb.transaction('rw', deviceDb.gists, async () => {
    const old = await deviceDb.gists.get(db);
    const entry: GistEntry = { ...config, db };
    if (old?.calendar !== undefined) entry.calendar = old.calendar;
    if (old?.label) entry.label = old.label;
    await deviceDb.gists.put(entry);
  });
}

/** Remove the active gist's sync settings and calendar file (Disconnect); other gists stay. */
export async function clearConfig(): Promise<void> {
  await deviceDb.gists.delete(activeDbName());
}

/** The active gist's saved calendar.json, encrypted, or null when there is none. */
export async function loadCalendarFile(): Promise<string | null> {
  return (await deviceDb.gists.get(activeDbName()))?.calendar ?? null;
}

/** Save the active gist's calendar.json as read from the gist, or remove it (null). Needs the gist connected. */
export async function saveCalendarFile(file: string | null): Promise<void> {
  await deviceDb.gists
    .where('db')
    .equals(activeDbName())
    .modify((entry) => {
      if (file === null) delete entry.calendar;
      else entry.calendar = file;
    });
}

/** Every gist on this device with its last-seen name and colour, in database-name order. */
export async function listGists(): Promise<GistSummary[]> {
  return (await deviceDb.gists.toArray()).map(({ db, gistId, label }) => ({ db, gistId, label: label ?? DEFAULT_SETTINGS.gistLabel }));
}

/** Keep the active gist's name and colour with its entry; true when they changed. Needs the gist connected. */
export async function saveLabel(label: GistLabel): Promise<boolean> {
  const { name, colour } = label;
  let changed = false;
  await deviceDb.gists
    .where('db')
    .equals(activeDbName())
    .modify((entry) => {
      if (entry.label?.name === name && entry.label?.colour === colour) return;
      entry.label = { name, colour };
      changed = true;
    });
  return changed;
}

/**
 * Add a gist to this device (FR-19.16, Add Gist…) on its own database, without
 * making it active. Refuses a gist already on the device.
 */
export async function addGist(db: string, config: DeviceConfig, label: GistLabel): Promise<void> {
  if (!isTaskDbName(db)) throw new Error(`Not a task database: ${db}`);
  await deviceDb.transaction('rw', deviceDb.gists, async () => {
    await refuseIfOnDevice(config.gistId);
    await deviceDb.gists.add({ ...config, db, label: { name: label.name, colour: label.colour } });
  });
}

/**
 * Refuse a gist that is already on this device, before anything is written
 * to it (Add Gist…). `addGist` checks again when it adds the entry.
 */
export async function refuseIfOnDevice(gistId: string): Promise<void> {
  if ((await deviceDb.gists.where('gistId').equals(gistId).count()) > 0) throw new Error('This gist is already on this device.');
}

/**
 * The database name for a gist being added: `mytasks-<gist id>`, or, when
 * another gist on the device already has that name, the first free one after
 * it (`mytasks-<gist id>x2`, …). A device set up again after its last gist was
 * disconnected, before 1.11.4, kept the old gist's name for the new one.
 */
export async function freeDbName(gistId: string): Promise<string> {
  const taken = new Set((await deviceDb.gists.toArray()).map((g) => g.db));
  const base = dbNameFor(gistId);
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base}x${n}`;
  return name;
}

/**
 * The other gists on this device that use `token` (not the active one): the
 * ones Change Token offers the new token to (FR-19.7).
 */
export async function otherGistsWithToken(token: string): Promise<{ db: string; gistId: string }[]> {
  const active = activeDbName();
  return (await deviceDb.gists.toArray()).filter((g) => g.db !== active && g.token === token).map(({ db, gistId }) => ({ db, gistId }));
}

/**
 * Give another gist on this device a new token, if it still has `oldToken`.
 * Its next sync is a full one, as after Change Token on the open gist.
 */
export async function replaceToken(db: string, oldToken: string, token: string): Promise<void> {
  await deviceDb.gists
    .where('db')
    .equals(db)
    .modify((entry) => {
      if (entry.token !== oldToken) return;
      entry.token = token;
      delete entry.lastSync;
    });
}
