<!--
  First-run setup (FR-19.1 to FR-19.3, FR-19.6). Shown instead of the app
  until this device is connected to a GitHub Gist.
  1. Token: checked, then the account is searched for My Tasks gists.
  2. None found: choose a passphrase; a new secret gist is made from this
     device's list. One found: enter its passphrase. Several: choose one
     first. Only invalid ones: they are left alone; Start a New Gist.
-->
<script lang="ts">
  import Logo from './Logo.svelte';
  import VersionLink from './VersionLink.svelte';
  import { errorText } from '../lib/sync/messages';
  import { createList, joinList, lookUp, type FoundList } from '../lib/sync/setup';
  import { sync } from '../lib/sync/sync.svelte';

  /** Shortest passphrase accepted. */
  const MIN_PASSPHRASE = 8;

  /** Token page on GitHub with the gist scope and a name filled in. */
  const NEW_TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=gist&description=My%20Tasks';

  type Step = 'token' | 'create' | 'choose' | 'unlock' | 'invalid';

  let step = $state<Step>('token');
  let token = $state('');
  let passphrase = $state('');
  let confirm = $state('');
  let lists = $state<FoundList[]>([]);
  let chosen = $state<string | null>(null);
  let busy = $state(false);
  let error = $state('');
  let showHelp = $state(false);

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

  function connect(e: SubmitEvent) {
    e.preventDefault();
    void run(async () => {
      const found = await lookUp(token.trim());
      passphrase = confirm = '';
      if (found.kind === 'none') step = 'create';
      else if (found.kind === 'invalid') step = 'invalid';
      else {
        lists = found.lists;
        chosen = found.lists[0].id;
        step = found.lists.length > 1 ? 'choose' : 'unlock';
      }
    });
  }

  function create(e: SubmitEvent) {
    e.preventDefault();
    if (passphrase.length < MIN_PASSPHRASE) error = `Use at least ${MIN_PASSPHRASE} characters.`;
    else if (passphrase !== confirm) error = 'The passphrases don’t match.';
    else void run(async () => sync.connected(await createList(token.trim(), passphrase)));
  }

  function unlock(e: SubmitEvent) {
    e.preventDefault();
    void run(async () => sync.connected(await joinList(token.trim(), chosen!, passphrase)));
  }

  function choose(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    step = 'unlock';
  }

  /** "Nov 11, 2026 at 2:41 PM". */
  function updated(iso: string): string {
    const d = new Date(iso);
    return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} at ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  }
</script>

{#snippet errorLine()}
  {#if error}<p class="form-error" role="alert">⚠ {error}</p>{/if}
{/snippet}

<div class="setup">
  <div class="box">
    <div class="brand">
      <Logo size={44} />
      <div>
        <h1>My Tasks</h1>
        <p class="sub">Plan. Do. Succeed.</p>
      </div>
    </div>

    {#if step === 'token'}
      <form onsubmit={connect}>
        <p>
          Welcome. My Tasks keeps your to-dos in your own GitHub Gist, so they’re the same on all your devices.
          Connect a gist to get started.
        </p>
        <label class="form-label" for="setup-token">Personal access token (classic, gist scope)</label>
        <input id="setup-token" class="form-field" type="password" bind:value={token} autocomplete="off" spellcheck="false" />
        <button type="button" class="link" aria-expanded={showHelp} onclick={() => (showHelp = !showHelp)}>
          How to get a token {showHelp ? '▾' : '›'}
        </button>
        {#if showHelp}
          <ol class="help">
            <li>
              Open <a href={NEW_TOKEN_URL} target="_blank" rel="noopener noreferrer">GitHub’s new token page</a> and sign in.
              It opens with the name “My Tasks” and the <b>gist</b> box ticked.
            </li>
            <li>Choose when it expires. GitHub also removes tokens that go unused for a year.</li>
            <li>Leave only <b>gist</b> ticked, then click <b>Generate token</b>.</li>
            <li>Copy the token (it starts with <code>ghp_</code>) and paste it above.</li>
          </ol>
        {/if}
        <div class="actions">
          <button type="submit" class="btn-primary" disabled={busy || !token.trim()}>{busy ? 'Connecting…' : 'Connect'}</button>
        </div>
        {@render errorLine()}
        <p class="note">
          Your token stays on this device and is sent only to GitHub. A token with the gist scope can read and
          change all your gists. The first time you connect, the app makes a secret gist named “My Tasks”, and
          finds it again on your other devices.
        </p>
      </form>
    {:else if step === 'create'}
      <form onsubmit={create}>
        <p>Choose a passphrase. Your list is encrypted with it before it leaves this device.</p>
        <label class="form-label" for="setup-pass">Passphrase</label>
        <input id="setup-pass" class="form-field" type="password" bind:value={passphrase} autocomplete="new-password" />
        <label class="form-label" for="setup-confirm">Confirm passphrase</label>
        <input id="setup-confirm" class="form-field" type="password" bind:value={confirm} autocomplete="new-password" />
        <p class="note">
          Use the same passphrase on your other devices. Each device asks for it once. If you forget it, the gist
          can’t be read, but a connected device can set a new one in Settings.
        </p>
        <div class="actions">
          <button type="submit" class="btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Connect'}</button>
        </div>
        {@render errorLine()}
      </form>
    {:else if step === 'choose'}
      <form onsubmit={choose}>
        <p>More than one My Tasks list was found in your GitHub account. Choose the one to use. The others are left unchanged.</p>
        <fieldset>
          <legend class="visually-hidden">My Tasks lists</legend>
          {#each lists as list (list.id)}
            <label class="choice">
              <input type="radio" name="gist" value={list.id} bind:group={chosen} />
              <span>Updated {updated(list.updatedAt)}<small>gist {list.id.slice(0, 8)}…</small></span>
            </label>
          {/each}
        </fieldset>
        <div class="actions">
          <button type="submit" class="btn-primary">Use This List</button>
        </div>
      </form>
    {:else if step === 'unlock'}
      <form onsubmit={unlock}>
        <p>A My Tasks list was found in your GitHub account. Enter its passphrase to use it on this device.</p>
        <label class="form-label" for="setup-unlock">Passphrase</label>
        <input id="setup-unlock" class="form-field" type="password" bind:value={passphrase} autocomplete="current-password" />
        <p class="note">Anything already on this device is merged into it.</p>
        <div class="actions">
          <button type="submit" class="btn-primary" disabled={busy || !passphrase}>{busy ? 'Unlocking…' : 'Unlock'}</button>
        </div>
        {@render errorLine()}
      </form>
    {:else}
      <p>Your My Tasks gist holds a file that isn’t a valid My Tasks list. It was not changed.</p>
      <div class="actions">
        <button type="button" class="btn-primary" onclick={() => ((step = 'create'), (error = ''))}>Start a New Gist</button>
      </div>
      {@render errorLine()}
    {/if}

    {#if step !== 'token'}
      <button type="button" class="link back" onclick={() => ((step = 'token'), (error = ''))}>‹ Use a different token</button>
    {/if}
    <p class="version-line"><VersionLink /></p>
  </div>
</div>

<style>
  .version-line {
    margin: 28px 0 0;
  }
  .setup {
    height: 100%;
    overflow-y: auto;
    background: var(--bg);
    display: flex;
    justify-content: center;
    padding: calc(56px + env(safe-area-inset-top)) 16px 40px;
    box-sizing: border-box;
  }
  .box {
    width: min(440px, 100%);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 28px;
  }
  h1 {
    margin: 0;
    font-size: 24px;
  }
  .sub {
    margin: 0;
    font-size: 13px;
    color: var(--text-3);
  }
  p {
    margin: 0 0 18px;
    font-size: 15px;
    line-height: 1.55;
  }
  .note {
    font-size: 13px;
    color: var(--text-3);
    line-height: 1.5;
    margin: 18px 0 0;
  }
  form .note:not(:last-child) {
    margin: 0 0 18px;
  }
  .link {
    border: 0;
    background: transparent;
    padding: 0;
    color: var(--accent-text);
    font-size: 13px;
    margin: -6px 0 16px;
  }
  .back {
    margin: 22px 0 0;
  }
  .help {
    margin: -8px 0 18px;
    padding-left: 20px;
    font-size: 13px;
    line-height: 1.55;
    color: var(--text-2);
  }
  .help a {
    color: var(--accent-text);
  }
  .actions {
    display: flex;
  }
  fieldset {
    border: 0;
    margin: 0 0 16px;
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
    font-size: 15px;
  }
  .choice small {
    display: block;
    margin-top: 2px;
    color: var(--text-3);
    font-size: 12px;
  }
</style>
