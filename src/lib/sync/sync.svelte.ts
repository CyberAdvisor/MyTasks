/**
 * Sync state and the actions behind the Sync settings (FR-19.5 to FR-19.8).
 *
 * - The app shows Setup until `config` is set (FR-19.1).
 * - Once connected it syncs at launch, when the app comes back to the
 *   foreground or back online, about 2 seconds after each local change, and
 *   on Sync Now, and every 15 minutes while the app is on screen, so new
 *   calendar events arrive (FR-21.2). Only one sync runs at a time; a
 *   request during one runs right after it.
 * - Failures never block or lose local changes. Problems the user must fix
 *   (token, passphrase, a missing or invalid gist, a newer app) stop the
 *   automatic syncs until Sync Now or the fix; a rate limit tries again at
 *   its reset time; while offline it tries again every 15 seconds, because
 *   the browser can report being back online before GitHub can be reached.
 *   Those tries are quiet: the status stays Offline until one gets through.
 * - Syncs and the Settings actions run one at a time, across every open
 *   window (lock.ts), and only while this device is still connected.
 *   Disconnect waits for a running one, then tells the other windows, which
 *   stop and reload to Setup.
 * - Restore from a backup (FR-12.8) runs the same way, under the lock.
 */
import { db } from '../db/database';
import { onLocalChange } from '../db/history';
import { nowIso } from '../model/ids';
import { KDF_ITERATIONS, deriveKey, newSalt } from './crypto';
import { SyncError, envelopeOf, mergeAndPush, openPayload, sealPayload, syncOnce, type SyncProblem } from './cycle';
import { clearConfig, listGists, loadConfig, otherGistsWithToken, replaceToken, saveConfig, type DeviceConfig, type SyncMark } from './device';
import { FIRST_DB, activeDbName, setActiveDbName } from '../gists/active';
import { saveAllNow } from '../state/onHide';
import { SYNCED_TABLES, idsOf, replacement, type Payload } from './payload';
import { GistError, checkToken, createGist, gistOwner, readGist, readGistFiles, writeGist, type GistErrorCode } from './github';
import { adoptRemote, readLocal, replaceLocal } from './local';
import { clearUndo } from '../db/history';
import { exclusive } from './lock';
import { onReturn } from '../pwa/onReturn';
import { receiveCalendar, showSavedCalendar } from '../calendar/calendar';
import { receiveTicks } from '../reminders/ticks';
import { adoptNotes, rewriteNotes } from '../notes/sync';
import { deleteNotesDb } from '../notes/store';
import type { LostChange } from './lost';

/** Delay between a local change and the sync that pushes it. */
const PUSH_DELAY_MS = 2000;

/** While offline, how long to wait before trying again. */
export const OFFLINE_RETRY_MS = 15_000;

/** After a rate limit's reset time, how long to wait before trying again. */
export const RATE_LIMIT_MARGIN_MS = 1000;

/** A rate limit that gives no reset time: how long to wait before trying again. */
export const RATE_LIMIT_FALLBACK_MS = 60_000;

/**
 * While the app is on screen, how often it syncs even with no change, so the
 * calendar helper's new events arrive: the helper's own default interval.
 */
export const REFRESH_MS = 15 * 60_000;

/** The channel the app's windows use to tell each other about Disconnect and switching gists. */
const CHANNEL_NAME = 'mytasks-sync';
const DISCONNECTED = 'disconnected';
const SWITCHED = 'switched';

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'offline' | 'error';
export type SyncCode = GistErrorCode | SyncProblem;

/** Problems that need the user before syncing can work again. */
const NEEDS_USER: SyncCode[] = ['token', 'scope', 'passphrase', 'newer', 'malformed', 'notfound', 'invalid', 'toolarge', 'away'];

/**
 * Ask the browser to keep this device's storage rather than clear it when
 * space runs low (`navigator.storage.persist()`). Best effort: the answer is
 * not shown, and it is no backup (FR-12.8 is).
 */
function keepStorage(): void {
  void navigator.storage?.persist?.().catch(() => undefined);
}

/** Exported for tests, which run two engines as two windows; the app uses `sync`. */
export class SyncEngine {
  /** False until the device's sync settings have been read. */
  ready = $state(false);
  /** This device's sync settings; null shows Setup. Raw: it holds a CryptoKey. */
  config = $state.raw<DeviceConfig | null>(null);
  status = $state<SyncStatus>('idle');
  /** What went wrong, when `status` is `error`. */
  problem = $state<SyncCode | null>(null);
  /** For a rate limit: when GitHub accepts requests again. */
  retryAt = $state<Date | null>(null);
  /** This device's changes replaced by later ones from another device, until the notice is closed (FR-19.12). */
  lost = $state.raw<LostChange[]>([]);

  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | null = null;
  private again = false;
  /** The start-up (`start`): settings read, listeners set, the launch sync begun. */
  private starting: Promise<void> | null = null;
  /** Set by Disconnect, here or in another window: nothing more may sync. */
  private stopped = false;
  private channel: BroadcastChannel | null = null;

  /** Read this device's settings, listen for sync triggers, and sync once. Runs once. */
  start(): Promise<void> {
    this.starting ??= this.begin();
    return this.starting;
  }

  private async begin(): Promise<void> {
    this.config = await loadConfig();
    if (!this.config && (await this.repairActive())) return;
    this.ready = true;
    if (this.config) {
      keepStorage();
      await showSavedCalendar(this.config);
    }
    // Another window disconnected a gist or switched gists: stop, and reload
    // on the gist now active (Setup, after the last one is disconnected).
    this.channel = new BroadcastChannel(CHANNEL_NAME);
    this.channel.onmessage = (e: MessageEvent) => {
      if (e.data !== DISCONNECTED && e.data !== SWITCHED) return;
      this.stop();
      location.reload();
    };
    onLocalChange(() => this.schedule());
    onReturn(() => this.auto());
    // Leaving the app: push a waiting change now rather than next launch.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && this.timer !== undefined) this.auto();
    });
    window.addEventListener('online', () => this.auto());
    setInterval(() => {
      if (document.visibilityState === 'visible') this.auto();
    }, REFRESH_MS);
    this.auto();
  }

  /**
   * The active gist has no settings but the device has other gists (its
   * database name was lost from localStorage, or it was disconnected in a
   * window that closed before switching): make the first of them active and
   * reload on it. True when it did.
   */
  private async repairActive(): Promise<boolean> {
    const [first] = await listGists();
    if (!first || first.db === activeDbName()) return false;
    setActiveDbName(first.db);
    location.reload();
    return true;
  }

  /** Setup finished: use these settings from now on. */
  connected(config: DeviceConfig): void {
    keepStorage();
    this.stopped = false;
    this.config = config;
    this.status = 'synced';
    this.problem = null;
  }

  /** Stop syncing: no new syncs, and no waiting one. */
  private stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  /**
   * Sync after `delay`: about 2 seconds after the last local change, the next
   * try while offline, or the end of a rate limit.
   */
  private schedule(delay = PUSH_DELAY_MS): void {
    if (!this.config || this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.auto(), delay);
  }

  /**
   * An automatic sync, skipped while a problem needs the user or a rate limit
   * lasts. A waiting retry is kept until it can run.
   */
  private auto(): void {
    if (this.held()) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    void this.syncNow(this.status === 'offline');
  }

  /** True while a problem needs the user or a rate limit lasts: automatic syncs wait. */
  private held(): boolean {
    if (this.status === 'error' && this.problem && NEEDS_USER.includes(this.problem)) return true;
    return this.retryAt !== null && Date.now() < this.retryAt.getTime();
  }

  /**
   * Resolves once this device has synced, or tried to: it joins the sync
   * already running, or starts an automatic one. Resolves at once when the
   * device isn't connected or automatic syncs are held, and never rejects.
   * The return check (FR-3.5) waits for it, so its rules act on the other
   * devices' changes rather than on this device's older copy: a change it
   * made to an old copy would be newer, and would win the merge.
   */
  async settled(): Promise<void> {
    // At launch, wait for the settings to be read and the launch sync to begin.
    await this.starting?.catch(() => undefined);
    if (!this.running) this.auto();
    await this.running?.catch(() => undefined);
  }

  /**
   * Run `action` with this device's settings once no other sync or Settings
   * action is running, in any window. The settings are read from storage
   * inside the lock, and become this window's copy, so an action never uses
   * settings another window has since changed (a new passphrase or token).
   * Does nothing, and resolves undefined, when the device was disconnected
   * meanwhile, here or in another window.
   */
  private exclusive<T>(action: (config: DeviceConfig) => Promise<T>): Promise<T | undefined> {
    return exclusive(async () => {
      if (this.stopped || !this.config) return undefined;
      const saved = await loadConfig();
      if (!saved) return undefined;
      this.config = saved;
      return action(saved);
    });
  }

  /**
   * Sync now (also the Sync Now button). Resolves when this request has been
   * served. A `quiet` sync leaves the status as it is until it finishes.
   */
  syncNow(quiet = false): Promise<void> {
    if (!this.config || this.stopped) return Promise.resolve();
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        // The settings are read when the sync starts, so a sync queued behind
        // Change Passphrase, in this window or another, uses the new key.
        await this.exclusive((config) =>
          this.attempt(
            () =>
              syncOnce(
                config,
                (file) => receiveCalendar(config, file),
                (lost) => this.noteLost(lost),
                (file) => receiveTicks(config, file),
              ),
            quiet,
          ),
        );
      } while (this.again && this.config && !this.stopped);
    })().finally(() => (this.running = null));
    return this.running;
  }

  /** Add lost changes to those the notice shows, each task or project listed once. */
  private noteLost(lost: LostChange[]): void {
    const kept = this.lost.filter((l) => !lost.some((n) => n.kind === l.kind && n.id === l.id));
    this.lost = [...kept, ...lost];
  }

  /** Close the lost-change notice. */
  dismissLost(): void {
    this.lost = [];
  }

  /** Run one sync, recording success or failure in the status, and the mark it leaves. */
  private async attempt(action: () => Promise<SyncMark>, quiet = false): Promise<void> {
    if (!quiet) this.status = 'syncing';
    try {
      const lastSync = await action();
      await this.saved({ ...this.config!, lastSyncedAt: nowIso(), lastSync });
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
    // A rate limit: try again just after it ends.
    if (this.problem === 'ratelimit') {
      const wait = this.retryAt ? this.retryAt.getTime() - Date.now() + RATE_LIMIT_MARGIN_MS : RATE_LIMIT_FALLBACK_MS;
      this.schedule(Math.max(wait, 0));
    }
  }

  // -------------------------------------------------------------------------
  // Settings actions. Each throws GistError or SyncError for the dialog to
  // show, and runs only when no sync or other action is running (exclusive).
  // -------------------------------------------------------------------------

  /**
   * Use a new token (FR-19.7). It must work, reach this device's gist, and
   * belong to the GitHub account that owns the gist, so the tasks never move
   * to another account. (A deleted gist can't be checked: the user
   * disconnects this device and sets it up again.) Every other gist on this
   * device that used the same old token gets the new one too, once the same
   * check passes for it; one that fails it, or can't be checked (offline),
   * keeps its own token.
   */
  async changeToken(token: string): Promise<void> {
    const changed = await this.exclusive(async (config) => {
      const account = await checkToken(token);
      const owner = await gistOwner(token, config.gistId);
      if (owner === null) throw new SyncError('unreachable');
      // GitHub account names ignore case.
      if (owner.toLowerCase() !== account.toLowerCase()) throw new SyncError('otheraccount');
      await saveConfig({ ...config, token, lastSync: undefined });
      this.config = { ...config, token, lastSync: undefined };
      for (const other of await otherGistsWithToken(config.token)) {
        const ownerOfOther = await gistOwner(token, other.gistId).catch(() => null);
        if (ownerOfOther?.toLowerCase() === account.toLowerCase()) await replaceToken(other.db, config.token, token);
      }
      this.problem = null;
      this.status = 'idle';
      return true;
    });
    if (changed) await this.syncNow();
  }

  /**
   * Change the passphrase (FR-19.6): check the current one opens the gist,
   * sync, then encrypt the gist again under a new salt and key. Other devices
   * then ask for the new passphrase.
   */
  async changePassphrase(current: string, next: string): Promise<void> {
    await this.exclusive(async (config) => {
      const env = envelopeOf(await readGist(config.token, config.gistId));
      if (env.kdf.salt !== config.salt) throw new SyncError('passphrase');
      await openPayload(await deriveKey(current, config.salt, config.iterations), env, 'wrong-passphrase');
      await syncOnce(config);
      const salt = newSalt();
      const updated: DeviceConfig = { ...config, salt, iterations: KDF_ITERATIONS, key: await deriveKey(next, salt) };
      await writeGist(config.token, config.gistId, await sealPayload(updated, await readLocal()));
      // The daily notes too, so other devices read them with the new passphrase (FR-24.1).
      await rewriteNotes(updated);
      await this.saved({ ...updated, lastSyncedAt: nowIso(), lastSync: undefined });
    });
  }

  /** Enter the passphrase set on another device (FR-19.6), then sync. */
  async enterPassphrase(passphrase: string): Promise<void> {
    await this.exclusive(async (config) => {
      const env = envelopeOf(await readGist(config.token, config.gistId));
      const key = await deriveKey(passphrase, env.kdf.salt, env.kdf.iterations);
      const remote = await openPayload(key, env, 'wrong-passphrase');
      const updated: DeviceConfig = { ...config, key, salt: env.kdf.salt, iterations: env.kdf.iterations };
      await mergeAndPush(updated, remote);
      await this.saved({ ...updated, lastSyncedAt: nowIso(), lastSync: undefined });
    });
  }

  /**
   * A device away longer than AWAY_DAYS (`away`): make its list exactly the
   * gist's, then sync as usual. Its unsynced changes are lost, which the
   * Settings message says first, offering Save Backup.
   */
  async replaceWithGist(): Promise<void> {
    await this.exclusive(async (config) => {
      const files = await readGistFiles(config.token, config.gistId);
      await adoptRemote(await openPayload(config.key, envelopeOf(files.tasks), 'malformed'));
      // Notes deleted elsewhere may have lost their tombstones too (FR-24.1).
      await adoptNotes(config, files.notes);
      clearUndo();
      await this.saved({ ...config, lastSyncedAt: nowIso(), lastSync: undefined });
    });
  }

  /** The gist was deleted on GitHub: make a new one from this device's tasks (FR-19.8). */
  async recreateGist(): Promise<void> {
    await this.exclusive(async (config) => {
      const gistId = await createGist(config.token, await sealPayload(config, await readLocal()));
      await this.saved({ ...config, gistId, lastSyncedAt: nowIso(), lastSync: undefined });
    });
  }

  /**
   * Replace everything with a backup (FR-12.8), under the lock, so no sync
   * in any window runs during it. Connected-device policy: the gist is read
   * first, and every record it or this device holds that the backup doesn't
   * becomes a tombstone stamped now, while the backup's records are stamped
   * now (payload.ts, `replacement`). The gist and every device then match
   * the backup at their next sync; another device's edits that haven't
   * synced lose to the restore, but a task it created and hasn't synced
   * yet is kept.
   *
   * Every check finishes before anything is replaced: the gist must open
   * (otherwise its error is thrown and nothing changes), and the result
   * must pass the upload checks and fit the 5 MB limit. Then this device
   * is replaced in one transaction, and the gist is written. If only that
   * last write fails (offline, say), this device is already restored and
   * the next sync pushes it: 'pending'. Not an undo step.
   *
   * Resolves 'synced' or 'pending', or undefined when the device was
   * disconnected meanwhile.
   */
  async restore(backup: Payload): Promise<'synced' | 'pending' | undefined> {
    return this.exclusive(async (config) => {
      const env = envelopeOf(await readGist(config.token, config.gistId));
      if (env.kdf.salt !== config.salt || env.kdf.iterations !== config.iterations) throw new SyncError('passphrase');
      const remote = await openPayload(config.key, env, 'malformed');
      const gistIds = idsOf(remote);
      const now = nowIso();
      // Check the result before replacing anything.
      const known = idsOf(await readLocal());
      for (const t of SYNCED_TABLES) known[t].push(...gistIds[t]);
      await sealPayload(config, replacement(backup, known, now));
      await replaceLocal(backup, gistIds, now);
      clearUndo();
      try {
        await writeGist(config.token, config.gistId, await sealPayload(config, await readLocal()));
      } catch (e) {
        // The next sync is a full one.
        await saveConfig({ ...config, lastSync: undefined });
        this.config = { ...config, lastSync: undefined };
        this.failed(e);
        return 'pending' as const;
      }
      await this.saved({ ...config, lastSyncedAt: nowIso(), lastSync: undefined });
      return 'synced' as const;
    });
  }

  /**
   * Disconnect this device (FR-19.7): stop syncing, wait for a sync or action
   * running in any window, then forget the token, gist and key and delete
   * this device's copy of the tasks. The tasks stay in the gist. Other open
   * windows are told, and reload to Setup. The caller reloads this one.
   */
  async disconnect(): Promise<void> {
    this.stop();
    await exclusive(async () => {
      await clearConfig();
      await db.delete();
      await deleteNotesDb(activeDbName());
      // Another gist on this device becomes active. With none left, Setup
      // shows, on the first database name, so the next gist set up here never
      // keeps the name of the gist just disconnected.
      const [next] = await listGists();
      setActiveDbName(next ? next.db : FIRST_DB);
    });
    this.config = null;
    this.channel?.postMessage(DISCONNECTED);
  }

  /**
   * Switch to another gist on this device (FR-19.11): save any edit in
   * progress, stop syncing, wait for a sync or action running in any window,
   * then make `dbName` active. Other open windows are told, and reload on it.
   * The caller reloads this one. Refuses a gist that isn't on this device.
   */
  async switchTo(dbName: string): Promise<void> {
    if (!(await listGists()).some((g) => g.db === dbName)) throw new Error('That gist isn’t on this device.');
    if (dbName === activeDbName()) return;
    saveAllNow();
    // The saves run in their own transactions; one over every table starts
    // only once they have finished.
    await new Promise((r) => setTimeout(r, 0));
    await db.transaction('rw', db.tables, async () => undefined);
    this.stop();
    await exclusive(async () => setActiveDbName(dbName));
    this.channel?.postMessage(SWITCHED);
  }
}

export const sync = new SyncEngine();
