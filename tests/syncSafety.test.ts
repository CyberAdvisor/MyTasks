/**
 * Tests for PR 1 of the security review (2026-11-13, v0.7.1): Disconnect
 * waits for a running sync, sync and Settings actions run one at a time, a
 * rate limit retries at its reset time, GitHub requests time out, long files
 * come only from gist.githubusercontent.com, and the app refuses to run in
 * a frame. GitHub is faked in memory (tests/fakeGitHub.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/lib/db/database';
import * as repo from '../src/lib/db/repo';
import { clearUndo } from '../src/lib/db/history';
import { isFramed, showFramedNotice } from '../src/lib/framed';
import { clearConfig, loadConfig, type DeviceConfig } from '../src/lib/sync/device';
import { GistError, REQUEST_TIMEOUT_MS, isRawUrl, readGist } from '../src/lib/sync/github';
import { createList, joinList } from '../src/lib/sync/setup';
import { RATE_LIMIT_FALLBACK_MS, RATE_LIMIT_MARGIN_MS, sync } from '../src/lib/sync/sync.svelte';
import { FakeGitHub } from './fakeGitHub';

let gh: FakeGitHub;
/** Every request the app made, as "METHOD url". */
let requests: string[];
/** While set, matching requests wait until it resolves (see holdRequests). */
let held: { gate: Promise<void>; method?: string } | null;

beforeEach(async () => {
  await db.delete();
  await db.open();
  await clearConfig();
  clearUndo();
  gh = new FakeGitHub();
  requests = [];
  held = null;
  vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
    requests.push(`${init.method ?? 'GET'} ${input}`);
    if (held && (!held.method || held.method === (init.method ?? 'GET'))) await held.gate;
    return gh.fetch(input, init);
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Hold every request, or those with `method`, until the returned function is called. */
function holdRequests(method?: string): () => void {
  let release!: () => void;
  held = { gate: new Promise((r) => (release = r)), method };
  return () => {
    held = null;
    release();
  };
}

/** Setup's risks and limitations checkbox, ticked. */
const ACK = { at: '2026-11-13T12:00:00.000Z', limitationsUpdated: '2026-11-13' };

const titles = async () => (await db.todos.toArray()).filter((t) => !t.deletedAt).map((t) => t.title).sort();

/** A connected device with one task. */
async function connectedDevice(): Promise<DeviceConfig> {
  await repo.createTodo({ title: 'first' });
  const config = await createList('good', 'correct horse', ACK);
  sync.connected(config);
  return config;
}

describe('Disconnect (FR-19.7)', () => {
  it('waits for a running sync, which then cannot write the settings back', async () => {
    await connectedDevice();
    await repo.createTodo({ title: 'second' });
    // Hold the sync at its last step, the upload.
    const release = holdRequests('PATCH');
    const syncing = sync.syncNow();
    await vi.waitFor(() => expect(requests.at(-1)).toMatch(/^PATCH/));
    const disconnecting = sync.disconnect();
    release();
    await Promise.all([syncing, disconnecting]);
    expect(await loadConfig()).toBeNull();
    expect(sync.config).toBeNull();
  });

  it('stops new syncs, here and once another window has disconnected', async () => {
    await connectedDevice();
    // Another window disconnected: the settings are gone, though this window still holds them.
    await clearConfig();
    requests = [];
    await sync.syncNow();
    expect(requests).toEqual([]);
    // This window disconnected: nothing more syncs.
    sync.connected((await createList('good', 'correct horse', ACK)));
    await sync.disconnect();
    requests = [];
    await sync.syncNow();
    expect(requests).toEqual([]);
  });
});

describe('one action at a time', () => {
  it('a sync asked for during Change Passphrase runs after it, with the new key', async () => {
    await connectedDevice();
    const release = holdRequests();
    const changing = sync.changePassphrase('correct horse', 'new passphrase');
    await vi.waitFor(() => expect(requests.length).toBeGreaterThan(0));
    await repo.createTodo({ title: 'during the change' });
    const before = requests.length;
    const syncing = sync.syncNow();
    // The sync waits for Change Passphrase: it sends nothing yet.
    await new Promise((r) => setTimeout(r, 50));
    expect(requests.length).toBe(before);
    release();
    await Promise.all([changing, syncing]);
    expect([sync.status, sync.problem]).toEqual(['synced', null]);
    // The gist opens with the new passphrase and holds the change made meanwhile.
    const gistId = sync.config!.gistId;
    await db.delete();
    await db.open();
    await clearConfig();
    await joinList('good', gistId, 'new passphrase', ACK);
    expect(await titles()).toEqual(['during the change', 'first']);
  });
});

describe('rate limits (FR-19.8)', () => {
  it('tries again just after the reset time, with nothing else to prompt it', async () => {
    await connectedDevice();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    gh.limitedUntil = Math.floor(Date.now() / 1000) + 60;
    await sync.syncNow();
    expect([sync.status, sync.problem]).toEqual(['error', 'ratelimit']);
    await vi.advanceTimersByTimeAsync(gh.limitedUntil * 1000 - Date.now() + RATE_LIMIT_MARGIN_MS);
    await vi.waitFor(() => expect(sync.status).toBe('synced'));
    expect(sync.retryAt).toBeNull();
  });

  it('reads Retry-After when GitHub gives no reset time, and otherwise waits a minute', async () => {
    await connectedDevice();
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 403, headers: { 'retry-after': '120' } }));
    const e = (await readGist('good', 'x').catch((x: unknown) => x)) as GistError;
    expect(e.code).toBe('ratelimit');
    expect(e.retryAt!.getTime() - Date.now()).toBeGreaterThan(119_000);

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 429 }));
    await sync.syncNow();
    expect([sync.problem, sync.retryAt]).toEqual(['ratelimit', null]);
    vi.stubGlobal('fetch', gh.fetch);
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_FALLBACK_MS);
    await vi.waitFor(() => expect(sync.status).toBe('synced'));
  });
});

describe('GitHub requests', () => {
  it('count as offline when GitHub does not answer within the time limit', async () => {
    await connectedDevice();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    // A request that never gets an answer, until it is aborted.
    vi.stubGlobal(
      'fetch',
      (_input: string, init: RequestInit) =>
        new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))),
    );
    const syncing = sync.syncNow();
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await syncing;
    expect(sync.status).toBe('offline');
  });

  it('fetch a long file only from gist.githubusercontent.com', async () => {
    expect(isRawUrl('https://gist.githubusercontent.com/me/abc/raw/mytasks.json')).toBe(true);
    for (const url of ['https://evil.example/raw', 'http://gist.githubusercontent.com/x', 'https://gist.githubusercontent.com.evil.example/x', 'nonsense', undefined]) {
      expect(isRawUrl(url)).toBe(false);
    }
    vi.stubGlobal('fetch', async (input: string) => {
      requests.push(input);
      return new Response(JSON.stringify({ files: { 'mytasks.json': { truncated: true, raw_url: 'https://evil.example/raw' } } }));
    });
    await expect(readGist('good', 'x')).rejects.toMatchObject({ code: 'server' });
    expect(requests).toEqual(['https://api.github.com/gists/x']);
  });
});

describe('inside a frame', () => {
  it('is detected, including when the top window cannot be read', () => {
    const own = {} as Window;
    expect(isFramed({ self: own, top: own } as Window)).toBe(false);
    expect(isFramed({ self: own, top: {} } as Window)).toBe(true);
    const blocked = {
      self: own,
      get top(): Window {
        throw new Error('blocked');
      },
    };
    expect(isFramed(blocked as unknown as Window)).toBe(true);
  });

  it('shows a message with a link that opens the app on its own', () => {
    const target = document.createElement('div');
    target.innerHTML = '<p>app</p>';
    showFramedNotice(target);
    expect(target.textContent).toBe('My Tasks can’t run inside another page. Open My Tasks');
    const link = target.querySelector('a')!;
    expect([link.href, link.target, link.rel]).toEqual([location.href, '_blank', 'noopener']);
  });
});
