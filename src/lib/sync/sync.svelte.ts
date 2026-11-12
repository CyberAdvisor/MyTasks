/**
 * Sync state and the actions behind the Sync settings (FR-19.5 to FR-19.8).
 *
 * - The app shows Setup until `config` is set (FR-19.1).
 * - Once connected it syncs at launch, when the app comes back to the
 *   foreground or back online, about 2 seconds after each local change, and
 *   on Sync Now. Only one sync runs at a time; a request during one runs
 *   right after it.
 * - Failures never block or lose local changes. Problems the user must fix
 *   (token, passphrase, a missing or invalid gist, a newer app) stop the
 *   automatic syncs until Sync Now or the fix; a rate limit waits for its
 *   reset time; while offline it tries again every 15 seconds, because the
 *   browser can report being back online before GitHub can be reached.
 *   Those tries are quiet: the status stays Offline until one gets through.
 */
import { db } from '../db/database';
import { onLocalChange } from '../db/history';
import { nowIso } from '../model/ids';
import { KDF_ITERATIONS, deriveKey, newSalt } from './crypto';
import { SyncError, envelopeOf, mergeAndPush, openPayload, sealPayload, syncOnce, type SyncProblem } from './cycle';
import { clearConfig, loadConfig, saveConfig, type DeviceConfig } from './device';
import { GistError, checkToken, createGist, readGist, writeGist, type GistErrorCode } from './github';
import { readLocal } from './local';

/** Delay between a local change and the sync that pushes it. */
export const PUSH_DELAY_MS = 2000;

/** While offline, how long to wait before trying again. */
export const OFFLINE_RETRY_MS = 15_000;

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'offline' | 'error';
export type SyncCode = GistErrorCode | SyncProblem;

/** Problems that need the user before syncing can work again. */
const NEEDS_USER: SyncCode[] = ['token', 'scope', 'passphrase', 'newer', 'malformed', 'notfound', 'invalid'];

class SyncEngine {
  /** False until the device's sync settings have been read. */
  ready = $state(false);
  /** This device's sync settings; null shows Setup. Raw: it holds a CryptoKey. */
  config = $state.raw<DeviceConfig | null>(null);
  status = $state<SyncStatus>('idle');
  /** What went wrong, when `status` is `error`. */
  problem = $state<SyncCode | null>(null);
  /** For a rate limit: when GitHub accepts requests again. */
  retryAt = $state<Date | null>(null);

  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | null = null;
  private again = false;
  private started = false;

  /** Read this device's settings, listen for sync triggers, and sync once. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.config = await loadConfig();
    this.ready = true;
    onLocalChange(() => this.schedule());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.auto();
      // Leaving the app: push a waiting change now rather than next launch.
      else if (this.timer !== undefined) this.auto();
    });
    window.addEventListener('online', () => this.auto());
    this.auto();
  }

  /** Setup finished: use these settings from now on. */
  connected(config: DeviceConfig): void {
    this.config = config;
    this.status = 'synced';
    this.problem = null;
  }

  /** Sync after `delay`: about 2 seconds after the last local change, or the next try while offline. */
  private schedule(delay = PUSH_DELAY_MS): void {
    if (!this.config) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.auto(), delay);
  }

  /** An automatic sync, skipped while a problem needs the user or a rate limit lasts. */
  private auto(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.status === 'error' && this.problem && NEEDS_USER.includes(this.problem)) return;
    if (this.retryAt && Date.now() < this.retryAt.getTime()) return;
    void this.syncNow(this.status === 'offline');
  }

  /**
   * Sync now (also the Sync Now button). Resolves when this request has been
   * served. A `quiet` sync leaves the status as it is until it finishes.
   */
  syncNow(quiet = false): Promise<void> {
    if (!this.config) return Promise.resolve();
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        await this.attempt(() => syncOnce(this.config!), quiet);
      } while (this.again && this.config);
    })().finally(() => (this.running = null));
    return this.running;
  }

  /** Run one sync action, recording success or failure in the status. */
  private async attempt(action: () => Promise<void>, quiet = false): Promise<void> {
    if (!quiet) this.status = 'syncing';
    try {
      await action();
      await this.saved({ ...this.config!, lastSyncedAt: nowIso() });
    } catch (e) {
      this.failed(e);
    }
  }

  /** Store new settings and mark the device synced. */
  private async saved(config: DeviceConfig): Promise<void> {
    await saveConfig(config);
    this.config = config;
    this.status = 'synced';
    this.problem = null;
    this.retryAt = null;
  }

  private failed(e: unknown): void {
    if (e instanceof GistError && e.code === 'offline') {
      this.status = 'offline';
      this.problem = null;
      this.schedule(OFFLINE_RETRY_MS);
      return;
    }
    this.status = 'error';
    this.retryAt = e instanceof GistError ? e.retryAt : null;
    if (e instanceof GistError || e instanceof SyncError) this.problem = e.code;
    else {
      console.error('Sync failed', e);
      this.problem = 'server';
    }
  }

  // -------------------------------------------------------------------------
  // Settings actions. Each throws GistError or SyncError for the dialog to show.
  // -------------------------------------------------------------------------

  /** Use a new token (FR-19.7). It must work and reach this device's gist. */
  async changeToken(token: string): Promise<void> {
    await checkToken(token);
    try {
      await readGist(token, this.config!.gistId);
    } catch (e) {
      // A deleted gist is reported by the next sync, with Recreate Gist.
      if (!(e instanceof GistError && e.code === 'notfound')) throw e;
    }
    await saveConfig({ ...this.config!, token });
    this.config = { ...this.config!, token };
    this.problem = null;
    this.status = 'idle';
    await this.syncNow();
  }

  /**
   * Change the passphrase (FR-19.6): check the current one opens the gist,
   * sync, then encrypt the gist again under a new salt and key. Other devices
   * then ask for the new passphrase.
   */
  async changePassphrase(current: string, next: string): Promise<void> {
    const config = this.config!;
    const env = envelopeOf(await readGist(config.token, config.gistId));
    if (env.kdf.salt !== config.salt) throw new SyncError('passphrase');
    await openPayload(await deriveKey(current, config.salt, config.iterations), env, 'wrong-passphrase');
    await syncOnce(config);
    const salt = newSalt();
    const updated: DeviceConfig = { ...config, salt, iterations: KDF_ITERATIONS, key: await deriveKey(next, salt) };
    await writeGist(config.token, config.gistId, await sealPayload(updated, await readLocal()));
    await this.saved({ ...updated, lastSyncedAt: nowIso() });
  }

  /** Enter the passphrase set on another device (FR-19.6), then sync. */
  async enterPassphrase(passphrase: string): Promise<void> {
    const config = this.config!;
    const env = envelopeOf(await readGist(config.token, config.gistId));
    const key = await deriveKey(passphrase, env.kdf.salt, env.kdf.iterations);
    const remote = await openPayload(key, env, 'wrong-passphrase');
    const updated: DeviceConfig = { ...config, key, salt: env.kdf.salt, iterations: env.kdf.iterations };
    await mergeAndPush(updated, remote);
    await this.saved({ ...updated, lastSyncedAt: nowIso() });
  }

  /** The gist was deleted on GitHub: make a new one from this device's list (FR-19.8). */
  async recreateGist(): Promise<void> {
    const config = this.config!;
    const gistId = await createGist(config.token, await sealPayload(config, await readLocal()));
    await this.saved({ ...config, gistId, lastSyncedAt: nowIso() });
  }

  /**
   * Disconnect this device (FR-19.7): forget the token, gist and key, and
   * delete this device's copy of the list. The list stays in the gist. The
   * caller reloads the app, which then shows Setup.
   */
  async disconnect(): Promise<void> {
    clearTimeout(this.timer);
    await clearConfig();
    await db.delete();
    this.config = null;
  }
}

export const sync = new SyncEngine();
