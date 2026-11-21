/** Failed saves (review C1): which unhandled rejections are shown to the user. */
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { failureKind } from '../src/lib/db/failures';
import { TaskLimitError } from '../src/lib/model/limits';

describe('failureKind', () => {
  it('names a refused add at the task limit', () => {
    expect(failureKind(new TaskLimitError(5000, 1))).toBe('limit');
  });

  it('names storage full, from the browser or from Dexie', () => {
    expect(failureKind(new DOMException('No room', 'QuotaExceededError'))).toBe('storageFull');
    expect(failureKind(new Dexie.QuotaExceededError('No room'))).toBe('storageFull');
    // Dexie reports a transaction aborted by a full disk as AbortError, with the cause inside.
    const aborted = new Dexie.AbortError('Aborted', new DOMException('No room', 'QuotaExceededError'));
    expect(failureKind(aborted)).toBe('storageFull');
  });

  it('names any other Dexie error a database failure', () => {
    expect(failureKind(new Dexie.DatabaseClosedError())).toBe('database');
    expect(failureKind(new Dexie.PrematureCommitError())).toBe('database');
    expect(failureKind(new Dexie.AbortError('Aborted'))).toBe('database');
  });

  it('leaves everything else alone', () => {
    expect(failureKind(new Error('boom'))).toBe('other');
    expect(failureKind(new DOMException('Gone', 'AbortError'))).toBe('other');
    expect(failureKind('text')).toBe('other');
    expect(failureKind(undefined)).toBe('other');
  });
});
