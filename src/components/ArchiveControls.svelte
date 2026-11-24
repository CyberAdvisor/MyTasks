<!--
  Settings › Archive's controls (FR-12.11): completed items older than a
  number of days (90 by default) are saved to a new CSV file in the import
  format, then removed for good, after a confirmation. The file is saved
  first; if the share sheet is dismissed, nothing is removed. Messages go to
  the section through onmessage and onerror, as ImportButton's do.
-->
<script lang="ts">
  import ChoiceDialog from './ChoiceDialog.svelte';
  import * as repo from '../lib/db/repo';
  import { today } from '../lib/model/dates';
  import { archiveCounts, archiveCsv, archiveCutoff, archiveFileName, longDate, selectArchive, type ArchiveSelection } from '../lib/archive';
  import type { Existing } from '../lib/import/plan';
  import { saveFile } from '../lib/saveFile';
  import { settings } from '../lib/state/live';

  let { onmessage, onerror }: { onmessage: (text: string) => void; onerror: (text: string) => void } = $props();

  /** Days, as typed; checked when Archive… is pressed. */
  let days = $state('90');
  let busy = $state(false);
  /** A selection waiting for its confirmation, with the records the file names. Raw: never edited. */
  let pending = $state.raw<{ sel: ArchiveSelection; live: Existing } | null>(null);

  async function onArchive() {
    onmessage('');
    onerror('');
    const n = Number(days);
    if (!/^\d+$/.test(days.trim()) || n < 1) {
      onerror('Enter a number of days, 1 or more.');
      return;
    }
    const live = await repo.importExisting();
    const sel = selectArchive(live, archiveCutoff(today(), n));
    if (!sel.todos.length && !sel.projects.length) onmessage(`Nothing completed before ${longDate(sel.before)}.`);
    else pending = { sel, live };
  }

  async function onChoose(v: string | null) {
    const p = pending;
    pending = null;
    if (v !== 'archive' || !p) return;
    busy = true;
    try {
      const name = archiveFileName(today(), $settings.gistLabel);
      const saved = await saveFile(new File([archiveCsv(p.sel, p.live)], name, { type: 'text/csv' }));
      if (saved === 'dismissed') {
        onmessage('Nothing was archived: the file wasn’t saved.');
        return;
      }
      await repo.archiveItems(p.sel);
      onmessage(
        saved === 'shared'
          ? `Archived ${archiveCounts(p.sel)} to ${name}. Choose Save to Files to keep it.`
          : `Archived ${archiveCounts(p.sel)}. File downloaded: ${name}`,
      );
    } catch {
      onerror('Archiving didn’t finish. Nothing was removed unless its file was saved; try again.');
    } finally {
      busy = false;
    }
  }
</script>

<div class="archive-row">
  <label for="archive-days">Archive items completed more than</label>
  <input id="archive-days" type="text" inputmode="numeric" size="4" bind:value={days} />
  <span>days ago</span>
  <button type="button" class="outline" disabled={busy} onclick={onArchive}>{busy ? 'Archiving…' : 'Archive…'}</button>
</div>

{#if pending}
  <ChoiceDialog
    title={`Archive ${archiveCounts(pending.sel)}?`}
    message={`They were completed before ${longDate(pending.sel.before)}.`}
    points={[
      `They’re saved to a new file, ${archiveFileName(today(), $settings.gistLabel)}, then removed from My Tasks on every device.`,
      'This can’t be undone in My Tasks: keep the file. Import… can bring them back from it.',
    ]}
    choices={[{ label: 'Archive', value: 'archive', danger: true }]}
    onchoose={onChoose}
  />
{/if}

<style>
  .archive-row {
    display: flex;
    font-size: 14px;
    margin: 4px 0 2px;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .archive-row input {
    width: 4em;
    text-align: right;
  }
</style>
