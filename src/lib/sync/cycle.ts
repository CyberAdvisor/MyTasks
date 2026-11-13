/**
 * One sync with the gist (FR-19.4, FR-19.5): read it, decrypt it, merge it
 * with this device's list, write the gist's newer records here and push
 * this device's newer ones there. Also the steps setup and Settings share.
 */
import { SCHEMA_VERSION } from '../db/database';
import { upgradeList } from '../db/migrations';
import { nowIso } from '../model/ids';
import { DecryptError, MAX_FILE_CHARS, parseEnvelope, seal, unseal, type Envelope } from './crypto';
import type { DeviceConfig } from './device';
import { readGist, writeGist } from './github';
import { applyRemote, readLocal } from './local';
import { isPayload, mergePayloads, type Payload } from './payload';

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
  | 'unreachable';

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
  if (!isPayload(payload)) throw new SyncError('invalid');
  const file = JSON.stringify(await seal(config.key, config, JSON.stringify(payload), nowIso()));
  if (file.length > MAX_FILE_CHARS) throw new SyncError('toolarge');
  return file;
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

/** One full sync for a connected device. */
export async function syncOnce(config: DeviceConfig): Promise<void> {
  const env = envelopeOf(await readGist(config.token, config.gistId));
  // A different salt means the passphrase was changed on another device.
  if (env.kdf.salt !== config.salt || env.kdf.iterations !== config.iterations) throw new SyncError('passphrase');
  await mergeAndPush(config, await openPayload(config.key, env, 'malformed'));
}
