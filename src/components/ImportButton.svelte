<!--
  Import… in Settings › Import From Other Apps (FR-12.6): pick a CSV file in
  the template's format (FR-12.9), check it completely, preview what it adds,
  then add it in one undo step. Messages go to the section through onmessage
  and onerror, so they show under its button.
-->
<script lang="ts">
  import ChoiceDialog from './ChoiceDialog.svelte';
  import * as repo from '../lib/db/repo';
  import { TaskLimitError, limitRefusal } from '../lib/model/limits';
  import { importProblem, planCounts, planMatches, prepareImport, type PreparedImport } from '../lib/import';
  import { ui } from '../lib/state/ui.svelte';

  let {
    disabled = false,
    onmessage,
    onerror,
  }: {
    disabled?: boolean;
    onmessage: (text: string) => void;
    onerror: (text: string) => void;
  } = $props();

  let input: HTMLInputElement;
  let busy = $state(false);
  /** A checked file waiting for the preview's Import. Raw: its records aren't edited. */
  let pending = $state.raw<(PreparedImport & { name: string }) | null>(null);

  async function onPicked() {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    onmessage('');
    onerror('');
    try {
      pending = { ...(await prepareImport(await file.text())), name: file.name };
    } catch (e) {
      onerror(importProblem(e));
    }
  }

  async function onChoose(v: string | null) {
    const prepared = pending;
    pending = null;
    if (v !== 'import' || !prepared) return;
    busy = true;
    try {
      const plan = await repo.importRows(prepared.rows);
      const counts = planCounts(plan);
      onmessage(`Imported ${counts} from ${prepared.name}. Undo takes it all back.`);
      ui.offerUndo(`Imported ${counts}`);
    } catch (e) {
      if (e instanceof TaskLimitError) onerror(`${limitRefusal(e.count, e.adding)} Nothing was imported.`);
      else onerror(importProblem(e));
    } finally {
      busy = false;
    }
  }

  function points(p: PreparedImport): string[] {
    const matches = planMatches(p.plan);
    return [
      'Everything in the file is added to what you have; nothing is replaced.',
      ...(matches ? [`It adds to ${matches}, matched by name.`] : []),
      'One Undo takes the whole import back.',
    ];
  }
</script>

<button type="button" class="outline" disabled={disabled || busy} onclick={() => input.click()}>
  {busy ? 'Importing…' : 'Import…'}
</button>
<input bind:this={input} type="file" accept=".csv,text/csv" hidden onchange={onPicked} aria-label="Import file" />

{#if pending}
  <ChoiceDialog
    title={`Import “${pending.name}”?`}
    message={`It holds ${planCounts(pending.plan)}.`}
    points={points(pending)}
    choices={[{ label: 'Import', value: 'import' }]}
    onchoose={onChoose}
  />
{/if}
