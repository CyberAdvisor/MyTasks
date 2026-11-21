/**
 * Settings › Sync's "In your gist" overview (v1.4.3): how many tasks and
 * projects are open, completed (or canceled, moved to Completed or not), in
 * the Trash, and deleted (tombstones, cleared after 180 days). Counted from
 * this device's copy, which is the gist's as of the last sync.
 */
import { MAX_FILE_CHARS } from '../sync/crypto';
import type { Project, Todo } from './types';

export interface StateCounts {
  open: number;
  completed: number;
  trash: number;
  deleted: number;
}

/** Count records, tombstones included. */
export function stateCounts(rows: (Todo | Project)[]): StateCounts {
  const c: StateCounts = { open: 0, completed: 0, trash: 0, deleted: 0 };
  for (const r of rows) {
    if (r.deletedAt) c.deleted++;
    else if (r.trashedAt) c.trash++;
    else if (r.status === 'open') c.open++;
    else c.completed++;
  }
  return c;
}

/** "0.4 MB of 5 MB", from the gist file's length; under 0.1 MB says so. */
export function fileSizeText(chars: number): string {
  const mb = chars / (1024 * 1024);
  const limit = MAX_FILE_CHARS / (1024 * 1024);
  return `${mb < 0.1 ? 'under 0.1' : mb.toFixed(1)} MB of ${limit} MB`;
}
