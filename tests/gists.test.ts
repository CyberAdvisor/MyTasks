/**
 * Several gists on a device (FR-19.11) and gist names (FR-19.14): the device's
 * list of gists, a task database per gist, what is per gist and what per
 * device, the name rules, switching, and the upgrade from 1.10.5.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { MyTasksDB, SCHEMA_VERSION, db } from '../src/lib/db/database';
import { FIRST_DB, activeDbName, dbNameFor, perGistKey, setActiveDbName } from '../src/lib/gists/active';
import {
  addGist,
  clearConfig,
  freeDbName,
  listGists,
  loadCalendarFile,
  loadConfig,
  saveCalendarFile,
  saveConfig,
  saveLabel,
  type DeviceConfig,
} from '../src/lib/sync/device';
import { DEFAULT_SETTINGS, cleanGistLabel, gistName, gistNameProblem, readSettings } from '../src/lib/model/settings';
import { isValidSetting } from '../src/lib/sync/validate';
import { upgradeList } from '../src/lib/db/migrations';
import { adoptOldTheme } from '../src/lib/state/theme';
import { SyncEngine } from '../src/lib/sync/sync.svelte';

/** The name and colour Add Gist… gives the second gist. */
const TWO = { name: 'Two', colour: 'teal' } as const;
const DEFAULT = DEFAULT_SETTINGS.gistLabel;

/** A gist's settings as Setup saves them; the key is a stand-in (never used to encrypt here). */
function config(gistId: string): DeviceConfig {
  return { token: 'tok', gistId, salt: 'c2FsdA==', iterations: 600_000, key: {} as CryptoKey, lastSyncedAt: null };
}

// These run first, before anything in this file opens `mytasks-device`, so the
// device database is still at version 1 when the module first reads it.
describe('upgrading from 1.10.5', () => {
  it('keeps the tasks, the gist and the theme; the gist shows as Default', async () => {
    // 1.10.5's device database: one gist's settings and its calendar file.
    const v1 = new Dexie('mytasks-device');
    v1.version(1).stores({ config: 'id' });
    await v1.table('config').bulkPut([
      { id: 'sync', ...config('gist-1'), lastSyncedAt: '2026-11-23T10:00:00.000Z' },
      { id: 'calendar', file: 'ENCRYPTED' },
    ]);
    v1.close();
    // 1.10.5's task database, at schema 13, with a task and the theme row.
    const old = new Dexie(FIRST_DB);
    old.version(13).stores({
      areas: 'id, sortKey',
      projects: 'id, areaId, status, sortKey',
      headings: 'id, projectId, sortKey',
      todos: 'id, projectId, areaId, headingId, status, startDate, deadline, sortKey, contextId',
      checklistItems: 'id, todoId, sortKey',
      tags: 'id, parentTagId, sortKey',
      contexts: 'id, sortKey',
      savedSearches: 'id, sortKey',
      changeLog: '++seq, entity, entityId, at',
      settings: 'key',
    });
    await old.table('todos').put({ id: 'kept', title: 'Kept through the update', status: 'open', sortKey: 'a0', deletedAt: null });
    await old.table('settings').put({ key: 'theme', value: 'dark' });
    old.close();
    localStorage.clear();

    expect(activeDbName()).toBe(FIRST_DB);
    expect(await loadConfig()).toMatchObject({ gistId: 'gist-1', lastSyncedAt: '2026-11-23T10:00:00.000Z' });
    expect(await loadCalendarFile()).toBe('ENCRYPTED');
    expect(await listGists()).toEqual([{ db: FIRST_DB, gistId: 'gist-1', label: DEFAULT }]);

    await db.open();
    expect(db.name).toBe(FIRST_DB);
    expect(db.verno).toBe(SCHEMA_VERSION);
    expect((await db.todos.get('kept'))?.title).toBe('Kept through the update');
    expect(gistName(readSettings(await db.settings.toArray()).gistLabel)).toBe('Default');
    await adoptOldTheme();
    expect(localStorage.getItem('mytasks.theme')).toBe('dark');
  });
});

describe('the device’s gists (FR-19.11)', () => {
  beforeEach(async () => {
    localStorage.clear();
    for (const g of await listGists()) {
      setActiveDbName(g.db);
      await clearConfig();
    }
    setActiveDbName(FIRST_DB);
  });

  it('keeps one entry per gist; each function works on the active one', async () => {
    await saveConfig(config('one'));
    await saveCalendarFile('CAL-ONE');
    await addGist(dbNameFor('two'), config('two'), TWO);
    expect(await listGists()).toEqual([
      { db: FIRST_DB, gistId: 'one', label: DEFAULT },
      { db: 'mytasks-two', gistId: 'two', label: TWO },
    ]);
    // The open gist's name is kept with its entry (FR-19.15); saving the settings again keeps it and the calendar file.
    expect(await saveLabel({ name: 'Work', colour: 'blue' })).toBe(true);
    expect(await saveLabel({ name: 'Work', colour: 'blue' })).toBe(false);
    await saveConfig({ ...config('one'), token: 'new' });
    expect(await loadCalendarFile()).toBe('CAL-ONE');
    expect((await listGists())[0].label).toEqual({ name: 'Work', colour: 'blue' });

    setActiveDbName('mytasks-two');
    expect((await loadConfig())?.gistId).toBe('two');
    expect(await loadCalendarFile()).toBeNull();
    await clearConfig();
    expect(await listGists()).toEqual([{ db: FIRST_DB, gistId: 'one', label: { name: 'Work', colour: 'blue' } }]);
  });

  it('refuses a gist already on the device, and a name that isn’t a task database', async () => {
    await saveConfig(config('one'));
    await expect(addGist(dbNameFor('again'), config('one'), TWO)).rejects.toThrow('already on this device');
    await expect(addGist('other', config('x'), TWO)).rejects.toThrow('Not a task database');
  });

  it('gives each gist its own task database', async () => {
    const a = new MyTasksDB(FIRST_DB);
    const b = new MyTasksDB(dbNameFor('two'));
    await a.todos.put({ id: 'only-a', title: 'A' } as never);
    expect(await b.todos.get('only-a')).toBeUndefined();
    expect(b.name).toBe('mytasks-two');
    a.close();
    b.close();
  });

  it('keeps the focused area per gist; the first gist keeps its old key', () => {
    expect(perGistKey('mytasks.focusArea', FIRST_DB)).toBe('mytasks.focusArea');
    expect(perGistKey('mytasks.focusArea', 'mytasks-abc123')).toBe('mytasks.focusArea.abc123');
  });

  it('switching needs a gist on the device and makes it active', async () => {
    await saveConfig(config('one'));
    await addGist(dbNameFor('two'), config('two'), TWO);
    const engine = new SyncEngine();
    await expect(engine.switchTo('mytasks-elsewhere')).rejects.toThrow('isn’t on this device');
    await engine.switchTo('mytasks-two');
    expect(activeDbName()).toBe('mytasks-two');
  });

  it('disconnecting one gist makes another active; the last returns to Setup', async () => {
    await saveConfig(config('one'));
    await addGist(dbNameFor('two'), config('two'), TWO);
    await new SyncEngine().disconnect();
    expect(await listGists()).toEqual([{ db: 'mytasks-two', gistId: 'two', label: TWO }]);
    expect(activeDbName()).toBe('mytasks-two');
    await new SyncEngine().disconnect();
    expect(await listGists()).toEqual([]);
    // Back on the first database, so the next gist set up here never keeps the last one's name (v1.11.4).
    expect(activeDbName()).toBe(FIRST_DB);
  });

  it('a gist being added gets a free database name, even where Setup kept an old gist\'s name (v1.11.4)', async () => {
    expect(await freeDbName('x')).toBe('mytasks-x');
    // Before 1.11.4: the last gist, x, disconnected, then Setup with y stored y under x's name.
    setActiveDbName(dbNameFor('x'));
    await saveConfig(config('y'));
    expect(await freeDbName('x')).toBe('mytasks-xx2');
    await addGist(await freeDbName('x'), config('x'), TWO);
    expect(await listGists()).toEqual([
      { db: 'mytasks-x', gistId: 'y', label: DEFAULT },
      { db: 'mytasks-xx2', gistId: 'x', label: TWO },
    ]);
  });
});

describe('gist names (FR-19.14)', () => {
  it('a gist with no name shows as Default, in grey', () => {
    expect(DEFAULT_SETTINGS.gistLabel).toEqual({ name: null, colour: 'grey' });
    expect(gistName(readSettings([]).gistLabel)).toBe('Default');
    expect(gistName({ name: 'Work', colour: 'blue' })).toBe('Work');
  });

  it('requires a name of at most 24 characters, different from the device’s others', () => {
    expect(gistNameProblem('  ', [])).toBe('Enter a name.');
    expect(gistNameProblem('x'.repeat(25), [])).toBe('Use at most 24 characters.');
    expect(gistNameProblem('x'.repeat(24), [])).toBeNull();
    expect(gistNameProblem(' work ', ['Default', 'Work'])).toBe('“work” is already used on this device.');
    expect(gistNameProblem('Personal', ['Default', 'Work'])).toBeNull();
  });

  it('syncs as a checked setting, and a damaged one reads as the default', () => {
    expect(isValidSetting({ key: 'gistLabel', value: { name: 'Work', colour: 'teal' } })).toBe(true);
    expect(isValidSetting({ key: 'gistLabel', value: { name: null, colour: 'grey' } })).toBe(true);
    expect(isValidSetting({ key: 'gistLabel', value: { name: 'Work', colour: 'pink' } })).toBe(false);
    expect(isValidSetting({ key: 'gistLabel', value: { name: '', colour: 'teal' } })).toBe(false);
    expect(isValidSetting({ key: 'gistLabel', value: { name: 'x'.repeat(25), colour: 'teal' } })).toBe(false);
    expect(isValidSetting({ key: 'gistLabel', value: { name: 'Work', colour: 'teal', extra: 1 } })).toBe(false);
    expect(cleanGistLabel({ name: 'Work', colour: 'pink' })).toEqual({ name: 'Work', colour: 'grey' });
    expect(cleanGistLabel('Work')).toEqual({ name: null, colour: 'grey' });
  });

  it('a gist list from schema 13 upgrades to 14 unchanged', () => {
    const tables = { areas: [], projects: [], headings: [], todos: [], checklistItems: [], tags: [], contexts: [], savedSearches: [] };
    expect(upgradeList({ app: 'mytasks', schema: 13, tables, settings: [] }, 14)).toMatchObject({ schema: 14, tables, settings: [] });
  });
});
