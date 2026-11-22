/**
 * Unscheduled's limit per group (FR-23.1): the helper that cuts a group, and
 * the setting that holds the limit (default 3, null for All), which syncs.
 */
import { describe, expect, it } from 'vitest';
import { limitTodos } from '../src/lib/model/lists';
import { DEFAULT_SETTINGS, readSettings } from '../src/lib/model/settings';
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
