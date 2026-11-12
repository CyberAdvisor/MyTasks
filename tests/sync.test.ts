/**
 * Tests for Milestone 5e: GitHub Gist as the data store, with encryption
 * (FR-19). GitHub is faked in memory (tests/fakeGitHub.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/lib/db/database';
import * as repo from '../src/lib/db/repo';
import { clearUndo, onLocalChange, undo } from '../src/lib/db/history';
import { DecryptError, deriveKey, newSalt, parseEnvelope, seal, unseal } from '../src/lib/sync/crypto';
import { SyncError, syncOnce } from '../src/lib/sync/cycle';
import { clearConfig, loadConfig, type DeviceConfig } from '../src/lib/sync/device';
import { GistError, checkToken, readGist } from '../src/lib/sync/github';
import { applyRemote, readLocal } from '../src/lib/sync/local';
import { mergePayloads, type Payload } from '../src/lib/sync/payload';
import { createList, joinList, lookUp } from '../src/lib/sync/setup';
import { clock, syncMessage, syncedLine } from '../src/lib/sync/messages';
import { OFFLINE_RETRY_MS, sync } from '../src/lib/sync/sync.svelte';
import { FakeGitHub } from './fakeGitHub';
import { todo } from './helpers';

let gh: FakeGitHub;

beforeEach(async () => {
  await db.delete();
  await db.open();
  await clearConfig();
  clearUndo();
  gh = new FakeGitHub();
  vi.stubGlobal('fetch', gh.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Start over as a new device: empty list, not connected. */
async function newDevice(): Promise<void> {
  await db.delete();
  await db.open();
  await clearConfig();
}

/** Setup's risks and limitations checkbox, ticked. */
const ACK = { at: '2026-11-12T20:00:00.000Z', limitationsUpdated: '2026-11-12' };

const titles = async () => (await db.todos.toArray()).filter((t) => !t.deletedAt).map((t) => t.title).sort();

/** An empty payload with some records. */
function payload(over: Partial<Payload['tables']> = {}, settings: Payload['settings'] = []): Payload {
  const tables = {
    areas: [], projects: [], headings: [], todos: [], checklistItems: [], tags: [], contexts: [], savedSearches: [],
    ...over,
  } as Payload['tables'];
  return { app: 'mytasks', schema: 3, tables, settings };
}

describe('encryption (FR-19.6)', () => {
  it('round-trips, and a wrong passphrase is detected', async () => {
    const salt = newSalt();
    const key = await deriveKey('correct horse', salt);
    const env = await seal(key, { salt, iterations: 600_000 }, 'secret list', '2026-11-11T00:00:00Z');
    expect(JSON.stringify(env)).not.toContain('secret');
    expect(await unseal(key, env)).toBe('secret list');
    await expect(unseal(await deriveKey('wrong', salt), env)).rejects.toBeInstanceOf(DecryptError);
  });

  it('accepts only its own envelope format', () => {
    expect(parseEnvelope('not json')).toBeNull();
    expect(parseEnvelope('{"app":"myshows"}')).toBeNull();
  });
});

describe('merging (FR-19.4)', () => {
  it('keeps the later edit of each record, and pushes only when this device has something new', () => {
    const a = todo({ id: 'a', title: 'local newer', modifiedAt: '2026-11-11T10:00:02Z' });
    const aOld = { ...a, title: 'remote older', modifiedAt: '2026-11-11T10:00:01Z' };
    const b = todo({ id: 'b', title: 'remote newer', modifiedAt: '2026-11-11T10:00:05Z' });
    const bOld = { ...b, title: 'local older', modifiedAt: '2026-11-11T10:00:00Z' };
    const c = todo({ id: 'c', title: 'only remote', modifiedAt: '2026-11-11T09:00:00Z' });
    const r = mergePayloads(payload({ todos: [a, bOld] }), payload({ todos: [aOld, b, c] }));
    expect(r.toApply.tables.todos?.map((t) => t.id).sort()).toEqual(['b', 'c']);
    expect(r.merged.tables.todos.map((t) => (t as typeof a).title).sort()).toEqual(['local newer', 'only remote', 'remote newer']);
    expect(r.pushNeeded).toBe(true);
    const same = mergePayloads(payload({ todos: [b] }), payload({ todos: [b] }));
    expect(same.pushNeeded).toBe(false);
    expect(same.toApply.tables.todos).toBeUndefined();
  });

  it('carries deletions as tombstones, and merges settings key by key', () => {
    const t = todo({ id: 't', modifiedAt: '2026-11-11T10:00:00Z' });
    const gone = { ...t, deletedAt: '2026-11-11T11:00:00Z', modifiedAt: '2026-11-11T11:00:00Z' };
    const r = mergePayloads(
      payload({ todos: [t] }, [{ key: 'autoP1', value: false, modifiedAt: '2026-11-11T12:00:00Z' }]),
      payload({ todos: [gone] }, [{ key: 'autoP1', value: true, modifiedAt: '2026-11-11T09:00:00Z' }]),
    );
    expect(r.toApply.tables.todos?.[0].deletedAt).not.toBeNull();
    expect(r.toApply.settings).toEqual([]);
    expect(r.merged.settings[0].value).toBe(false);
    expect(r.pushNeeded).toBe(true);
  });

  it('never lets an older copy overwrite a newer edit made on this device meanwhile', async () => {
    const id = await repo.createTodo({ title: 'mine' });
    const stale = { ...(await db.todos.get(id))!, title: 'stale', modifiedAt: '2000-01-01T00:00:00Z' };
    await applyRemote({ tables: { todos: [stale] }, settings: [] });
    expect((await db.todos.get(id))?.title).toBe('mine');
  });
});

describe('local changes (FR-19.5)', () => {
  it('notify sync, except those that came from the gist', async () => {
    const seen = vi.fn();
    const stop = onLocalChange(seen);
    await repo.createTodo({ title: 'x' });
    expect(seen).toHaveBeenCalledTimes(1);
    await applyRemote({ tables: { todos: [todo({ title: 'from gist' })] }, settings: [] });
    expect(seen).toHaveBeenCalledTimes(1);
    stop();
  });

  it('settings carry a change time; the theme stays on this device', async () => {
    await repo.setSetting('theme', 'dark');
    await repo.setSetting('autoP1', false);
    expect((await db.settings.get('autoP1'))?.modifiedAt).toBeTruthy();
    expect((await readLocal()).settings.map((s) => s.key)).toEqual(['autoP1']);
  });

  it('undoing a creation leaves a tombstone, so the deletion syncs', async () => {
    const id = await repo.createTodo({ title: 'x' });
    await undo();
    expect((await readLocal()).tables.todos.find((t) => t.id === id)?.deletedAt).toBeTruthy();
  });
});

describe('GitHub errors (FR-19.3, FR-19.8)', () => {
  it('reports a bad token, a missing scope, no network and a rate limit', async () => {
    await expect(checkToken('bad')).rejects.toMatchObject({ code: 'token' });
    gh.tokens.set('noscope', 'repo');
    await expect(checkToken('noscope')).rejects.toMatchObject({ code: 'scope' });
    gh.offline = true;
    await expect(checkToken('good')).rejects.toMatchObject({ code: 'offline' });
    gh.offline = false;
    gh.limitedUntil = Math.floor(Date.now() / 1000) + 600;
    const e = await checkToken('good').catch((x: GistError) => x);
    expect(e).toMatchObject({ code: 'ratelimit' });
    expect((e as GistError).retryAt?.getTime()).toBe(gh.limitedUntil * 1000);
  });

  it('fetches the full file when GitHub cuts it short', async () => {
    const id = gh.add({ 'mytasks.json': 'x'.repeat(50) });
    gh.truncateOver = 10;
    expect(await readGist('good', id)).toBe('x'.repeat(50));
  });
});

describe('setup (FR-19.1 to FR-19.3)', () => {
  it('first device: creates a secret gist from this device’s list, encrypted', async () => {
    await repo.createTodo({ title: 'Buy milk' });
    expect(await lookUp('good')).toEqual({ kind: 'none' });
    const config = await createList('good', 'correct horse', ACK);
    const g = gh.gists.get(config.gistId)!;
    expect(g.description).toBe('My Tasks');
    expect(g.files['mytasks.json'].content).not.toContain('Buy milk');
    expect(parseEnvelope(g.files['mytasks.json'].content)).not.toBeNull();
    expect((await loadConfig())?.gistId).toBe(config.gistId);
  });

  it('keeps the risks and limitations acknowledgment on this device, through syncs, and never in the gist', async () => {
    const config = await createList('good', 'correct horse', ACK);
    expect((await loadConfig())?.acknowledged).toEqual(ACK);
    await sync.connected(config);
    await repo.createTodo({ title: 'after setup' });
    await sync.syncNow();
    expect((await loadConfig())?.acknowledged).toEqual(ACK);
    expect(gh.gists.get(config.gistId)!.files['mytasks.json'].content).not.toContain('limitationsUpdated');
  });

  it('second device: a wrong passphrase changes nothing; the right one loads and merges the list', async () => {
    await repo.createTodo({ title: 'from first device' });
    await createList('good', 'correct horse', ACK);
    await newDevice();
    await repo.createTodo({ title: 'already here' });

    const found = await lookUp('good');
    expect(found.kind).toBe('found');
    const id = found.kind === 'found' ? found.lists[0].id : '';
    await expect(joinList('good', id, 'wrong', ACK)).rejects.toMatchObject({ code: 'wrong-passphrase' });
    expect(await loadConfig()).toBeNull();

    const config = await joinList('good', id, 'correct horse', ACK);
    expect(await titles()).toEqual(['already here', 'from first device']);
    // This device's to-do was pushed: a third device sees both.
    await newDevice();
    await joinList('good', config.gistId, 'correct horse', ACK);
    expect(await titles()).toEqual(['already here', 'from first device']);
  });

  it('lists several gists newest first, and reports gists that hold only invalid files', async () => {
    gh.add({ 'mytasks.json': 'garbage' });
    expect(await lookUp('good')).toEqual({ kind: 'invalid' });
    const a = await createList('good', 'passphrase one', ACK);
    const b = await createList('good', 'passphrase two', ACK);
    const found = await lookUp('good');
    expect(found.kind === 'found' && found.lists.map((l) => l.id)).toEqual([b.gistId, a.gistId]);
  });

  it('refuses a list from a newer version of the app', async () => {
    const salt = newSalt();
    const key = await deriveKey('correct horse', salt);
    const future = { ...payload(), schema: 99 };
    const id = gh.add({ 'mytasks.json': JSON.stringify(await seal(key, { salt, iterations: 600_000 }, JSON.stringify(future), 'x')) });
    await expect(joinList('good', id, 'correct horse', ACK)).rejects.toMatchObject({ code: 'newer' });
  });
});

describe('syncing a connected device (FR-19.4, FR-19.5)', () => {
  it('pushes local changes and pulls the gist’s', async () => {
    const config = await createList('good', 'correct horse', ACK);
    await repo.createTodo({ title: 'new here' });
    await syncOnce(config);
    // Another device adds one.
    await newDevice();
    const other = await joinList('good', config.gistId, 'correct horse', ACK);
    await repo.createTodo({ title: 'from other device' });
    await syncOnce(other);
    expect(await titles()).toEqual(['from other device', 'new here']);
  });

  it('never applies a damaged file', async () => {
    const config = await createList('good', 'correct horse', ACK);
    await repo.createTodo({ title: 'keep me' });
    gh.gists.get(config.gistId)!.files['mytasks.json'].content = '{"app":"mytasks"}';
    await expect(syncOnce(config)).rejects.toMatchObject({ code: 'malformed' });
    expect(await titles()).toEqual(['keep me']);
  });
});

describe('Settings › Sync (FR-19.6 to FR-19.8)', () => {
  let config: DeviceConfig;
  beforeEach(async () => {
    config = await createList('good', 'correct horse', ACK);
    sync.connected(config);
  });

  it('Change Passphrase: needs the current one; other devices then ask for the new one', async () => {
    await expect(sync.changePassphrase('wrong', 'new passphrase')).rejects.toMatchObject({ code: 'wrong-passphrase' });
    await sync.changePassphrase('correct horse', 'new passphrase');
    // A device still holding the old key finds the gist re-encrypted.
    await expect(syncOnce(config)).rejects.toBeInstanceOf(SyncError);
    await expect(syncOnce(config)).rejects.toMatchObject({ code: 'passphrase' });
    sync.connected(config);
    await expect(sync.enterPassphrase('correct horse')).rejects.toMatchObject({ code: 'wrong-passphrase' });
    await sync.enterPassphrase('new passphrase');
    await syncOnce(sync.config!);
  });

  it('Sync Now records problems in the status without losing local changes', async () => {
    await repo.createTodo({ title: 'offline edit' });
    gh.offline = true;
    await sync.syncNow();
    expect(sync.status).toBe('offline');
    gh.offline = false;
    gh.tokens.delete('good');
    await sync.syncNow();
    expect([sync.status, sync.problem]).toEqual(['error', 'token']);
    gh.tokens.set('new', 'gist');
    await sync.changeToken('new');
    expect(sync.status).toBe('synced');
    expect(gh.file(config.gistId)).toBeDefined();
    expect(await titles()).toEqual(['offline edit']);
  });

  it('Recreate Gist: a deleted gist is made again from this device', async () => {
    await repo.createTodo({ title: 'survivor' });
    gh.gists.delete(config.gistId);
    await sync.syncNow();
    expect(sync.problem).toBe('notfound');
    await sync.recreateGist();
    await newDevice();
    await joinList('good', sync.config!.gistId, 'correct horse', ACK);
    expect(await titles()).toEqual(['survivor']);
  });

  it('Disconnect forgets this device’s settings and list', async () => {
    await repo.createTodo({ title: 'x' });
    await sync.disconnect();
    expect(await loadConfig()).toBeNull();
    await db.open();
    expect(await db.todos.count()).toBe(0);
    expect(gh.file(config.gistId)).toBeDefined();
  });
});

describe('coming back online (FR-19.5)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps trying while offline, so the status clears without Sync Now', async () => {
    const config = await createList('good', 'correct horse', ACK);
    sync.connected(config);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    gh.offline = true;
    await sync.syncNow();
    expect(sync.status).toBe('offline');
    // Still offline at the first retry: it stays offline and tries again.
    await vi.advanceTimersByTimeAsync(OFFLINE_RETRY_MS);
    await vi.waitFor(() => expect(sync.status).toBe('offline'));
    // Back online, with no event and no change: the next retry gets through.
    // The retry is quiet, so the status never flickers to Syncing….
    gh.offline = false;
    const seen: string[] = [];
    const watch = setInterval(() => seen.push(sync.status), 1);
    await vi.advanceTimersByTimeAsync(OFFLINE_RETRY_MS);
    await vi.waitFor(() => expect(sync.status).toBe('synced'));
    clearInterval(watch);
    expect(seen).not.toContain('syncing');
    // Once synced, nothing more is scheduled.
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('sidebar sync status (FR-19.8)', () => {
  it('keeps the bottom line to the last sync, or Syncing…', () => {
    const at = '2026-11-12T14:40:00Z';
    expect(syncedLine('synced', at)).toBe(`Synced ${clock(new Date(at))}`);
    expect(syncedLine('idle', at)).toBe(`Synced ${clock(new Date(at))}`);
    expect(syncedLine('offline', at)).toBe(`Synced ${clock(new Date(at))}`);
    expect(syncedLine('error', at)).toBe(`Synced ${clock(new Date(at))}`);
    expect(syncedLine('syncing', at)).toBe('Syncing…');
    expect(syncedLine('idle', null)).toBe('Not synced yet');
  });

  it('puts being offline or a problem in a message above it', () => {
    expect(syncMessage('idle', null)).toBeNull();
    expect(syncMessage('synced', null)).toBeNull();
    expect(syncMessage('syncing', null)).toBeNull();
    expect(syncMessage('offline', null)).toBe('Offline — changes saved on this device');
    expect(syncMessage('error', 'token')).toBe('Sync error — token rejected');
    expect(syncMessage('error', 'passphrase')).toBe('Passphrase changed');
  });
});
