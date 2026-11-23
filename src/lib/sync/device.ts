/**
 * This device's sync settings (FR-19.2, FR-19.6): the token, the gist's id
 * and the encryption key, and the acknowledgment given at Setup. They live in their own small IndexedDB database,
 * never in the synced data, and are removed by Disconnect. The last
 * calendar.json read is kept here too.
 *
 * The key is a non-extractable CryptoKey: IndexedDB can store it, the app can
 * use it, but nothing can read the key itself back out. The passphrase is
 * never stored.
 */
import Dexie, { type Table } from 'dexie';

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
}

/** Setup's "I have read and understand the risks and limitations" checkbox, as ticked. */
export interface Acknowledgment {
  /** When the box was ticked. */
  at: string;
  /** The Limitations page's "Last updated" date at the time (LIMITATIONS_UPDATED). */
  limitationsUpdated: string;
}

type Row = DeviceConfig & { id: 'sync' };

/**
 * The last calendar.json read from the gist (FR-21.2), still encrypted, so
 * events show at launch and offline. Kept beside the sync settings, so
 * Disconnect removes it with them.
 */
type CalendarRow = { id: 'calendar'; file: string };

class DeviceDB extends Dexie {
  config!: Table<Row | CalendarRow, string>;

  constructor() {
    super('mytasks-device');
    this.version(1).stores({ config: 'id' });
  }
}

const deviceDb = new DeviceDB();

/** The saved sync settings, or null when this device is not connected. */
export async function loadConfig(): Promise<DeviceConfig | null> {
  const row = (await deviceDb.config.get('sync')) as Row | undefined;
  if (!row) return null;
  const { id: _, ...config } = row;
  return config;
}

export async function saveConfig(config: DeviceConfig): Promise<void> {
  await deviceDb.config.put({ ...config, id: 'sync' });
}

/** Remove the sync settings and the saved calendar file (Disconnect). */
export async function clearConfig(): Promise<void> {
  await deviceDb.config.clear();
}

/** The saved calendar.json, encrypted, or null when there is none. */
export async function loadCalendarFile(): Promise<string | null> {
  const row = (await deviceDb.config.get('calendar')) as CalendarRow | undefined;
  return row?.file ?? null;
}

/** Save calendar.json as read from the gist, or remove it (null). */
export async function saveCalendarFile(file: string | null): Promise<void> {
  if (file === null) await deviceDb.config.delete('calendar');
  else await deviceDb.config.put({ id: 'calendar', file });
}
