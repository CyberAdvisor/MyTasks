/**
 * First-run setup (FR-19.1 to FR-19.3): check the token, find the user's My
 * Tasks gist, then either create one from this device's list or join an
 * existing one with its passphrase. Each step saves nothing until it has
 * fully succeeded.
 */
import { nowIso } from '../model/ids';
import { KDF_ITERATIONS, deriveKey, newSalt, parseEnvelope, type Envelope } from './crypto';
import { envelopeOf, mergeAndPush, openPayload, sealPayload } from './cycle';
import { saveConfig, type Acknowledgment, type DeviceConfig } from './device';
import { checkToken, createGist, findGists, readGist } from './github';
import { readLocal } from './local';

/** A My Tasks list found in the account. */
export interface FoundList {
  id: string;
  /** When the list was last written (from its envelope). */
  updatedAt: string;
}

/**
 * What the account holds: no My Tasks gist; one or more valid lists; or only
 * gists whose My Tasks file is not a valid list (left unchanged).
 */
export type Lookup = { kind: 'none' } | { kind: 'found'; lists: FoundList[] } | { kind: 'invalid' };

/** Check the token, then look for My Tasks gists. */
export async function lookUp(token: string): Promise<Lookup> {
  await checkToken(token);
  const refs = await findGists(token);
  const lists: FoundList[] = [];
  for (const ref of refs) {
    const content = await readGist(token, ref.id);
    const env: Envelope | null = content === null ? null : parseEnvelope(content);
    if (env) lists.push({ id: ref.id, updatedAt: env.updatedAt });
  }
  if (lists.length) return { kind: 'found', lists: lists.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)) };
  return refs.length ? { kind: 'invalid' } : { kind: 'none' };
}

/**
 * First device: a new secret gist holding this device's list, encrypted with
 * `passphrase`. `acknowledged` is the risks and limitations checkbox, as ticked.
 */
export async function createList(token: string, passphrase: string, acknowledged: Acknowledgment): Promise<DeviceConfig> {
  const salt = newSalt();
  const key = await deriveKey(passphrase, salt, KDF_ITERATIONS);
  const draft = { key, salt, iterations: KDF_ITERATIONS };
  const gistId = await createGist(token, await sealPayload(draft, await readLocal()));
  const config: DeviceConfig = { token, gistId, ...draft, lastSyncedAt: nowIso(), acknowledged };
  await saveConfig(config);
  return config;
}

/**
 * Another device: open an existing list with its passphrase and merge it
 * with anything already on this device (decided 2026-11-11). A wrong
 * passphrase fails with SyncError('wrong-passphrase') and changes nothing.
 * `acknowledged` is the risks and limitations checkbox, as ticked.
 */
export async function joinList(
  token: string,
  gistId: string,
  passphrase: string,
  acknowledged: Acknowledgment,
): Promise<DeviceConfig> {
  const env = envelopeOf(await readGist(token, gistId));
  const key = await deriveKey(passphrase, env.kdf.salt, env.kdf.iterations);
  const remote = await openPayload(key, env, 'wrong-passphrase');
  const config: DeviceConfig = {
    token,
    gistId,
    key,
    salt: env.kdf.salt,
    iterations: env.kdf.iterations,
    lastSyncedAt: nowIso(),
    acknowledged,
  };
  await mergeAndPush(config, remote);
  await saveConfig(config);
  return config;
}
