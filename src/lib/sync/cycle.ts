/**
 * One sync with the gist (FR-19.4, FR-19.5): read it, decrypt it, merge it
 * with this device's list, write the gist's newer records here and push
 * this device's newer ones there. When the gist hasn't changed since this
 * device's last sync, only what's needed is done (NFR-7). Also the steps
 * setup and Settings share.
 */
import { SCHEMA_VERSION } from '../db/database';
import { upgradeList } from '../db/migrations';
import { nowIso } from '../model/ids';
import { DecryptError, MAX_FILE_CHARS, parseEnvelope, seal, unseal, type Envelope } from './crypto';
import type { DeviceConfig, SyncMark } from './device';
import { readGistFiles, writeGist } from './github';
import { applyRemote, dropOldTombstones, readLocal } from './local';
import { hasFuture, isAway, isOldTombstone, isPayload, mergePayloads, stampOf, type Payload } from './payload';

/**
 * Sync problems that are not GitHub errors:
 * - `malformed`: the gist's file is not a valid My Tasks list (never applied)
 * - `passphrase`: the gist is encrypted with another passphrase (it was changed on another device)
 * - `newer`: the gist was written by a newer version of the app
 * - `invalid`: this device's list failed the check before upload (never pushed)
 * - `notfound`: the gist has no My Tasks file (deleted on GitHub)
 * - `wrong-passphrase`: a passphrase typed in setup or Settings does not open the gist
 * - `toolarge`: this device's list, encrypted, is over MAX_FILE_CHARS (never pushed)
 * - `otheraccount`: a new token belongs to a GitHub account that doesn't own the gist
 * - `unreachable`: a new token can't reach this device's gist
 */
export type SyncProblem =
  | 'malformed'
  | 'passphrase'
  | 'newer'
  | 'invalid'
  | 'notfound'
  | 'wrong-passphrase'
  | 'toolarge'
  | 'otheraccount'
  | 'unreachable'
  /** Not synced for over AWAY_DAYS: waits to be replaced with the gist (payload.ts). */
  | 'away';

export class SyncError extends Error {
  constructor(readonly code: SyncProblem) {
    super(`Sync failed: ${code}`);
  }
}

/** The envelope in a gist file, or SyncError('malformed'). */
export function envelopeOf(content: string | null): Envelope {
  if (content === null) throw new SyncError('notfound');
  const env = parseEnvelope(content);
  if (!env) throw new SyncError('malformed');
  return env;
}

/**
 * Check a list read from the gist or a backup file (FR-19.5, FR-12.8),
 * before anything is applied: one from a newer version is refused
 * (`newer`), one from an older version is upgraded with the schema steps
 * (db/migrations.ts) and marked `upgradedFrom`, and the result must pass
 * every check (`malformed`).
 */
export function checkList(list: unknown): Payload {
  const schema = (list as { schema?: unknown } | null)?.schema;
  if (!Number.isInteger(schema) || (schema as number) < 1) throw new SyncError('malformed');
  if ((schema as number) > SCHEMA_VERSION) throw new SyncError('newer');
  const upgraded = upgradeList(list, SCHEMA_VERSION);
  if (!isPayload(upgraded)) throw new SyncError('malformed');
  return upgraded === list ? upgraded : { ...upgraded, upgradedFrom: schema as number };
}

/**
 * Decrypt and check an envelope. A key that does not open it gives
 * `wrongKey` (as a SyncError); then the list is checked by `checkList`.
 */
export async function openPayload(key: CryptoKey, env: Envelope, wrongKey: SyncProblem): Promise<Payload> {
  let plain: string;
  try {
    plain = await unseal(key, env);
  } catch (e) {
    if (e instanceof DecryptError) throw new SyncError(wrongKey);
    throw e;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(plain);
  } catch {
    throw new SyncError('malformed');
  }
  return checkList(payload);
}

/**
 * Encrypt a list for the gist. It is checked first, so a bug can never
 * upload a broken list, and the encrypted file is measured last: one larger
 * than any device would read back (MAX_FILE_CHARS) is never uploaded, so the
 * gist keeps its last good file. Every create and write goes through here.
 */
export async function sealPayload(config: Pick<DeviceConfig, 'key' | 'salt' | 'iterations'>, payload: Payload): Promise<string> {
  return (await sealList(config, payload)).file;
}

/** `sealPayload`, also giving the file's IV. */
async function sealList(config: Pick<DeviceConfig, 'key' | 'salt' | 'iterations'>, payload: Payload): Promise<{ file: string; iv: string }> {
  if (!isPayload(payload)) throw new SyncError('invalid');
  const env = await seal(config.key, config, JSON.stringify(payload), nowIso());
  const file = JSON.stringify(env);
  if (file.length > MAX_FILE_CHARS) throw new SyncError('toolarge');
  return { file, iv: env.cipher.iv };
}

/**
 * Merge `remote` into this device and push the result when this device had
 * something the gist lacked.
 */
export async function mergeAndPush(config: DeviceConfig, remote: Payload): Promise<void> {
  const { toApply, merged, pushNeeded } = mergePayloads(await readLocal(), remote);
  await applyRemote(toApply);
  if (pushNeeded) await writeGist(config.token, config.gistId, await sealPayload(config, merged));
}

/**
 * The envelope in this device's gist file. A different salt means the
 * passphrase was changed on another device: `passphrase`.
 */
function ownEnvelope(config: DeviceConfig, content: string | null): Envelope {
  const env = envelopeOf(content);
  if (env.kdf.salt !== config.salt || env.kdf.iterations !== config.iterations) throw new SyncError('passphrase');
  return env;
}

/** Upload `list` (fingerprint `stamp`) and give the mark for the gist it leaves. */
async function push(config: DeviceConfig, list: Payload, stamp: string): Promise<SyncMark> {
  const { file, iv } = await sealList(config, list);
  await writeGist(config.token, config.gistId, file);
  return { iv, stamp, chars: file.length };
}

/** This device's list, first deleting any tombstones past TOMBSTONE_DAYS (rare, so usually only a read). */
async function localWithoutOldTombstones(): Promise<Payload> {
  const local = await readLocal();
  const now = nowIso();
  if (!Object.values(local.tables).some((rows) => rows.some((r) => isOldTombstone(r, now)))) return local;
  await dropOldTombstones(now);
  return readLocal();
}

/**
 * One sync for a connected device. Resolves to the mark the next sync
 * starts from (DeviceConfig.lastSync).
 *
 * The gist is unchanged since the last sync (`config.lastSync`) when its
 * file has the IV the last sync left. Then this device already holds
 * everything in it: records are never removed (a deletion is a tombstone)
 * and the last sync wrote the gist's newer records here. So, without
 * decrypting, checking or merging it, nothing more is done when this
 * device's fingerprint is also unchanged, and otherwise this device's list,
 * which is what a merge would give, is uploaded. A list with a time later
 * than now takes the full sync, which corrects it. Anything else is a full
 * sync: decrypt, check, merge.
 *
 * The gist's calendar file (FR-21.2), read in the same request, is handed
 * to `onCalendar` before the tasks are; it never fails the sync.
 *
 * (GitHub's version tag, sent with If-None-Match, would also skip the
 * download, but WebKit fails the "not modified" answer as a CORS error;
 * conv. 2026-11-17-E.)
 */
export async function syncOnce(
  config: DeviceConfig,
  onCalendar: (file: string | null) => Promise<void> = async () => {},
): Promise<SyncMark> {
  // Away too long: records deleted elsewhere may have lost their tombstones,
  // so merging could bring them back. Wait for Replace With Gist.
  if (isAway(config.lastSyncedAt, nowIso())) throw new SyncError('away');
  const mark = config.lastSync;
  const { tasks: text, calendar } = await readGistFiles(config.token, config.gistId);
  if (text !== null) await onCalendar(calendar);
  const env = ownEnvelope(config, text);
  const chars = text?.length ?? 0;
  const local = await localWithoutOldTombstones();
  if (mark && env.cipher.iv === mark.iv) {
    if (!hasFuture(local, nowIso())) {
      const stamp = await stampOf(local);
      return stamp === mark.stamp ? { ...mark, chars } : push(config, local, stamp);
    }
  }
  const { toApply, merged, pushNeeded } = mergePayloads(local, await openPayload(config.key, env, 'malformed'));
  await applyRemote(toApply);
  const stamp = await stampOf(merged);
  return pushNeeded ? push(config, merged, stamp) : { iv: env.cipher.iv, stamp, chars };
}
