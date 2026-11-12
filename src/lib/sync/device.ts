/**
 * This device's sync settings (FR-19.2, FR-19.6): the token, the gist's id
 * and the encryption key, and the acknowledgment given at Setup. They live in their own small IndexedDB database,
 * never in the synced data, and are removed by Disconnect.
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
   * The risks and limitations the user acknowledged at Setup on this device.
   * Missing on devices connected before Setup asked (v0.6.0); they aren't asked again.
   */
  acknowledged?: Acknowledgment;
}

/** Setup's "I have read and understand the risks and limitations" checkbox, as ticked. */
export interface Acknowledgment {
  /** When the box was ticked. */
  at: string;
  /** The Limitations page's "Last updated" date at the time (LIMITATIONS_UPDATED). */
  limitationsUpdated: string;
}

type Row = DeviceConfig & { id: 'sync' };

class DeviceDB extends Dexie {
  config!: Table<Row, string>;

  constructor() {
    super('mytasks-device');
    this.version(1).stores({ config: 'id' });
  }
}

const deviceDb = new DeviceDB();

/** The saved sync settings, or null when this device is not connected. */
export async function loadConfig(): Promise<DeviceConfig | null> {
  const row = await deviceDb.config.get('sync');
  if (!row) return null;
  const { id: _, ...config } = row;
  return config;
}

export async function saveConfig(config: DeviceConfig): Promise<void> {
  await deviceDb.config.put({ ...config, id: 'sync' });
}

export async function clearConfig(): Promise<void> {
  await deviceDb.config.clear();
}
