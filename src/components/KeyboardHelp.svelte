<!--
  Keyboard Help (FR-7.1k): the bindings active right now. The installed app
  uses the Things bindings; a browser tab uses the fallbacks for keys the
  browser keeps for itself.
-->
<script lang="ts">
  import { BINDINGS, formatKeys, isMac, keysFor } from '../lib/shortcuts';
  import { install } from '../lib/pwa/install.svelte';
  import { ui } from '../lib/state/ui.svelte';

  const mac = isMac();
  const standalone = install.standalone;
  const rows = BINDINGS.map((b) => ({ label: b.label, keys: keysFor(b, standalone).map((k) => formatKeys(k, mac)) })).filter(
    (r) => r.keys.length,
  );

  let dialog: HTMLDialogElement;
  let done: HTMLButtonElement;

  // Focus Done, not the scrolling list, so Enter or Escape closes at once.
  $effect(() => {
    dialog.showModal();
    done.focus();
  });

  function close() {
    ui.helpOpen = false;
  }
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="help-title"
  oncancel={(e) => {
    e.preventDefault();
    close();
  }}
>
  <h2 id="help-title">Keyboard Shortcuts</h2>
  <p class="mode">
    {#if standalone}
      Installed app: Things shortcuts. Type anywhere to search.
    {:else}
      In a browser tab, some shortcuts use other keys, because the browser keeps them for itself. Install the app to use the
      Things shortcuts.
    {/if}
  </p>
  <dl>
    {#each rows as r (r.label)}
      <dt>{r.label}</dt>
      <dd>
        {#each r.keys as k, i (i)}<kbd>{k}</kbd>{/each}
      </dd>
    {/each}
  </dl>
  <div class="actions">
    <button type="button" class="btn-plain" bind:this={done} onclick={close}>Done</button>
  </div>
</dialog>

<style>
  dialog {
    border: 0;
    border-radius: 12px;
    padding: 18px 22px 14px;
    width: min(460px, calc(100% - 32px));
    max-height: 80vh;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
  }
  /* Title and Done stay put; only the list scrolls. */
  dialog[open] {
    display: flex;
    flex-direction: column;
  }
  dialog::backdrop {
    background: var(--overlay);
  }
  h2 {
    margin: 0 0 6px;
    font-size: 17px;
  }
  .mode {
    margin: 0 0 12px;
    color: var(--text-2);
    font-size: 13px;
    line-height: 1.4;
  }
  dl {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: grid;
    align-content: start;
    grid-template-columns: 1fr auto;
    gap: 6px 16px;
    margin: 0;
    font-size: 14px;
  }
  dt {
    color: var(--text);
  }
  dd {
    margin: 0;
    display: flex;
    gap: 6px;
    justify-content: flex-end;
  }
  kbd {
    font: 12px var(--font);
    padding: 1px 6px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--sidebar-bg);
    white-space: nowrap;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 12px;
  }
</style>
