/**
 * The gists on this device (FR-19.15, FR-19.16), for the gist band, the
 * switcher and Settings › Sync › Your gists.
 *
 * The active gist's name and colour come from its synced setting, so a
 * rename shows at once and a rename on another device after its next sync.
 * Other gists show the name and colour they had when last open here, kept
 * with their entry on the device (sync/device.ts, `saveLabel`): only the
 * active gist syncs.
 */
import { liveQuery } from 'dexie';
import { db } from '../db/database';
import { listGists, saveLabel, type GistSummary } from '../sync/device';
import { activeDbName } from './active';
import { cleanGistLabel, gistName, type GistLabel } from '../model/settings';

class DeviceGists {
  /** Every gist on the device, in database-name order; the active one with its current label. */
  list = $state<GistSummary[]>([]);

  /** Read the list again, after a gist is added or removed. */
  async refresh(): Promise<void> {
    this.list = await listGists();
  }

  /**
   * The active gist's name or colour changed (a rename, here or synced in):
   * keep it with the gist's entry and in the list.
   */
  async labelChanged(label: GistLabel): Promise<void> {
    const changed = await saveLabel(label);
    if (changed || !this.list.length) await this.refresh();
  }

  /**
   * While the active gist is connected: read the list, then follow its
   * `gistLabel` setting. A database with no such setting yet (a gist just
   * added, before its first sync) keeps the label its entry has. Returns
   * the function that stops.
   */
  watch(): () => void {
    void this.refresh();
    const sub = liveQuery(() => db.settings.get('gistLabel')).subscribe({
      next: (row) => {
        if (row) void this.labelChanged(cleanGistLabel(row.value));
      },
      error: (e) => console.error('Gist name query failed', e),
    });
    return () => sub.unsubscribe();
  }

  /** The active gist's entry. */
  get active(): GistSummary | undefined {
    const db = activeDbName();
    return this.list.find((g) => g.db === db);
  }

  /** The gists other than the active one. */
  get others(): GistSummary[] {
    const db = activeDbName();
    return this.list.filter((g) => g.db !== db);
  }

  /** The names this device's other gists show, for the name rules (`gistNameProblem`). */
  otherNames(): string[] {
    return this.others.map((g) => gistName(g.label));
  }

  /** The names every gist on this device shows: what a gist being added must differ from. */
  names(): string[] {
    return this.list.map((g) => gistName(g.label));
  }
}

export const deviceGists = new DeviceGists();
