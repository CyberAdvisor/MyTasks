/**
 * Security review fix 4 (0.9.0): every record and setting is checked field by
 * field before it is merged or uploaded (sync/validate.ts); a gist file must
 * use the app's PBKDF2 count, a 16-byte salt and a 12-byte IV, and be at most
 * 5 MB; new passphrases need at least 12 characters.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, SCHEMA_VERSION } from '../src/lib/db/database';
import * as repo from '../src/lib/db/repo';
import { clearUndo } from '../src/lib/db/history';
import { DEFAULT_SETTINGS } from '../src/lib/model/settings';
import type { EntityName } from '../src/lib/model/types';
import { KDF_ITERATIONS, MAX_FILE_CHARS, MIN_PASSPHRASE, deriveKey, newSalt, parseEnvelope, seal } from '../src/lib/sync/crypto';
import { SyncError, envelopeOf, openPayload, sealPayload } from '../src/lib/sync/cycle';
import { clearConfig } from '../src/lib/sync/device';
import { readGist } from '../src/lib/sync/github';
import { readLocal } from '../src/lib/sync/local';
import { PASSPHRASE_TIP } from '../src/lib/sync/messages';
import { SYNCED_SETTINGS, SYNCED_TABLES, isPayload, type Payload } from '../src/lib/sync/payload';
import { isValidRecord, isValidSetting } from '../src/lib/sync/validate';
import { FakeGitHub } from './fakeGitHub';

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

/** One of every kind of record, made by the app's own functions, with every optional field set. */
async function fullList(): Promise<Payload> {
  const area = await repo.createArea('Home');
  const tag = await repo.createTag('Errand');
  const context = await repo.createContext('Phone');
  const project = await repo.createProject({ title: 'Move', notes: 'n', areaId: area, deadline: '2026-12-01', tagIds: [tag] });
  const heading = await repo.createHeading(project, 'Packing');
  const t = await repo.createTodo({ title: 'Boxes', projectId: project, headingId: heading, notes: 'big ones', tagIds: [tag] });
  await repo.setWhen(t, { kind: 'today' });
  await repo.setDeadline(t, '2026-11-20');
  await repo.setPriority(t, 3);
  await repo.setContext(t, context);
  await repo.addChecklistItems(t, ['tape', 'marker']);
  const done = await repo.createTodo({ title: 'Done one', areaId: area });
  await repo.setTodoStatus(done, 'completed');
  const gone = await repo.createTodo({ title: 'Secret' });
  await repo.setTodoTrashed(gone, true);
  await repo.emptyTrash();
  await repo.createSavedSearch({ title: 'Calls', query: 'call', tagIds: [tag], contextId: context });
  await repo.setSetting('priorityLabels', ['Now', 'Soon', 'Later', 'Maybe', 'Someday']);
  await repo.setSetting('todayGrouping', 'context');
  await repo.setSetting('autoP1', false);
  return readLocal();
}

/** The first live record of `table` in a payload. */
function first(p: Payload, table: EntityName): Record<string, unknown> {
  return p.tables[table].find((r) => !r.deletedAt) as unknown as Record<string, unknown>;
}

/** A copy of `p` with one change made to the first live record of `table`. */
function withRecord(p: Payload, table: EntityName, change: (r: Record<string, unknown>) => void): Payload {
  const copy = structuredClone(p);
  change(first(copy, table));
  return copy;
}

describe('records and settings, field by field', () => {
  it('passes everything the app itself writes, in every table', async () => {
    const p = await fullList();
    for (const t of SYNCED_TABLES) expect(p.tables[t].length, t).toBeGreaterThan(0);
    expect(p.tables.todos.some((r) => r.deletedAt)).toBe(true);
    expect(isPayload(p)).toBe(true);
  });

  it('refuses a field of the wrong type', async () => {
    const p = await fullList();
    expect(isPayload(withRecord(p, 'todos', (r) => (r.title = 42)))).toBe(false);
    expect(isPayload(withRecord(p, 'todos', (r) => (r.tagIds = { evil: true })))).toBe(false);
    expect(isPayload(withRecord(p, 'todos', (r) => (r.priority = 9)))).toBe(false);
    expect(isPayload(withRecord(p, 'todos', (r) => (r.status = 'done')))).toBe(false);
    expect(isPayload(withRecord(p, 'todos', (r) => (r.deadline = 'tomorrow')))).toBe(false);
    expect(isPayload(withRecord(p, 'projects', (r) => (r.completedAt = 'yesterday')))).toBe(false);
    expect(isPayload(withRecord(p, 'checklistItems', (r) => (r.completed = 'yes')))).toBe(false);
    expect(isPayload(withRecord(p, 'areas', (r) => (r.collapsed = 1)))).toBe(false);
    expect(isPayload({ ...p, settings: [...p.settings, { key: 'autoP1', value: 'yes' }] })).toBe(false);
    expect(isPayload({ ...p, settings: [...p.settings, { key: 'theme', value: 'dark' }] })).toBe(false);
  });

  it('refuses a missing field and a field it does not know', async () => {
    const p = await fullList();
    expect(isPayload(withRecord(p, 'todos', (r) => delete r.notes))).toBe(false);
    expect(isPayload(withRecord(p, 'headings', (r) => delete r.createdAt))).toBe(false);
    expect(isPayload(withRecord(p, 'tags', (r) => (r.html = '<script>')))).toBe(false);
  });

  it('checks deleted records on id, deletedAt and modifiedAt, and lets the merge drop anything else', () => {
    const at = '2026-11-13T10:00:00.000Z';
    expect(isValidRecord('todos', { id: 'x', deletedAt: at, modifiedAt: at })).toBe(true);
    // Written by 0.7.1 or earlier: the leftover content is stripped by the merge, never applied.
    expect(isValidRecord('todos', { id: 'x', deletedAt: at, modifiedAt: at, title: 'old' })).toBe(true);
    expect(isValidRecord('todos', { id: 'x', deletedAt: 'soon', modifiedAt: at })).toBe(false);
    expect(isValidRecord('todos', { id: '', deletedAt: at, modifiedAt: at })).toBe(false);
    expect(isValidRecord('todos', { id: 'x', modifiedAt: at })).toBe(false);
  });

  it('accepts every synced setting with its default value, and nothing else', () => {
    for (const key of SYNCED_SETTINGS) expect(isValidSetting({ key, value: DEFAULT_SETTINGS[key] }), key).toBe(true);
    expect(isValidSetting({ key: 'theme', value: 'dark' })).toBe(false);
    expect(isValidSetting({ key: 'autoP1', value: 'yes' })).toBe(false);
    expect(isValidSetting({ key: 'priorityLabels', value: ['a', 'b'] })).toBe(false);
    expect(isValidSetting({ key: 'todayGrouping', value: 'random' })).toBe(false);
    expect(isValidSetting({ key: 'autoP1', value: true, modifiedAt: 'now' })).toBe(false);
    expect(isValidSetting({ key: 'autoP1', value: true, extra: 1 })).toBe(false);
    expect(isValidSetting({ key: 'constructor', value: true })).toBe(false);
  });

  it('never applies a gist with a bad record, and never uploads one', async () => {
    const p = await fullList();
    const key = await deriveKey('a long passphrase', newSalt());
    const salt = newSalt();
    const bad = withRecord(p, 'todos', (r) => (r.title = { not: 'text' }));
    const env = await seal(key, { salt, iterations: KDF_ITERATIONS }, JSON.stringify(bad), '2026-11-13T10:00:00.000Z');
    await expect(openPayload(key, env, 'wrong-passphrase')).rejects.toMatchObject({ code: 'malformed' });
    await expect(sealPayload({ key, salt, iterations: KDF_ITERATIONS }, bad)).rejects.toMatchObject({ code: 'invalid' });
  });
});

describe('the gist file envelope', () => {
  /** A valid envelope's text, with `change` applied to its parsed form. */
  async function envelope(change: (e: Record<string, any>) => void = () => {}): Promise<string> {
    const key = await deriveKey('a long passphrase', newSalt());
    const p: Payload = { ...(await readLocal()), schema: SCHEMA_VERSION };
    const e = (await seal(key, { salt: newSalt(), iterations: KDF_ITERATIONS }, JSON.stringify(p), '2026-11-13T10:00:00.000Z')) as unknown as Record<string, any>;
    change(e);
    return JSON.stringify(e);
  }

  it('accepts the app’s own file', async () => {
    expect(parseEnvelope(await envelope())).not.toBeNull();
  });

  it('accepts only the app’s PBKDF2 iteration count', async () => {
    expect(parseEnvelope(await envelope((e) => (e.kdf.iterations = 1)))).toBeNull();
    expect(parseEnvelope(await envelope((e) => (e.kdf.iterations = 10_000_000)))).toBeNull();
  });

  it('accepts only a 16-byte salt and a 12-byte IV, and base64 data', async () => {
    expect(parseEnvelope(await envelope((e) => (e.kdf.salt = btoa('x'.repeat(15)))))).toBeNull();
    expect(parseEnvelope(await envelope((e) => (e.cipher.iv = btoa('x'.repeat(16)))))).toBeNull();
    expect(parseEnvelope(await envelope((e) => (e.data = 'not base64!')))).toBeNull();
    expect(parseEnvelope(await envelope((e) => (e.data = '')))).toBeNull();
  });

  it('refuses a file over 5 MB', async () => {
    const big = await envelope((e) => (e.padding = 'x'.repeat(MAX_FILE_CHARS)));
    expect(parseEnvelope(big)).toBeNull();
    expect(() => envelopeOf(big)).toThrow(SyncError);
  });

  it('doesn’t fetch a long gist file in full when GitHub says it is over 5 MB', async () => {
    const id = gh.add({ 'mytasks.json': 'x'.repeat(50) });
    gh.truncateOver = 10;
    gh.sizeOverride = MAX_FILE_CHARS + 1;
    const content = await readGist('good', id);
    expect(gh.rawFetches).toBe(0);
    expect(parseEnvelope(content!)).toBeNull();
  });
});

describe('new passphrases', () => {
  it('need at least 12 characters, with a tip that says so', () => {
    expect(MIN_PASSPHRASE).toBe(12);
    expect(PASSPHRASE_TIP).toMatch(/^Use at least 12 characters\./);
  });
});
