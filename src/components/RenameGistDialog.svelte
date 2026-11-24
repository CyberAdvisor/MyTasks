<!--
  Rename… (FR-19.14, Settings › Sync › Your gists): the active gist's name
  and colour. Saved as the synced setting `gistLabel`, so the gist's other
  devices show it after they sync.
-->
<script lang="ts">
  import GistLabelFields from './GistLabelFields.svelte';
  import { deviceGists } from '../lib/gists/onDevice.svelte';
  import { setSetting } from '../lib/db/repo';
  import { gistNameProblem, type GistColour, type GistLabel } from '../lib/model/settings';

  let { label, onclose }: { label: GistLabel; onclose: () => void } = $props();

  let dialog: HTMLDialogElement;
  // Starts from the gist's own name; a gist shown as Default has none yet.
  // svelte-ignore state_referenced_locally
  let name = $state(label.name ?? '');
  // svelte-ignore state_referenced_locally
  let colour = $state<GistColour>(label.colour);
  let error = $state('');

  $effect(() => {
    dialog.showModal();
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    const problem = gistNameProblem(name, deviceGists.otherNames());
    if (problem) return void (error = problem);
    await setSetting('gistLabel', { name: name.trim(), colour });
    onclose();
  }
</script>

<dialog
  class="form-dialog"
  bind:this={dialog}
  aria-labelledby="rename-gist-title"
  oncancel={(e) => {
    e.preventDefault();
    onclose();
  }}
>
  <form onsubmit={submit}>
    <h2 id="rename-gist-title">Rename Gist</h2>
    <p>The name and colour are kept in the gist, so your other devices show them too.</p>
    <GistLabelFields bind:name bind:colour />
    {#if error}<p class="form-error" role="alert">⚠ {error}</p>{/if}
    <div class="actions">
      <button type="button" class="btn-plain" onclick={onclose}>Cancel</button>
      <button type="submit" class="btn-primary">Rename</button>
    </div>
  </form>
</dialog>

