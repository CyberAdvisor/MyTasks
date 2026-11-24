/**
 * First-run setup (FR-19.1 to FR-19.3): check the token, find the user's My
 * Tasks gist, then either create one from this device's list or join an
 * existing one with its passphrase. Each step saves nothing until it has
 * fully succeeded.
 */
import { nowIso } from '../model/ids';
import { KDF_ITERATIONS, deriveKey, newSalt, parseEnvelope, type Envelope } from './crypto';
import { envelopeOf, mergeAndPush, openPayload, sealPayload } from './cycle';
import { addGist, freeDbName, refuseIfOnDevice, saveConfig, type Acknowledgment, type DeviceConfig } from './device';
import { checkToken, createGist, findGists, readGist, writeGist } from './github';
import { readLocal } from './local';
import type { Payload } from './payload';
import { SCHEMA_VERSION } from '../db/database';
import { cleanGistLabel, type GistLabel } from '../model/settings';
import { ENTITY_NAMES, type BaseRecord, type EntityName } from '../model/types';

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
type Lookup = { kind: 'none' } | { kind: 'found'; lists: FoundList[] } | { kind: 'invalid' };

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

// ---------------------------------------------------------------------------
// Add Gist… (FR-19.16): another gist on a device that already has one. Its
// tasks go into a database of their own, filled by its first sync after the
// switch, so nothing here reads or changes the active gist's tasks.
// ---------------------------------------------------------------------------

/** The My Tasks gists in the account that aren't on this device yet (`onDevice`, their ids). */
export async function addableGists(token: string, onDevice: string[]): Promise<FoundList[]> {
  const found = await lookUp(token);
  return found.kind === 'found' ? found.lists.filter((l) => !onDevice.includes(l.id)) : [];
}

/** Open an existing gist with its passphrase; fails with SyncError('wrong-passphrase'). */
export async function unlockGist(token: string, gistId: string, passphrase: string): Promise<UnlockedGist> {
  const env = envelopeOf(await readGist(token, gistId));
  const key = await deriveKey(passphrase, env.kdf.salt, env.kdf.iterations);
  const list = await openPayload(key, env, 'wrong-passphrase');
  const label = cleanGistLabel(list.settings.find((s) => s.key === 'gistLabel')?.value);
  return { gistId, key, salt: env.kdf.salt, iterations: env.kdf.iterations, list, label };
}

/** An existing gist, opened (`unlockGist`): its key, its list and the name and colour it has. */
export interface UnlockedGist {
  gistId: string;
  key: CryptoKey;
  salt: string;
  iterations: number;
  list: Payload;
  label: GistLabel;
}

/**
 * Add an opened gist to this device under `label`, written into the gist
 * first when it differs from the one the gist has. Gives its database name.
 * A gist already on the device is refused before anything is written to it.
 * The name is written into the gist as it is now, read again just before,
 * not the copy read at the passphrase step, so a change another device
 * synced meanwhile is kept. A passphrase changed meanwhile fails it
 * (`wrong-passphrase`).
 */
export async function addExistingGist(
  token: string,
  gist: UnlockedGist,
  label: GistLabel,
  acknowledged: Acknowledgment | undefined,
): Promise<string> {
  await refuseIfOnDevice(gist.gistId);
  const draft = { key: gist.key, salt: gist.salt, iterations: gist.iterations };
  if (label.name !== gist.label.name || label.colour !== gist.label.colour) {
    const now = await openPayload(gist.key, envelopeOf(await readGist(token, gist.gistId)), 'wrong-passphrase');
    const settings = [...now.settings.filter((s) => s.key !== 'gistLabel'), labelSetting(label)];
    await writeGist(token, gist.gistId, await sealPayload(draft, { ...now, settings }));
  }
  return addEntry(token, gist.gistId, draft, label, acknowledged);
}

/** A new secret gist named `label`, with no tasks, encrypted with `passphrase`. Gives its database name. */
export async function addNewGist(
  token: string,
  passphrase: string,
  label: GistLabel,
  acknowledged: Acknowledgment | undefined,
): Promise<string> {
  const salt = newSalt();
  const draft = { key: await deriveKey(passphrase, salt, KDF_ITERATIONS), salt, iterations: KDF_ITERATIONS };
  const tables = {} as Record<EntityName, BaseRecord[]>;
  for (const t of ENTITY_NAMES) tables[t] = [];
  const list: Payload = { app: 'mytasks', schema: SCHEMA_VERSION, tables, settings: [labelSetting(label)] };
  const gistId = await createGist(token, await sealPayload(draft, list));
  return addEntry(token, gistId, draft, label, acknowledged);
}

/** The synced setting holding a gist's name and colour. */
function labelSetting(label: GistLabel) {
  return { key: 'gistLabel', value: { name: label.name, colour: label.colour }, modifiedAt: nowIso() };
}

/**
 * The gist's entry on this device. It has not synced here yet, so its first
 * sync is a full one and fills its database.
 */
async function addEntry(
  token: string,
  gistId: string,
  draft: Pick<DeviceConfig, 'key' | 'salt' | 'iterations'>,
  label: GistLabel,
  acknowledged: Acknowledgment | undefined,
): Promise<string> {
  const db = await freeDbName(gistId);
  const config: DeviceConfig = { token, gistId, ...draft, lastSyncedAt: nowIso() };
  if (acknowledged) config.acknowledged = acknowledged;
  await addGist(db, config, label);
  return db;
}
