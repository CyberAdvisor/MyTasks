<!--
  Forms behind Settings › Sync (FR-19.6, FR-19.7):
  - `token`: Change Token
  - `change-passphrase`: Change Passphrase (current, new, confirm)
  - `enter-passphrase`: enter a passphrase changed on another device
  Each runs its action and closes on success, or shows the error and stays.
-->
<script lang="ts" module>
  export type SyncForm = 'token' | 'change-passphrase' | 'enter-passphrase';
</script>

<script lang="ts">
  import { MIN_PASSPHRASE } from '../lib/sync/crypto';
  import { PASSPHRASE_TIP, errorText } from '../lib/sync/messages';
  import { sync } from '../lib/sync/sync.svelte';

  let { form, onclose }: { form: SyncForm; onclose: () => void } = $props();

  const TITLES: Record<SyncForm, string> = {
    token: 'Change Token',
    'change-passphrase': 'Change Passphrase',
    'enter-passphrase': 'Enter New Passphrase',
  };

  let dialog: HTMLDialogElement;
  let first = $state('');
  let second = $state('');
  let third = $state('');
  let busy = $state(false);
  let error = $state('');

  $effect(() => {
    dialog.showModal();
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    if (form === 'change-passphrase') {
      if (second.length < MIN_PASSPHRASE) return void (error = `Use at least ${MIN_PASSPHRASE} characters.`);
      if (second !== third) return void (error = 'The new passphrases don’t match.');
    }
    busy = true;
    try {
      if (form === 'token') await sync.changeToken(first.trim());
      else if (form === 'change-passphrase') await sync.changePassphrase(first, second);
      else await sync.enterPassphrase(first);
      onclose();
    } catch (err) {
      error = errorText(err);
    } finally {
      busy = false;
    }
  }
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="sync-form-title"
  oncancel={(e) => {
    e.preventDefault();
    if (!busy) onclose();
  }}
>
  <form onsubmit={submit}>
    <h2 id="sync-form-title">{TITLES[form]}</h2>
    {#if form === 'token'}
      <p>Paste a new personal access token (classic, gist scope) from the same GitHub account.</p>
      <label class="form-label" for="sync-token">Personal access token</label>
      <input id="sync-token" class="form-field" type="password" bind:value={first} autocomplete="off" spellcheck="false" />
    {:else if form === 'change-passphrase'}
      <p>Your gist will be encrypted again with the new passphrase. Your other devices will ask for it the next time they sync.</p>
      <label class="form-label" for="sync-current">Current passphrase</label>
      <input id="sync-current" class="form-field" type="password" bind:value={first} autocomplete="current-password" />
      <label class="form-label" for="sync-new">New passphrase</label>
      <input id="sync-new" class="form-field" type="password" bind:value={second} autocomplete="new-password" />
      <p class="tip">{PASSPHRASE_TIP}</p>
      <label class="form-label" for="sync-confirm">Confirm new passphrase</label>
      <input id="sync-confirm" class="form-field" type="password" bind:value={third} autocomplete="new-password" />
    {:else}
      <p>The passphrase was changed on another device. Enter the new one to keep syncing.</p>
      <label class="form-label" for="sync-enter">Passphrase</label>
      <input id="sync-enter" class="form-field" type="password" bind:value={first} autocomplete="current-password" />
    {/if}
    {#if error}<p class="form-error" role="alert">⚠ {error}</p>{/if}
    <div class="actions">
      <button type="button" class="btn-plain" disabled={busy} onclick={onclose}>Cancel</button>
      <button type="submit" class="btn-primary" disabled={busy || !first}>{busy ? 'Working…' : TITLES[form]}</button>
    </div>
  </form>
</dialog>

<style>
  dialog {
    border: 0;
    border-radius: 12px;
    padding: 20px 22px 16px;
    max-width: 420px;
    width: calc(100% - 32px);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
  }
  dialog::backdrop {
    background: var(--overlay);
  }
  h2 {
    margin: 0 0 8px;
    font-size: 17px;
  }
  p {
    margin: 0 0 16px;
    color: var(--text-2);
    font-size: 14px;
    line-height: 1.45;
  }
  /* Red, as in Setup: the colour must be set here, because the dialog's own
     p rule above outranks the shared .form-error in app.css. */
  .form-error {
    margin: 0 0 12px;
    color: var(--danger);
  }
  /* The passphrase tip sits close under its field. */
  p.tip {
    margin: -8px 0 14px;
    font-size: 12px;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 6px;
  }
</style>
