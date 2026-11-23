/**
 * Tests for back up and restore (FR-12.8, v0.10.0), with the items carried
 * into it from the re-verification: one-transaction readLocal, older gist
 * schemas, and the persistent-storage request. GitHub is faked in memory
 * (tests/fakeGitHub.ts). Two devices take turns in the one test database:
 * each device's state is saved with readLocal and loaded back (loadDevice).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, SCHEMA_VERSION } from '../src/lib/db/database';
import { upgradeList } from '../src/lib/db/migrations';
import * as repo from '../src/lib/db/repo';
import { clearUndo, tx, undo } from '../src/lib/db/history';
import {
  BACKUP_FORMAT,
  BackupError,
  backupFileName,
  buildBackup,
  countsOf,
  countsText,
  readBackup,
  saveMethod,
  type BackupFile,
} from '../src/lib/backup';
import { deriveKey, newSalt, seal, unseal, parseEnvelope } from '../src/lib/sync/crypto';
import { syncOnce } from '../src/lib/sync/cycle';
import { clearConfig, loadConfig, saveConfig, type DeviceConfig } from '../src/lib/sync/device';
import { readLocal } from '../src/lib/sync/local';
import type { Payload } from '../src/lib/sync/payload';
import { createList, joinList } from '../src/lib/sync/setup';
import { SyncEngine, sync } from '../src/lib/sync/sync.svelte';
import { readSettings } from '../src/lib/model/settings';
import { uuidv7 } from '../src/lib/model/ids';
import { MAX_TASKS } from '../src/lib/model/limits';
import { FakeGitHub } from './fakeGitHub';
import { sampleBackup } from '../e2e/sampleData';
import { marcusBackup, marcusCalendar } from '../e2e/marcusData';
import { localDate } from '../e2e/sampleRecords';
import { readCalendar } from '../src/lib/calendar/events';

let gh: FakeGitHub;
/** Every request the app made, as "METHOD url". */
let requests: string[];
/** Requests with this method fail as if offline. */
let failMethod: string | null;
/** While set, requests with its method wait until it resolves. */
let held: { gate: Promise<void>; method: string } | null;

const PASS = 'correct horse battery';
/** Setup's risks and limitations checkbox, ticked. */
const ACK = { at: '2026-11-13T12:00:00.000Z', limitationsUpdated: '2026-11-13' };

beforeEach(async () => {
  await newDevice();
  clearUndo();
  gh = new FakeGitHub();
  requests = [];
  failMethod = null;
  held = null;
  vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    requests.push(`${method} ${input}`);
    if (held && held.method === method) await held.gate;
    if (failMethod === method) throw new TypeError('Failed to fetch');
    return gh.fetch(input, init);
  });
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

/** Switch to a device whose list and settings were saved with readLocal. */
async function loadDevice(state: Payload, config: DeviceConfig): Promise<void> {
  await newDevice();
  for (const [t, rows] of Object.entries(state.tables)) await db.table(t).bulkPut(rows);
  await db.settings.bulkPut(state.settings);
  await saveConfig(config);
}

/** Open titles on this device, sorted. */
const titles = async () => (await db.todos.toArray()).filter((t) => !t.deletedAt).map((t) => t.title).sort();

/** The gist's list, decrypted. */
async function gistList(config: DeviceConfig): Promise<Payload> {
  const env = parseEnvelope(gh.file(config.gistId)!)!;
  return JSON.parse(await unseal(config.key, env));
}

/** Open titles in the gist, sorted. */
async function gistTitles(config: DeviceConfig): Promise<string[]> {
  const list = await gistList(config);
  return (list.tables.todos as { title?: string; deletedAt: string | null }[]).filter((t) => !t.deletedAt).map((t) => t.title!).sort();
}

/** A task's id by title. */
const idOf = async (title: string) => (await db.todos.toArray()).find((t) => t.title === title)!.id;

/** Hold every request with `method` until the returned function is called. */
function holdRequests(method: string): () => void {
  let release!: () => void;
  held = { gate: new Promise((r) => (release = r)), method };
  return () => {
    held = null;
    release();
  };
}

/** A gist holding `list`, encrypted with PASS, as if written by another version. */
async function gistWith(list: unknown): Promise<string> {
  const salt = newSalt();
  const key = await deriveKey(PASS, salt);
  return gh.add({ 'mytasks.json': JSON.stringify(await seal(key, { salt, iterations: 600_000 }, JSON.stringify(list), '2026-11-13T12:00:00.000Z')) });
}

/** A connected device holding tasks with these titles. */
async function connected(...names: string[]): Promise<DeviceConfig> {
  for (const title of names) await repo.createTodo({ title });
  const config = await createList('good', PASS, ACK);
  sync.connected(config);
  return config;
}

describe('the backup file (FR-12.8)', () => {
  it('holds its format and schema, the synced data, and no credentials', async () => {
    gh.tokens.set('tok-SECRET-123', 'gist');
    await repo.createTodo({ title: 'kept' });
    await repo.setSetting('autoP1', false);
    await repo.setSetting('theme', 'dark');
    const config = await createList('tok-SECRET-123', PASS, ACK);
    const text = await buildBackup('2026-11-13T18:50:00.000Z');
    const file = JSON.parse(text) as BackupFile;
    expect(file).toMatchObject({ format: BACKUP_FORMAT, formatVersion: 1, schema: SCHEMA_VERSION, app: 'mytasks', savedAt: '2026-11-13T18:50:00.000Z' });
    expect(typeof file.appVersion).toBe('string');
    expect(file.tables.todos.map((t) => (t as unknown as { title: string }).title)).toEqual(['kept']);
    expect(file.settings.map((s) => s.key)).toEqual(['autoP1']);
    for (const secret of ['tok-SECRET-123', config.gistId, config.salt, PASS]) expect(text).not.toContain(secret);
  });

  it('is one consistent snapshot, even while another change is being made', async () => {
    // A change touching the first and last synced tables, made while the
    // file is being read: the file has both of its records or neither.
    const reading = readLocal();
    await tx(async () => {
      await db.areas.put({ id: 'area-1', createdAt: '2026-11-13T12:00:00.000Z', modifiedAt: '2026-11-13T12:00:00.000Z', deletedAt: null, sortKey: 'a0', title: 'A', tagIds: [], collapsed: false });
      await db.savedSearches.put({ id: 'search-1', createdAt: '2026-11-13T12:00:00.000Z', modifiedAt: '2026-11-13T12:00:00.000Z', deletedAt: null, sortKey: 'a0', title: 'S', query: 'x', tagIds: [], contextId: null });
    });
    const list = await reading;
    expect(list.tables.areas.length).toBe(list.tables.savedSearches.length);
  });

  it('is named by when it was saved', () => {
    expect(backupFileName(new Date(2026, 10, 3, 9, 5))).toBe('My Tasks backup 2026-11-03 0905.json');
  });

  it('is shared from the installed iPhone and iPad app, and downloaded everywhere else', () => {
    expect(saveMethod('ios', true, true)).toBe('share');
    expect(saveMethod('ios', false, true)).toBe('download');
    expect(saveMethod('ios', true, false)).toBe('download');
    expect(saveMethod('safari', true, true)).toBe('download');
    expect(saveMethod('chromium', false, true)).toBe('download');
  });

  it('counts what it holds for the confirmation, leaving out deleted records', async () => {
    await repo.createTodo({ title: 'one' });
    await repo.createTodo({ title: 'two' });
    await repo.setTodoTrashed(await repo.createTodo({ title: 'gone' }), true);
    await repo.emptyTrash();
    const counts = countsOf((readBackup(await buildBackup())).list);
    expect(counts).toEqual({ tasks: 2, projects: 0, areas: 0 });
    expect(countsText(counts)).toBe('2 tasks, 0 projects and 0 areas');
    expect(countsText({ tasks: 1, projects: 1, areas: 1 })).toBe('1 task, 1 project and 1 area');
  });
});

describe('checking a file before restoring (FR-12.8)', () => {
  /** A good backup file, as an object to spoil. */
  async function goodFile(): Promise<BackupFile> {
    await repo.createTodo({ title: 'a task' });
    return JSON.parse(await buildBackup());
  }
  const refused = (text: string) => {
    try {
      readBackup(text);
    } catch (e) {
      return (e as BackupError).code;
    }
    return 'accepted';
  };

  it('accepts its own file', async () => {
    const backup = readBackup(JSON.stringify(await goodFile()));
    expect(backup.list.schema).toBe(SCHEMA_VERSION);
    expect(backup.list.tables.todos).toHaveLength(1);
  });

  it('accepts the screenshots’ sample tasks (e2e/sampleData.ts)', () => {
    expect(countsOf(readBackup(sampleBackup()).list)).toEqual({ tasks: 9, projects: 3, areas: 2 });
  });

  it('accepts the book’s sample (e2e/marcusData.ts): Marcus’s tasks pass Restore’s checks and every calendar event the app’s', () => {
    // Built on several weekdays, since its dates are worked out from the day it runs.
    for (let i = 0; i < 7; i++) {
      const day = new Date(2026, 10, 16 + i);
      const counts = countsOf(readBackup(marcusBackup(day)).list);
      expect(counts.areas).toBe(7);
      expect(counts.projects).toBe(24);
      expect(counts.tasks).toBeGreaterThan(90);
      const calendar = marcusCalendar(day);
      expect(readCalendar(calendar)!.events).toHaveLength(calendar.events.length);
    }
  });

  it('keeps the book’s sample in step with what the book says about it', () => {
    for (let i = 0; i < 7; i++) {
      const day = new Date(2026, 10, 16 + i);
      const weekday = (s: string) => new Date(`${s.slice(0, 10)}T12:00`).getDay();
      const tasks = JSON.parse(marcusBackup(day)).tables.todos as { id: string; startDate: string | null; repeat: { mode: string; interval: number; unit: string } | null }[];
      const events = marcusCalendar(day).events as { id: string; start: string }[];
      const event = (id: string) => events.find((e) => e.id === id)!.start;
      // The embargo lifts on a Tuesday that's also parent-teacher conferences.
      expect(weekday(event('embargo'))).toBe(2);
      expect(event('conferences').slice(0, 10)).toBe(event('embargo').slice(0, 10));
      // The recital outfit is for the weekend before the recital.
      const outfit = tasks.find((t) => t.id === 'fa-6')!.startDate!;
      const gap = (Date.parse(event('recital').slice(0, 10)) - Date.parse(outfit)) / 86_400_000;
      expect(weekday(outfit)).toBe(6);
      expect(gap).toBeGreaterThan(0);
      expect(gap).toBeLessThan(7);
      // The furnace filter comes back three months after he changes it.
      expect(tasks.find((t) => t.id === 'ho-3')!.repeat).toMatchObject({ mode: 'afterCompletion', unit: 'month', interval: 3 });
      // None of Elena's tasks is in Today, so Marcus's Today (eleven tasks, four in focus) is unchanged.
      const today = localDate(day);
      expect(tasks.filter((t) => t.id.startsWith('el-') && t.startDate !== null && t.startDate <= today)).toEqual([]);
    }
  });

  it('refuses what isn’t a My Tasks backup: not JSON, other JSON, or the gist’s encrypted file', async () => {
    const config = await connected('x');
    expect(refused('not json')).toBe('notbackup');
    expect(refused('[1,2]')).toBe('notbackup');
    expect(refused(gh.file(config.gistId)!)).toBe('notbackup');
  });

  it('refuses a file from a newer version, by format or schema', async () => {
    const f = await goodFile();
    expect(refused(JSON.stringify({ ...f, formatVersion: 2 }))).toBe('newer');
    expect(refused(JSON.stringify({ ...f, schema: 99 }))).toBe('newer');
  });

  it('refuses a damaged or edited file with the same checks as the gist', async () => {
    const f = await goodFile();
    const task = f.tables.todos[0] as unknown as Record<string, unknown>;
    expect(refused(JSON.stringify({ ...f, tables: { ...f.tables, todos: [{ ...task, priority: 9 }] } }))).toBe('invalid');
    expect(refused(JSON.stringify({ ...f, tables: { ...f.tables, todos: [task, task] } }))).toBe('invalid');
    expect(refused(JSON.stringify({ ...f, savedAt: 'yesterday' }))).toBe('invalid');
    expect(refused(JSON.stringify({ ...f, schema: 0 }))).toBe('invalid');
  });

  it('refuses a file over 5 MB, or with more tasks than the limit (NFR-7)', async () => {
    expect(refused(' '.repeat(5 * 1024 * 1024 + 1))).toBe('toolarge');
    const f = await goodFile();
    const [task] = f.tables.todos as unknown as Record<string, unknown>[];
    const many = (n: number) => JSON.stringify({ ...f, tables: { ...f.tables, todos: Array.from({ length: n }, () => ({ ...task, id: uuidv7() })) } });
    expect(refused(many(MAX_TASKS))).toBe('accepted');
    expect(refused(many(MAX_TASKS + 1))).toBe('toomany');
  });

  it('upgrades a file from an older schema', async () => {
    const f = await goodFile();
    const task = { ...(f.tables.todos[0] as unknown as Record<string, unknown>) };
    delete task.contextId;
    delete task.loggedAt;
    const old = { ...f, schema: 1, tables: { ...f.tables, todos: [task, { id: 'x', deletedAt: '2026-11-01T00:00:00.000Z', modifiedAt: '2026-11-01T00:00:00.000Z', title: 'secret' }] } };
    delete (old.tables as Partial<typeof old.tables>).contexts;
    const { list } = readBackup(JSON.stringify(old));
    expect(list.schema).toBe(SCHEMA_VERSION);
    expect(list.tables.contexts).toEqual([]);
    expect(list.tables.todos[0]).toMatchObject({ contextId: null, loggedAt: null });
    expect(list.tables.todos[1]).toEqual({ id: 'x', deletedAt: '2026-11-01T00:00:00.000Z', modifiedAt: '2026-11-01T00:00:00.000Z' });
    expect(list.upgradedFrom).toBeUndefined();
  });

  it('upgrades without changing the list it was given', () => {
    const old = { schema: 3, tables: { areas: [], projects: [], headings: [], checklistItems: [], tags: [], contexts: [], savedSearches: [], todos: [{ id: 'x', deletedAt: 'd', title: 't' }] } };
    const copy = JSON.parse(JSON.stringify(old));
    upgradeList(old, 4);
    expect(old).toEqual(copy);
  });
});

describe('a gist saved at an older schema (carried in from the re-verification)', () => {
  /** A list saved by 0.7.x: schema 3, one task, one deleted task still holding its title. */
  function schema3List() {
    const t = '2026-11-01T10:00:00.000Z';
    const task = {
      id: uuidv7(), createdAt: t, modifiedAt: t, deletedAt: null, sortKey: 'a0', title: 'from 0.7', notes: '', status: 'open',
      start: 'inbox', startDate: null, todaySortKey: null, deadline: null, priority: null, prioritySource: null,
      priorityBeforeAuto: null, tagIds: [], contextId: null, areaId: null, projectId: null, headingId: null,
      completedAt: null, loggedAt: null, trashedAt: null,
    };
    return {
      app: 'mytasks', schema: 3, settings: [],
      tables: { areas: [], projects: [], headings: [], checklistItems: [], tags: [], contexts: [], savedSearches: [], todos: [task] },
    };
  }

  it('is upgraded when read, and saved back at the current schema', async () => {
    const id = await gistWith(schema3List());
    const config = await joinList('good', id, PASS, ACK);
    expect(await titles()).toEqual(['from 0.7']);
    expect((await gistList(config)).schema).toBe(SCHEMA_VERSION);
  });

  it('from schema 2 (tasks without loggedAt) loads rather than failing as damaged', async () => {
    const old = schema3List();
    delete (old.tables.todos[0] as Partial<(typeof old.tables.todos)[0]>).loggedAt;
    const id = await gistWith({ ...old, schema: 2 });
    const config = await joinList('good', id, PASS, ACK);
    expect(await titles()).toEqual(['from 0.7']);
    expect((await gistList(config)).schema).toBe(SCHEMA_VERSION);
  });
});

describe('restore (FR-12.8)', () => {
  it('restore onto a connected device: the gist and a second device match the backup after sync', async () => {
    // Device A: two tasks, then a backup of them.
    const configA = await connected('one', 'two');
    const backup = readBackup(await buildBackup());
    // A carries on: a new task and an edit, synced.
    await repo.createTodo({ title: 'added after the backup' });
    await repo.updateTodoText(await idOf('one'), { title: 'one, edited after' });
    await syncOnce(configA);
    const stateA = await readLocal();
    // Device B joins and adds a task that reaches the gist but not A.
    await newDevice();
    const configB = await joinList('good', configA.gistId, PASS, ACK);
    await repo.createTodo({ title: 'only in the gist' });
    const markB = await syncOnce(configB);
    // B then edits a task and creates one, without syncing.
    await repo.updateTodoText(await idOf('two'), { title: 'two, edited on B' });
    await repo.createTodo({ title: 'new on B, not synced' });
    const stateB = await readLocal();

    // A restores the backup.
    await loadDevice(stateA, configA);
    sync.connected(configA);
    expect(await sync.restore(backup.list)).toBe('synced');
    expect(await titles()).toEqual(['one', 'two']);
    expect(await gistTitles(configA)).toEqual(['one', 'two']);
    expect((await loadConfig())!.lastSync).toBeUndefined();

    // B syncs, from its last sync's mark (NFR-7): the gist changed, so a full
    // sync. The backup wins over its unsynced edit; its unsynced new task is kept.
    await loadDevice(stateB, configB);
    await syncOnce({ ...configB, lastSync: markB });
    expect(await titles()).toEqual(['new on B, not synced', 'one', 'two']);
    expect(await gistTitles(configA)).toEqual(['new on B, not synced', 'one', 'two']);

    // A syncs again and matches.
    await loadDevice(stateA, configA);
    await syncOnce(configA);
    expect(await titles()).toEqual(['new on B, not synced', 'one', 'two']);
  });

  it('puts settings back as the backup had them, and the rest to their defaults; the theme stays', async () => {
    const config = await connected('x');
    await repo.setSetting('autoP1', false);
    const backup = readBackup(await buildBackup());
    await repo.setSetting('autoP1', true);
    await repo.setSetting('sinkChecked', true);
    await repo.setSetting('theme', 'dark');
    await syncOnce(config);
    await sync.restore(backup.list);
    const s = readSettings(await db.settings.toArray());
    expect(s).toMatchObject({ autoP1: false, sinkChecked: false, theme: 'dark' });
  });

  it('runs under the cross-window lock: a sync in another window waits for it', async () => {
    const config = await connected('one');
    const backup = readBackup(await buildBackup());
    const other = new SyncEngine();
    other.connected(config);
    const release = holdRequests('PATCH');
    const restoring = sync.restore(backup.list);
    await vi.waitFor(() => expect(requests.at(-1)).toMatch(/^PATCH/));
    const count = requests.length;
    const syncing = other.syncNow();
    await new Promise((r) => setTimeout(r, 20));
    expect(requests.length).toBe(count);
    release();
    await Promise.all([restoring, syncing]);
    expect(requests.length).toBeGreaterThan(count);
  });

  it('changes nothing when the gist can’t be read', async () => {
    const config = await connected('one');
    const backup = readBackup(await buildBackup());
    await repo.createTodo({ title: 'two' });
    await syncOnce(config);
    failMethod = 'GET';
    await expect(sync.restore(backup.list)).rejects.toMatchObject({ code: 'offline' });
    failMethod = null;
    gh.gists.get(config.gistId)!.files['mytasks.json'].content = '{"app":"mytasks"}';
    await expect(sync.restore(backup.list)).rejects.toMatchObject({ code: 'malformed' });
    expect(await titles()).toEqual(['one', 'two']);
  });

  it('changes nothing when the result would be too large to upload', async () => {
    const config = await connected('one');
    const before = gh.file(config.gistId);
    const backup = readBackup(await buildBackup());
    const big = { ...backup.list.tables.todos[0], id: uuidv7(), notes: 'x'.repeat(4_500_000) };
    const list = { ...backup.list, tables: { ...backup.list.tables, todos: [...backup.list.tables.todos, big] } };
    await expect(sync.restore(list)).rejects.toMatchObject({ code: 'toolarge' });
    expect(await titles()).toEqual(['one']);
    expect(gh.file(config.gistId)).toBe(before);
  });

  it('restores this device even when the gist can’t be written, and pushes at the next sync', async () => {
    const config = await connected('one');
    const backup = readBackup(await buildBackup());
    await repo.createTodo({ title: 'two' });
    const mark = await syncOnce(config);
    failMethod = 'PATCH';
    expect(await sync.restore(backup.list)).toBe('pending');
    expect(await titles()).toEqual(['one']);
    expect(sync.status).toBe('offline');
    failMethod = null;
    // Even from the mark before the restore (the gist unchanged since), the restored list is pushed (NFR-7).
    await syncOnce({ ...config, lastSync: mark });
    expect(await gistTitles(config)).toEqual(['one']);
  });

  it('is not an undo step, and clears the last one', async () => {
    await connected('one');
    const backup = readBackup(await buildBackup());
    await repo.createTodo({ title: 'two' });
    await sync.restore(backup.list);
    expect(await undo()).toBe('none');
    expect(await titles()).toEqual(['one']);
  });
});

describe('persistent storage (carried in from the re-verification)', () => {
  it('is requested once the device is connected', async () => {
    const persist = vi.fn(async () => true);
    vi.stubGlobal('navigator', { ...navigator, storage: { persist } });
    new SyncEngine().connected({} as DeviceConfig);
    expect(persist).toHaveBeenCalled();
  });
});
