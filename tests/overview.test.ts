/**
 * Settings › Sync's "In your gist" overview (v1.4.3): counts by state, and
 * the file size line.
 */
import { describe, expect, it } from 'vitest';
import { fileSizeText, stateCounts } from '../src/lib/model/overview';
import { project, todo } from './helpers';

describe('the overview', () => {
  it('counts open, completed (canceled too), in the Trash and deleted', () => {
    const at = '2026-11-01T12:00:00.000Z';
    const rows = [
      todo(),
      todo({ status: 'completed', completedAt: at }),
      todo({ status: 'canceled', completedAt: at, loggedAt: at }),
      todo({ trashedAt: at }),
      todo({ status: 'completed', trashedAt: at }),
      todo({ deletedAt: at }),
    ];
    expect(stateCounts(rows)).toEqual({ open: 1, completed: 2, trash: 2, deleted: 1 });
    expect(stateCounts([project(), project({ deletedAt: at })])).toEqual({ open: 1, completed: 0, trash: 0, deleted: 1 });
  });

  it('gives the file size against the 5 MB limit', () => {
    expect(fileSizeText(420_000)).toBe('0.4 MB of 5 MB');
    expect(fileSizeText(2_000)).toBe('under 0.1 MB of 5 MB');
  });
});
