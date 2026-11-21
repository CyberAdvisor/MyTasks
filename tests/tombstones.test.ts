/**
 * Dropping tombstones after 180 days, and a device away longer than 170 days
 * waiting for Replace With Gist (design note "compacting tombstones";
 * Michael, 2026-11-18).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/lib/db/database';
import * as repo from '../src/lib/db/repo';
import { clearUndo } from '../src/lib/db/history';
import { parseEnvelope, unseal } from '../src/lib/sync/crypto';
import { clearConfig, loadConfig, saveConfig, type DeviceConfig } from '../src/lib/sync/device';
import { dropOldTombstones } from '../src/lib/sync/local';
import { isAway, isOldTombstone, mergePayloads, type Payload } from '../src/lib/sync/payload';
import { createList } from '../src/lib/sync/setup';
import { sync } from '../src/lib/sync/sync.svelte';
import { FakeGitHub } from './fakeGitHub';

const ACK = { at: '2026-11-13T12:00:00.000Z', limitationsUpdated: '2026-11-13' };
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();
let gh: FakeGitHub;

beforeEach(async () => {
  await db.delete();
  await db.open();
  await clearConfig();
  clearUndo();
  gh = new FakeGitHub();
  vi.stubGlobal('fetch', (input: string, init: RequestInit = {}) => gh.fetch(input, init));
});
afterEach(() => vi.unstubAllGlobals());

const tomb = (id: string, deletedAt: string) => ({ id, deletedAt, modifiedAt: deletedAt });
const list = (todos: object[]): Payload =>
  ({
    app: 'mytasks',
    schema: 9,
    tables: { areas: [], projects: [], headings: [], todos, checklistItems: [], tags: [], contexts: [], savedSearches: [] },
    settings: [],
  }) as unknown as Payload;
async function gistList(config: DeviceConfig): Promise<Payload> {
  return JSON.parse(await unseal(config.key, parseEnvelope(gh.file(config.gistId)!)!));
}

describe('the 180-day and 170-day limits', () => {
  it('a tombstone is old after 180 days; a device is away after 170', () => {
    const now = new Date().toISOString();
    expect(isOldTombstone(tomb('a', daysAgo(181)) as never, now)).toBe(true);
    expect(isOldTombstone(tomb('a', daysAgo(179)) as never, now)).toBe(false);
    expect(isOldTombstone({ id: 'a', deletedAt: null, modifiedAt: daysAgo(400) } as never, now)).toBe(false);
    expect(isAway(daysAgo(171), now)).toBe(true);
    expect(isAway(daysAgo(169), now)).toBe(false);
    expect(isAway(null, now)).toBe(false);
  });
});

describe('dropping old tombstones', () => {
  it('a merge leaves out old tombstones from both sides, and cleans the gist', () => {
    const local = list([tomb('mine-old', daysAgo(200)), tomb('mine-new', daysAgo(10))]);
    const remote = list([tomb('theirs-old', daysAgo(190)), tomb('theirs-new', daysAgo(5))]);
    const { merged, pushNeeded } = mergePayloads(local, remote);
    expect(merged.tables.todos.map((r) => r.id).sort()).toEqual(['mine-new', 'theirs-new']);
    expect(pushNeeded).toBe(true);
  });

  it('this device deletes its own old tombstones, and keeps everything else', async () => {
    const kept = await repo.createTodo({ title: 'kept' });
    await db.todos.bulkPut([tomb('old', daysAgo(200)), tomb('recent', daysAgo(20))] as never[]);
    await dropOldTombstones();
    expect((await db.todos.toArray()).map((t) => t.id).sort()).toEqual([kept, 'recent'].sort());
  });

  it('a sync removes old tombstones from the device and the gist', async () => {
    await repo.createTodo({ title: 'kept' });
    const config = await createList('good', 'correct horse battery', ACK);
    sync.connected(config);
    await db.todos.put(tomb('old', daysAgo(200)) as never);
    await sync.syncNow();
    expect(sync.status).toBe('synced');
    expect(await db.todos.get('old')).toBeUndefined();
    expect((await gistList(config)).tables.todos.map((r) => r.id)).not.toContain('old');
  });
});

describe('a device away longer than 170 days', () => {
  it('doesn’t sync, and says so; Replace With Gist makes it the gist’s, then it syncs', async () => {
    await repo.createTodo({ title: 'in the gist' });
    const config = await createList('good', 'correct horse battery', ACK);
    // The same device, months later: a task deleted elsewhere long ago is still here.
    await db.todos.clear();
    await repo.createTodo({ title: 'deleted elsewhere long ago' });
    const away = { ...config, lastSyncedAt: daysAgo(200), lastSync: undefined };
    await saveConfig(away);
    sync.connected(away);
    const before = gh.file(config.gistId);
    await sync.syncNow();
    expect(sync.status).toBe('error');
    expect(sync.problem).toBe('away');
    expect(gh.file(config.gistId)).toBe(before);

    await sync.replaceWithGist();
    await sync.syncNow();
    expect(sync.status).toBe('synced');
    const titles = (await db.todos.toArray()).filter((t) => !t.deletedAt).map((t) => t.title);
    expect(titles).toEqual(['in the gist']);
    expect(isAway((await loadConfig())!.lastSyncedAt, new Date().toISOString())).toBe(false);
  });
});
