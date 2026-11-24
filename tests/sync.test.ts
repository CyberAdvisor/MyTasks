/**
 * Tests for Milestone 5e: GitHub Gist as the data store, with encryption
 * (FR-19). GitHub is faked in memory (tests/fakeGitHub.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/lib/db/database';
import * as repo from '../src/lib/db/repo';
import { clearUndo, onLocalChange, undo } from '../src/lib/db/history';
import { DecryptError, base64Bytes, deriveKey, newSalt, parseEnvelope, seal, toBase64, unseal } from '../src/lib/sync/crypto';
import { SyncError, syncOnce } from '../src/lib/sync/cycle';
import { clearConfig, loadConfig, type DeviceConfig } from '../src/lib/sync/device';
import { GistError, checkToken, readGist } from '../src/lib/sync/github';
import { adoptRemote, applyRemote, readLocal } from '../src/lib/sync/local';
import { changesSince, returnCheck } from '../src/lib/state/live';
import { SYNCED_SETTINGS, SYNCED_TABLES, mergePayloads, type Payload } from '../src/lib/sync/payload';
import { VALIDATED_SETTINGS } from '../src/lib/sync/validate';
import { createList, joinList, lookUp } from '../src/lib/sync/setup';
import { clock, syncMessage, syncedLine } from '../src/lib/sync/messages';
import { OFFLINE_RETRY_MS, SyncEngine, sync } from '../src/lib/sync/sync.svelte';
import { FakeGitHub } from './fakeGitHub';
import { project, todo } from './helpers';
import { PROJECT_PARTS, RECORD_FIELDS, TODO_PARTS, stampParts, toSeconds } from '../src/lib/model/parts';
import { replacement } from '../src/lib/sync/payload';
import { LOST_SHOWN, lostChanges, lostTitle, lostWhat } from '../src/lib/sync/lost';


describe('merging part by part (FR-19.10)', () => {
  const at = (hhmm: string) => `2026-11-23T${hhmm}:00.000Z`;
  const secs = (hhmm: string) => toSeconds(at(hhmm));
  const base = todo({ id: 'm', title: 'Buy milk', modifiedAt: at('08:00'), ft: {} });

  it('keeps one device’s completion and the other’s note', () => {
    const john = { ...base, status: 'completed' as const, completedAt: at('09:00'), modifiedAt: at('09:00'), ft: { s: secs('09:00') } };
    const jane = { ...base, notes: '2 litres', modifiedAt: at('10:00'), ft: { n: secs('10:00') } };
    // John's phone syncs after Jane's: the gist holds her later copy.
    const r = mergePayloads(payload({ todos: [john] }), payload({ todos: [jane] }), at('11:00'));
    const merged = r.merged.tables.todos[0] as typeof base;
    expect(merged).toMatchObject({ status: 'completed', completedAt: at('09:00'), notes: '2 litres', modifiedAt: at('10:00') });
    expect(merged.ft).toEqual({ s: secs('09:00'), n: secs('10:00') });
    expect(r.toApply.tables.todos).toEqual([merged]);
    expect(r.pushNeeded).toBe(true);
    // Jane's device then takes the combined copy and has nothing to push back.
    const back = mergePayloads(payload({ todos: [jane] }), r.merged, at('11:01'));
    expect(back.toApply.tables.todos).toEqual([merged]);
    expect(back.pushNeeded).toBe(false);
  });

  it('keeps the later change when both changed the same part', () => {
    const john = { ...base, title: 'Milk', modifiedAt: at('09:00'), ft: { t: secs('09:00') } };
    const jane = { ...base, title: 'Oat milk', modifiedAt: at('10:00'), ft: { t: secs('10:00') } };
    const r = mergePayloads(payload({ todos: [john] }), payload({ todos: [jane] }), at('11:00'));
    expect(r.merged.tables.todos[0]).toBe(jane);
    expect(r.pushNeeded).toBe(false);
  });

  it('keeps a note when another device set a priority by itself later', () => {
    const mine = { ...base, notes: 'Call first', modifiedAt: at('08:59'), ft: { n: secs('08:59') } };
    const auto = { ...base, priority: 2 as const, prioritySource: 'auto' as const, modifiedAt: at('09:00'), ft: { p: secs('09:00') } };
    const merged = mergePayloads(payload({ todos: [mine] }), payload({ todos: [auto] }), at('10:00')).merged.tables.todos[0];
    expect(merged).toMatchObject({ notes: 'Call first', priority: 2, prioritySource: 'auto' });
  });

  it('merges a project part by part too, and a deletion as a whole', () => {
    const p = project({ id: 'p', modifiedAt: at('08:00'), ft: {} });
    const renamed = { ...p, title: 'Move house', modifiedAt: at('09:00'), ft: { t: secs('09:00') } };
    const tagged = { ...p, tagIds: ['x'], modifiedAt: at('10:00'), ft: { g: secs('10:00') } };
    expect(mergePayloads(payload({ projects: [renamed] }), payload({ projects: [tagged] }), at('11:00')).merged.tables.projects[0]).toMatchObject({
      title: 'Move house',
      tagIds: ['x'],
    });
    const edited = { ...base, notes: 'later note', modifiedAt: at('09:00'), ft: { n: secs('09:00') } };
    const gone = { id: 'm', deletedAt: at('10:00'), modifiedAt: at('10:00') };
    expect(mergePayloads(payload({ todos: [edited] }), payload({ todos: [gone as never] }), at('11:00')).merged.tables.todos[0]).toEqual(gone);
  });

  it('goes by the whole record for copies with no part times, as from before part times', () => {
    const older = { ...base, title: 'A', notes: 'a', modifiedAt: at('09:00') };
    const newer = { ...base, title: 'B', modifiedAt: at('10:00') };
    expect(mergePayloads(payload({ todos: [older] }), payload({ todos: [newer] }), at('11:00')).merged.tables.todos[0]).toBe(newer);
  });

  it('puts every field of a task and a project in exactly one part', () => {
    const covered = (parts: Record<string, readonly string[]>, record: object) => {
      const listed = [...Object.values(parts).flat(), ...RECORD_FIELDS];
      expect(new Set(listed).size).toBe(listed.length);
      expect([...listed].sort()).toEqual([...new Set([...Object.keys(record), 'ft'])].sort());
    };
    covered(TODO_PARTS, todo());
    covered(PROJECT_PARTS, project());
  });

  it('drops part times older than 180 days when the record next changes', () => {
    const now = at('12:00');
    const old = toSeconds(now) - 181 * 86_400;
    const recent = toSeconds(now) - 10 * 86_400;
    expect(stampParts({ t: old, n: recent }, ['s'], now)).toEqual({ n: recent, s: toSeconds(now) });
  });

  it('stamps only the parts a change touched, undo included, and never a change from the gist', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date(at('09:00')));
      const id = await repo.createTodo({ title: 'Plan' });
      expect((await db.todos.get(id))?.ft).toEqual({});
      vi.setSystemTime(new Date(at('09:10')));
      await repo.updateTodoText(id, { notes: 'with Sam' });
      expect((await db.todos.get(id))?.ft).toEqual({ n: secs('09:10') });
      vi.setSystemTime(new Date(at('09:20')));
      await repo.setTodoStatus(id, 'completed');
      expect((await db.todos.get(id))?.ft).toMatchObject({ n: secs('09:10'), s: secs('09:20') });
      // Undo puts the old record back, its old times included; the parts it changes are stamped now.
      vi.setSystemTime(new Date(at('09:30')));
      await undo();
      const undone = (await db.todos.get(id))!;
      expect(undone.status).toBe('open');
      expect(undone.ft).toMatchObject({ n: secs('09:10'), s: secs('09:30') });
      // A change from the gist keeps the gist's own times.
      const theirs = { ...undone, title: 'Plan trip', modifiedAt: at('09:40'), ft: { ...undone.ft, t: secs('09:35') } };
      vi.setSystemTime(new Date(at('09:45')));
      await applyRemote({ tables: { todos: [theirs] }, settings: [] });
      expect((await db.todos.get(id))?.ft).toEqual(theirs.ft);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stamps every part of a restored task and project, so no older copy wins a part back (FR-12.8)', () => {
    const now = at('12:00');
    const list = payload({ todos: [{ ...base, ft: { n: secs('08:00') } }], projects: [project({ id: 'p', ft: {} })] });
    const next = replacement(list, {}, now);
    expect(next.tables.todos[0].ft).toEqual(Object.fromEntries(Object.keys(TODO_PARTS).map((k) => [k, toSeconds(now)])));
    expect(Object.keys(next.tables.projects[0].ft!).sort()).toEqual(Object.keys(PROJECT_PARTS).sort());
  });
});

describe('the lost-change notice (FR-19.12)', () => {
  const at = (hhmm: string) => `2026-11-23T${hhmm}:00.000Z`;
  const secs = (hhmm: string) => toSeconds(at(hhmm));
  // This device last synced at 8:30; the gist's copies are from another device.
  const since = at('08:30');
  const base = todo({ id: 'm', title: 'Buy milk', modifiedAt: at('08:00'), ft: {} });
  const lost = (mine: object[], theirs: object[], table = 'todos', extra: object = {}) => {
    const local = payload({ [table]: mine, ...extra });
    return lostChanges(local, mergePayloads(local, payload({ [table]: theirs, ...extra }), at('11:00')).merged, since);
  };

  it('names the part this device changed that a later change replaced', () => {
    const mine = { ...base, title: 'Milk', modifiedAt: at('09:00'), ft: { t: secs('09:00') } };
    const theirs = { ...base, title: 'Oat milk', modifiedAt: at('10:00'), ft: { t: secs('10:00') } };
    expect(lost([mine], [theirs])).toEqual([{ kind: 'todo', id: 'm', title: 'Oat milk', what: ['title'], deleted: false }]);
  });

  it('says nothing when different parts were changed, both kept', () => {
    const mine = { ...base, status: 'completed', completedAt: at('09:00'), modifiedAt: at('09:00'), ft: { s: secs('09:00') } };
    const theirs = { ...base, notes: 'note', modifiedAt: at('10:00'), ft: { n: secs('10:00') } };
    expect(lost([mine], [theirs])).toEqual([]);
  });

  it('says nothing when both completed it, or only an automatic priority was replaced', () => {
    const done = (hhmm: string) => ({ ...base, status: 'completed', completedAt: at(hhmm), modifiedAt: at(hhmm), ft: { s: secs(hhmm) } });
    expect(lost([done('09:00')], [done('10:00')])).toEqual([]);
    const auto = { ...base, priority: 2, prioritySource: 'auto', modifiedAt: at('09:00'), ft: { p: secs('09:00') } };
    const chosen = { ...base, priority: 1, prioritySource: 'user', modifiedAt: at('10:00'), ft: { p: secs('10:00') } };
    expect(lost([auto], [chosen])).toEqual([]);
  });

  it('says a completion was lost, and a change from before the last sync isn’t counted', () => {
    const mine = { ...base, status: 'completed', completedAt: at('09:00'), modifiedAt: at('09:00'), ft: { s: secs('09:00') } };
    const theirs = { ...base, status: 'canceled', modifiedAt: at('10:00'), ft: { s: secs('10:00') } };
    expect(lost([mine], [theirs])[0].what).toEqual(['completed']);
    const synced = { ...mine, modifiedAt: at('08:10'), ft: { s: secs('08:10') } };
    expect(lost([synced], [theirs])).toEqual([]);
  });

  it('reports a task changed here and deleted on another device', () => {
    const mine = { ...base, notes: 'x', modifiedAt: at('09:00'), ft: { n: secs('09:00') } };
    const gone = { id: 'm', deletedAt: at('10:00'), modifiedAt: at('10:00') };
    expect(lost([mine], [gone])).toEqual([{ kind: 'todo', id: 'm', title: 'Buy milk', what: [], deleted: true }]);
  });

  it('reports a replaced checklist item under its task, but not one with the same content', () => {
    const item = { id: 'c', todoId: 'm', title: 'Oat', completed: false, sortKey: 'a0', createdAt: at('08:00'), deletedAt: null, ft: {} };
    const tasks = { todos: [base] };
    const mine = { ...item, completed: true, modifiedAt: at('09:00') };
    const theirs = { ...item, title: 'Soy', modifiedAt: at('10:00') };
    expect(lost([mine], [theirs], 'checklistItems', tasks)).toEqual([{ kind: 'todo', id: 'm', title: 'Buy milk', what: ['checklist'], deleted: false }]);
    // A repeat's copy made on both devices: the same content, made at different moments.
    expect(lost([{ ...item, modifiedAt: at('09:00') }], [{ ...item, modifiedAt: at('10:00') }], 'checklistItems', tasks)).toEqual([]);
  });

  it('words the notice, and lists at most LOST_SHOWN', () => {
    expect(lostTitle(1)).toBe('1 of your changes was replaced by a later change from another device');
    expect(lostTitle(3)).toBe('3 of your changes were replaced by later changes from another device');
    expect(lostWhat({ kind: 'todo', id: 'm', title: 'x', what: ['completed', 'notes'], deleted: false })).toBe('completed, notes');
    expect(lostWhat({ kind: 'todo', id: 'm', title: 'x', what: [], deleted: true })).toBe('deleted on another device');
    expect(LOST_SHOWN).toBe(10);
  });
});

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

  it('base64: encodes as btoa does, and counts bytes from the length alone, rejecting what isn’t base64 (NFR-7)', () => {
    for (let n = 0; n < 40; n++) {
      const bytes = crypto.getRandomValues(new Uint8Array(n));
      const b64 = toBase64(bytes);
      expect(b64).toBe(btoa(String.fromCharCode(...bytes)));
      expect(base64Bytes(b64)).toBe(n);
    }
    for (const bad of ['abc', 'ab=c', 'a===', 'ab$=', 'AAAA AAA']) expect(base64Bytes(bad)).toBe(-1);
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

describe('clocks that ran ahead (review follow-up 3)', () => {
  const FUTURE = '2099-01-01T00:00:00.000Z';
  /** Earlier than the test machine's clock, so an edit made now is later. */
  const NOW = '2026-01-01T00:00:00.000Z';

  /** A task on this device whose last edit carries a time far in the future. */
  async function futureTask(title = 'here'): Promise<string> {
    const id = await repo.createTodo({ title });
    await db.todos.update(id, { modifiedAt: FUTURE });
    return id;
  }

  it('corrects a future time on this device, saves it here and pushes it', async () => {
    const id = await futureTask();
    const older = { ...(await db.todos.get(id))!, title: 'gist', modifiedAt: '2025-12-01T00:00:00.000Z' };
    const m = mergePayloads(await readLocal(), payload({ todos: [older] }), NOW);
    await applyRemote(m.toApply);
    expect(await db.todos.get(id)).toMatchObject({ title: 'here', modifiedAt: NOW });
    expect(m.merged.tables.todos[0]).toMatchObject({ title: 'here', modifiedAt: NOW });
    expect(m.pushNeeded).toBe(true);
    // A later edit on another device now wins.
    const edited = { ...older, title: 'edited elsewhere', modifiedAt: '2026-01-02T00:00:00.000Z' };
    const next = mergePayloads(await readLocal(), payload({ todos: [edited] }), '2026-01-03T00:00:00.000Z');
    await applyRemote(next.toApply);
    expect((await db.todos.get(id))!.title).toBe('edited elsewhere');
  });

  it('lets the gist’s corrected copy replace a future time here', async () => {
    const id = await futureTask();
    const theirs = { ...(await db.todos.get(id))!, title: 'gist', modifiedAt: '2098-01-01T00:00:00.000Z' };
    const m = mergePayloads(await readLocal(), payload({ todos: [theirs] }), NOW);
    await applyRemote(m.toApply);
    expect(await db.todos.get(id)).toMatchObject({ title: 'gist', modifiedAt: NOW });
  });

  it('never overwrites an edit made on this device during the sync', async () => {
    const id = await futureTask();
    const m = mergePayloads(await readLocal(), payload(), NOW);
    await repo.updateTodoText(id, { title: 'typed during the sync' });
    await applyRemote(m.toApply);
    expect((await db.todos.get(id))!.title).toBe('typed during the sync');
  });

  it('corrects a future time on a setting here too', async () => {
    await repo.setSetting('autoP1', false);
    await db.settings.update('autoP1', { modifiedAt: FUTURE });
    const m = mergePayloads(await readLocal(), payload(), NOW);
    await applyRemote(m.toApply);
    expect(await db.settings.get('autoP1')).toMatchObject({ value: false, modifiedAt: NOW });
    expect(m.pushNeeded).toBe(true);
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

  it('syncs exactly the settings the checks accept', () => {
    expect([...SYNCED_SETTINGS].sort()).toEqual([...VALIDATED_SETTINGS].sort());
  });

  it('carries Sequential Projects to another device (FR-17.1)', async () => {
    const rows = [{ tagId: 'tag-1', priority: 3 as const, contextId: null }];
    await repo.setSetting('sequentialTags', rows);
    const mine = await readLocal();
    expect(mine.settings.map((s) => s.key)).toContain('sequentialTags');
    // The other device: empty, merging the gist this device wrote.
    await db.delete();
    await db.open();
    const m = mergePayloads(await readLocal(), mine, new Date().toISOString());
    await applyRemote(m.toApply);
    expect((await db.settings.get('sequentialTags'))?.value).toEqual(rows);
  });

  it('settings carry a change time', async () => {
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

/** The gist's list, decrypted, with every table's rows in id order. */
async function gistList(config: DeviceConfig): Promise<Payload> {
  const list = JSON.parse(await unseal(config.key, parseEnvelope(gh.file(config.gistId)!)!)) as Payload;
  return sorted(list);
}

/** A list with every table's rows in id order, for comparing. */
function sorted(list: Payload): Payload {
  const tables = Object.fromEntries(SYNCED_TABLES.map((t) => [t, [...list.tables[t]].sort((a, b) => (a.id < b.id ? -1 : 1))]));
  return { ...list, tables: tables as Payload['tables'], settings: [...list.settings].sort((a, b) => (a.key < b.key ? -1 : 1)) };
}

describe('syncing only what changed (NFR-7)', () => {
  it('only reads the gist when neither it nor this device changed, without decrypting it', async () => {
    const config = await createList('good', 'correct horse', ACK);
    await repo.createTodo({ title: 'one' });
    const mark = await syncOnce(config);
    // The file's length, for Settings › Sync's file size (v1.4.3).
    expect(mark.chars).toBe(gh.file(config.gistId, 'mytasks.json')!.length);
    [gh.reads, gh.writes] = [0, 0];
    // A key that can't open the gist: a sync that decrypted it would fail.
    const wrongKey = await deriveKey('wrong', config.salt, config.iterations);
    expect(await syncOnce({ ...config, key: wrongKey, lastSync: mark })).toEqual({ ...mark, readAt: expect.any(String) });
    expect([gh.reads, gh.writes]).toEqual([1, 0]);
  });

  it('uploads a change here without merging, the same list a full merge gives', async () => {
    const config = await createList('good', 'correct horse', ACK);
    const keep = await repo.createTodo({ title: 'keep' });
    const gone = await repo.createTodo({ title: 'gone' });
    const mark = await syncOnce(config);
    const before = await gistList(config);
    await repo.updateTodoText(keep, { title: 'kept, edited' });
    await repo.deleteTodoForever(gone);
    await repo.createTodo({ title: 'new' });
    [gh.reads, gh.writes] = [0, 0];
    const next = await syncOnce({ ...config, lastSync: mark });
    expect([gh.reads, gh.writes]).toEqual([1, 1]);
    expect(await gistList(config)).toEqual(sorted(mergePayloads(await readLocal(), before).merged));
    // And the next sync finds nothing to do.
    expect(await syncOnce({ ...config, lastSync: next })).toEqual({ ...next, readAt: expect.any(String) });
    expect([gh.reads, gh.writes]).toEqual([2, 1]);
  });

  it('merges in full when another device changed the gist, and corrects a time later than now', async () => {
    const config = await createList('good', 'correct horse', ACK);
    const ahead = await repo.createTodo({ title: 'clock ahead' });
    const mark = await syncOnce(config);
    const mine = await readLocal();
    await newDevice();
    const other = await joinList('good', config.gistId, 'correct horse', ACK);
    await repo.createTodo({ title: 'from other device' });
    await syncOnce(other);
    // Back on the first device.
    await newDevice();
    await applyRemote({ tables: mine.tables, settings: mine.settings });
    expect((await syncOnce({ ...config, lastSync: mark })).iv).not.toBe(mark.iv);
    expect(await titles()).toEqual(['clock ahead', 'from other device']);
    // A time later than now, with the gist unchanged: the full sync corrects it.
    const next = await syncOnce(config);
    await db.todos.update(ahead, { modifiedAt: '2099-01-01T00:00:00.000Z' });
    await syncOnce({ ...config, lastSync: next });
    expect((await db.todos.get(ahead))!.modifiedAt < '2099').toBe(true);
  });
});

describe('the lost-change notice in a sync (FR-19.12)', () => {
  it('reports a title replaced by another device once, and nothing at the next sync', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-23T08:00:00Z'));
      const config = await createList('good', 'correct horse', ACK);
      const id = await repo.createTodo({ title: 'Buy milk' });
      const mark = await syncOnce(config);
      vi.setSystemTime(new Date('2026-11-23T09:00:00Z'));
      await repo.updateTodoText(id, { title: 'Milk' });
      const mine = await readLocal();
      // Another device changes the title later.
      await newDevice();
      const other = await joinList('good', config.gistId, 'correct horse', ACK);
      vi.setSystemTime(new Date('2026-11-23T10:00:00Z'));
      await repo.updateTodoText(id, { title: 'Oat milk' });
      await syncOnce(other);
      // Back on the first device, which syncs.
      await newDevice();
      await applyRemote({ tables: mine.tables, settings: mine.settings });
      vi.setSystemTime(new Date('2026-11-23T11:00:00Z'));
      const reported: unknown[] = [];
      const next = await syncOnce({ ...config, lastSync: mark }, undefined, (lost) => reported.push(...lost));
      expect(reported).toEqual([{ kind: 'todo', id, title: 'Oat milk', what: ['title'], deleted: false }]);
      expect(next.readAt).toBe('2026-11-23T11:00:00.000Z');
      // The next sync reports nothing more.
      reported.length = 0;
      await syncOnce({ ...config, lastSync: next }, undefined, (lost) => reported.push(...lost));
      expect(reported).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('changes waiting to sync (FR-19.13)', () => {
  it('counts records changed after the last sync read this device, deletions included', async () => {
    const count = (since: string) =>
      new Promise<number>((resolve) => {
        const stop = changesSince(since).subscribe((n) => n && (stop(), resolve(n)));
        setTimeout(() => (stop(), resolve(0)), 200);
      });
    const keep = await repo.createTodo({ title: 'keep' });
    const gone = await repo.createTodo({ title: 'gone' });
    await new Promise((r) => setTimeout(r, 5));
    const since = new Date().toISOString();
    expect(await count(since)).toBe(0);
    await new Promise((r) => setTimeout(r, 5));
    await repo.updateTodoText(keep, { title: 'kept, edited' });
    await repo.deleteTodoForever(gone);
    expect(await count(since)).toBe(2);
  });
});

describe('Settings › Sync (FR-19.6 to FR-19.8)', () => {
  let config: DeviceConfig;
  beforeEach(async () => {
    config = await createList('good', 'correct horse', ACK);
    sync.connected(config);
  });

  it('Change Passphrase: needs the current one; other devices then ask for the new one', async () => {
    await sync.syncNow();
    const mark = (await loadConfig())!.lastSync;
    expect(mark).toBeDefined();
    await expect(sync.changePassphrase('wrong', 'new passphrase')).rejects.toMatchObject({ code: 'wrong-passphrase' });
    await sync.changePassphrase('correct horse', 'new passphrase');
    // The next sync here is a full one (NFR-7).
    expect((await loadConfig())!.lastSync).toBeUndefined();
    // A device still holding the old key finds the gist re-encrypted, even from its last sync's mark.
    await expect(syncOnce({ ...config, lastSync: mark })).rejects.toMatchObject({ code: 'passphrase' });
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

  it('Change Token refuses a token from another GitHub account, or one that can’t reach the gist', async () => {
    gh.tokens.set('theirs', 'gist');
    gh.logins.set('theirs', 'someone-else');
    await expect(sync.changeToken('theirs')).rejects.toMatchObject({ code: 'otheraccount' });
    // A deleted gist can't be checked, so the token is refused too.
    gh.tokens.set('mine', 'gist');
    gh.gists.delete(config.gistId);
    await expect(sync.changeToken('mine')).rejects.toMatchObject({ code: 'unreachable' });
    expect((await loadConfig())!.token).toBe('good');
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

describe('a device coming back with an older copy (FR-3.5, FR-19.4)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs the return check after the sync, so what another device completed stays completed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-20T09:00:00'));
    const config = await createList('good', 'correct horse', ACK);
    const dated = await repo.createTodo({ title: 'starts tomorrow', start: 'unscheduled', startDate: '2026-11-21' });
    const daily = await repo.createTodo({ title: 'daily' });
    await repo.setRepeat(daily, {
      mode: 'fixed', unit: 'day', interval: 1, weekdays: [], days: [], month: null,
      endCount: null, endDate: null, made: 0, deadlineDays: null, paused: false,
    }, '2026-11-21');
    await syncOnce(config);
    // This device then sits unopened, keeping that copy.
    const older = await readLocal();
    // Next morning another device completes the dated task and the day's repeat copy.
    vi.setSystemTime(new Date('2026-11-21T09:00:00'));
    await repo.sweepRules();
    const copy = (await db.todos.toArray()).find((t) => t.repeatOf === daily)!;
    await repo.setTodoStatus(dated, 'completed');
    await repo.setTodoStatus(copy.id, 'completed');
    await syncOnce(config);
    // That evening this device comes back with its older copy.
    await adoptRemote(older);
    vi.setSystemTime(new Date('2026-11-21T18:00:00'));
    sync.connected(config);
    await returnCheck();
    expect((await db.todos.get(dated))!.status).toBe('completed');
    expect((await db.todos.get(copy.id))!.status).toBe('completed');
    // The gist keeps the completions too.
    await newDevice();
    await syncOnce(await joinList('good', config.gistId, 'correct horse', ACK));
    expect((await db.todos.get(dated))!.status).toBe('completed');
    expect((await db.todos.get(copy.id))!.status).toBe('completed');
  });

  it('at launch, waits for the settings to be read and joins the launch sync', async () => {
    await createList('good', 'correct horse', ACK);
    const reads = gh.reads;
    const engine = new SyncEngine();
    void engine.start();
    await engine.settled();
    expect(engine.status).toBe('synced');
    expect(gh.reads).toBe(reads + 1);
    // Not connected: nothing to wait for.
    await expect(new SyncEngine().settled()).resolves.toBeUndefined();
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
    // With changes waiting to sync (FR-19.13).
    expect(syncMessage('offline', null, null, 1)).toBe('Offline · 1 change not synced');
    expect(syncMessage('offline', null, null, 3)).toBe('Offline · 3 changes not synced');
    expect(syncMessage('error', 'token')).toBe('Sync error — token rejected');
    expect(syncMessage('error', 'passphrase')).toBe('Passphrase changed');
  });
});
