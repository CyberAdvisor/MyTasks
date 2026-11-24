<!--
  Add Gist… (FR-19.16): another gist on this device, with Setup's steps,
  then its name and colour.
  1. The account's My Tasks gists not yet on this device, found with the
     current token; Use a Different Token asks for another. They can pick
     one or create a new gist.
  2. A new gist: choose its passphrase. An existing one: enter its passphrase.
  3. The name (required, different from this device's other gists) and colour,
     starting from the ones an existing gist already has.
  Then the gist is added and the app switches to it; its first sync fills it.
  Nothing here changes the open gist's tasks.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import GistLabelFields from './GistLabelFields.svelte';
  import { LOCALE } from '../lib/model/dates';
  import { GIST_COLOURS, gistNameProblem, type GistColour } from '../lib/model/settings';
  import { deviceGists } from '../lib/gists/onDevice.svelte';
  import { MIN_PASSPHRASE } from '../lib/sync/crypto';
  import { PASSPHRASE_TIP, errorText } from '../lib/sync/messages';
  import { addExistingGist, addNewGist, addableGists, unlockGist, type FoundList, type UnlockedGist } from '../lib/sync/setup';
  import { sync } from '../lib/sync/sync.svelte';

  let { onclose }: { onclose: () => void } = $props();

  /** The choice that makes a new gist rather than adding a found one. */
  const NEW = 'new';

  type Step = 'looking' | 'token' | 'choose' | 'create' | 'unlock' | 'name';

  let dialog: HTMLDialogElement;
  let step = $state<Step>('looking');
  let token = $state(sync.config?.token ?? '');
  let typedToken = $state('');
  let found = $state<FoundList[]>([]);
  let chosen = $state<string>(NEW);
  let passphrase = $state('');
  let confirm = $state('');
  /** The existing gist, once its passphrase opened it. Raw: it holds a CryptoKey. */
  let unlocked = $state.raw<UnlockedGist | null>(null);
  let name = $state('');
  let colour = $state<GistColour>(freeColour());
  let busy = $state(false);
  let error = $state('');

  $effect(() => {
    dialog.showModal();
    untrack(() => void look());
  });

  /** The first colour no other gist on this device uses, else blue. */
  function freeColour(): GistColour {
    const used = new Set(deviceGists.list.map((g) => g.label.colour));
    return GIST_COLOURS.find((c) => !used.has(c) && c !== 'grey') ?? 'blue';
  }

  /** Run a step's action, showing its error in the form. */
  async function run(action: () => Promise<void>) {
    error = '';
    busy = true;
    try {
      await action();
    } catch (e) {
      error = errorText(e);
    } finally {
      busy = false;
    }
  }

  /** Find the gists the token can add; a token that fails asks for another. */
  async function look() {
    step = 'looking';
    await run(async () => {
      try {
        found = await addableGists(token, deviceGists.list.map((g) => g.gistId));
      } catch (e) {
        step = 'token';
        throw e;
      }
      chosen = found[0]?.id ?? NEW;
      step = 'choose';
    });
  }

  function useToken(e: SubmitEvent) {
    e.preventDefault();
    token = typedToken.trim();
    void look();
  }

  function choose(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    passphrase = confirm = '';
    step = chosen === NEW ? 'create' : 'unlock';
  }

  function create(e: SubmitEvent) {
    e.preventDefault();
    if (passphrase.length < MIN_PASSPHRASE) error = `Use at least ${MIN_PASSPHRASE} characters.`;
    else if (passphrase !== confirm) error = 'The passphrases don’t match.';
    else {
      error = '';
      name = '';
      step = 'name';
    }
  }

  function unlock(e: SubmitEvent) {
    e.preventDefault();
    void run(async () => {
      const gist = await unlockGist(token, chosen, passphrase);
      unlocked = gist;
      // A gist shown as Default has no name yet: one is needed now.
      name = gist.label.name ?? '';
      if (gist.label.name) colour = gist.label.colour;
      step = 'name';
    });
  }

  function add(e: SubmitEvent) {
    e.preventDefault();
    const problem = gistNameProblem(name, deviceGists.names());
    if (problem) return void (error = problem);
    const label = { name: name.trim(), colour };
    const acknowledged = sync.config?.acknowledged;
    void run(async () => {
      const db = unlocked
        ? await addExistingGist(token, unlocked, label, acknowledged)
        : await addNewGist(token, passphrase, label, acknowledged);
      await deviceGists.refresh();
      await sync.switchTo(db);
      location.replace(location.pathname);
    });
  }

  function back() {
    error = '';
    step = step === 'name' ? (unlocked ? 'unlock' : 'create') : 'choose';
    unlocked = null;
  }

  /** "Nov 11, 2026 at 2:41 PM". */
  function updated(iso: string): string {
    const d = new Date(iso);
    return `${d.toLocaleDateString(LOCALE, { month: 'short', day: 'numeric', year: 'numeric' })} at ${d.toLocaleTimeString(LOCALE, { hour: 'numeric', minute: '2-digit' })}`;
  }
</script>

{#snippet errorLine()}
  {#if error}<p class="form-error" role="alert">⚠ {error}</p>{/if}
{/snippet}

{#snippet buttons(label: string, working: string, disabled = false)}
  <div class="actions">
    {#if step !== 'choose' && step !== 'token'}<button type="button" class="btn-plain back" disabled={busy} onclick={back}>Back</button>{/if}
    <button type="button" class="btn-plain" disabled={busy} onclick={onclose}>Cancel</button>
    <button type="submit" class="btn-primary" disabled={busy || disabled}>{busy ? working : label}</button>
  </div>
{/snippet}

<dialog
  class="form-dialog"
  bind:this={dialog}
  aria-labelledby="add-gist-title"
  oncancel={(e) => {
    e.preventDefault();
    if (!busy) onclose();
  }}
>
  <h2 id="add-gist-title">Add Gist</h2>
  {#if step === 'looking'}
    <p role="status">Looking for your My Tasks gists…</p>
    <div class="actions"><button type="button" class="btn-plain" onclick={onclose}>Cancel</button></div>
  {:else if step === 'token'}
    <form onsubmit={useToken}>
      <p>Paste a personal access token (classic, gist scope) for the GitHub account that has the gist.</p>
      <label class="form-label" for="add-token">Personal access token</label>
      <input id="add-token" class="form-field" type="password" bind:value={typedToken} autocomplete="off" spellcheck="false" />
      {@render errorLine()}
      {@render buttons('Continue', 'Looking…', !typedToken.trim())}
    </form>
  {:else if step === 'choose'}
    <form onsubmit={choose}>
      <p>
        {found.length ? 'Choose a gist to add to this device, or create a new one.' : 'There are no other My Tasks gists in this GitHub account. Create a new one?'}
      </p>
      <fieldset>
        <legend class="visually-hidden">Gists</legend>
        {#each found as list (list.id)}
          <label class="choice">
            <input type="radio" name="add-gist" value={list.id} bind:group={chosen} />
            <span>Updated {updated(list.updatedAt)}<small>gist {list.id.slice(0, 8)}…</small></span>
          </label>
        {/each}
        <label class="choice">
          <input type="radio" name="add-gist" value={NEW} bind:group={chosen} />
          <span>Create a new gist<small>It starts with no tasks.</small></span>
        </label>
      </fieldset>
      <button type="button" class="link" onclick={() => ((typedToken = ''), (error = ''), (step = 'token'))}>Use a different token</button>
      {@render buttons('Continue', 'Continue')}
    </form>
  {:else if step === 'create'}
    <form onsubmit={create}>
      <p>Choose a passphrase for the new gist. Its tasks are encrypted with it before they leave this device.</p>
      <label class="form-label" for="add-pass">Passphrase</label>
      <input id="add-pass" class="form-field" type="password" bind:value={passphrase} autocomplete="new-password" />
      <p class="tip">{PASSPHRASE_TIP} Use a different passphrase from your other gists.</p>
      <label class="form-label" for="add-confirm">Confirm passphrase</label>
      <input id="add-confirm" class="form-field" type="password" bind:value={confirm} autocomplete="new-password" />
      {@render errorLine()}
      {@render buttons('Continue', 'Continue', !passphrase)}
    </form>
  {:else if step === 'unlock'}
    <form onsubmit={unlock}>
      <p>Enter this gist’s passphrase to use it on this device.</p>
      <label class="form-label" for="add-unlock">Passphrase</label>
      <input id="add-unlock" class="form-field" type="password" bind:value={passphrase} autocomplete="current-password" />
      {@render errorLine()}
      {@render buttons('Unlock', 'Unlocking…', !passphrase)}
    </form>
  {:else}
    <form onsubmit={add}>
      <p>Name the gist, so you always know which one you’re in. The name and colour are kept in the gist.</p>
      <GistLabelFields bind:name bind:colour />
      {@render errorLine()}
      {@render buttons('Add Gist', 'Adding…')}
    </form>
  {/if}
</dialog>

<style>
  fieldset {
    border: 0;
    margin: 0 0 12px;
    padding: 0;
  }
  .choice {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 10px 12px;
    border: 1px solid var(--rule);
    border-radius: 8px;
    margin-bottom: 8px;
    font-size: 14px;
  }
  .choice small {
    display: block;
    margin-top: 2px;
    color: var(--text-3);
    font-size: 12px;
  }
  .link {
    border: 0;
    background: transparent;
    padding: 0;
    margin: 0 0 12px;
    color: var(--accent-text);
    font-size: 13px;
  }
  .back {
    margin-right: auto;
  }
</style>
