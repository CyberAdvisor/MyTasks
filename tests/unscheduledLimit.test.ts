/**
 * Unscheduled's limit per group (FR-23.1): the helper that cuts a group, and
 * the setting that holds the limit (default 3, null for All), which syncs.
 */
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { MyTasksDB, SCHEMA_VERSION } from '../src/lib/db/database';
import { limitTodos } from '../src/lib/model/lists';
import { DEFAULT_SETTINGS, readSettings } from '../src/lib/model/settings';
import { checkList } from '../src/lib/sync/cycle';
import { isValidSetting } from '../src/lib/sync/validate';

describe('limitTodos', () => {
  it('cuts a group to the limit and says how many more there are', () => {
    expect(limitTodos([1, 2, 3, 4, 5], 3)).toEqual({ shown: [1, 2, 3], more: 2 });
  });
  it('leaves a group that fits, or when there is no limit', () => {
    expect(limitTodos([1, 2, 3], 3)).toEqual({ shown: [1, 2, 3], more: 0 });
    expect(limitTodos([1, 2, 3, 4], null)).toEqual({ shown: [1, 2, 3, 4], more: 0 });
    expect(limitTodos([], 1)).toEqual({ shown: [], more: 0 });
  });
});

describe('the Unscheduled setting', () => {
  it('defaults to 3', () => {
    expect(DEFAULT_SETTINGS.unscheduledLimit).toBe(3);
    expect(readSettings([]).unscheduledLimit).toBe(3);
  });
  it('keeps a listed choice, All included, and ignores anything else', () => {
    const read = (value: unknown) => readSettings([{ key: 'unscheduledLimit', value, modifiedAt: '' } as never]).unscheduledLimit;
    expect(read(10)).toBe(10);
    expect(read(null)).toBeNull();
    expect(read(4)).toBe(3);
    expect(read('5')).toBe(3);
  });
  it('syncs: the checks take a listed choice and refuse others', () => {
    expect(isValidSetting({ key: 'unscheduledLimit', value: 1 })).toBe(true);
    expect(isValidSetting({ key: 'unscheduledLimit', value: null })).toBe(true);
    expect(isValidSetting({ key: 'unscheduledLimit', value: 7 })).toBe(false);
  });
});

describe('schema 12, for the Unscheduled setting', () => {
  const tables = { areas: [], projects: [], headings: [], todos: [], checklistItems: [], tags: [], contexts: [], savedSearches: [] };

  it('upgrades a list from version 11, so an older app asks to be updated rather than failing a newer one', () => {
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(12);
    expect(checkList({ app: 'mytasks', schema: 11, tables, settings: [] })).toMatchObject({ schema: SCHEMA_VERSION, upgradedFrom: 11 });
  });

  it('upgrades a version-11 database with data in it, its settings kept', async () => {
    const name = 'upgrade-to-12';
    const old = new Dexie(name);
    old.version(11).stores({
      areas: 'id, sortKey',
      projects: 'id, areaId, status, sortKey',
      headings: 'id, projectId, sortKey',
      todos: 'id, projectId, areaId, headingId, status, startDate, deadline, sortKey, contextId',
      checklistItems: 'id, todoId, sortKey',
      tags: 'id, parentTagId, sortKey',
      savedSearches: 'id, sortKey',
      changeLog: '++seq, entity, entityId, at',
      settings: 'key',
      contexts: 'id, sortKey',
    });
    await old.open();
    await old.table('todos').add({ id: 't', title: 'Kept' });
    await old.table('settings').add({ key: 'todayGrouping', value: 'project' });
    old.close();

    const upgraded = new MyTasksDB(name);
    await upgraded.open();
    expect(upgraded.verno).toBe(SCHEMA_VERSION);
    expect(await upgraded.todos.get('t')).toEqual({ id: 't', title: 'Kept', ft: {} });
    expect(readSettings(await upgraded.settings.toArray())).toMatchObject({ todayGrouping: 'project', unscheduledLimit: 3 });
    upgraded.close();
    await Dexie.delete(name);
  });
});
