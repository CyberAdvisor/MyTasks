<!--
  The install guide (FR-0.2): how to install in this browser. Opened from
  the sidebar's install notice and Setup's "Install My Tasks first" box.
  Chrome and Edge normally use their own prompt instead; the guide covers
  them only when that prompt was turned down.
-->
<svelte:options runes />

<script lang="ts">
  import Icon from './Icon.svelte';
  import { install } from '../lib/pwa/install.svelte';

  let dialog: HTMLDialogElement;

  $effect(() => {
    dialog.showModal();
  });

  function close() {
    install.guideOpen = false;
  }
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="install-title"
  oncancel={(e) => {
    e.preventDefault();
    close();
  }}
>
  <h2 id="install-title">Install My Tasks</h2>
  {#if install.browser === 'firefox'}
    <p>
      Installed, My Tasks opens in its own window and works offline. Firefox can’t install web apps: open My Tasks in
      Chrome, Edge or Safari to install it.
    </p>
  {:else}
    <p>
      Installed, My Tasks opens in its own window, works offline, and keeps its data safe.
      {#if install.browser === 'ios'}The Home Screen app keeps its own copy, separate from Safari.
      {:else if install.browser === 'safari'}The installed app keeps its own copy, separate from this tab.{/if}
    </p>
    <ol>
      {#if install.browser === 'ios'}
        <li>Tap the Share button <Icon name="share" size={15} color="var(--accent-text)" label="Share" /> in Safari’s toolbar.</li>
        <li>Scroll down and tap <b>Add to Home Screen</b>.</li>
        <li>Tap <b>Add</b>, then open My Tasks from your Home Screen and connect it to your gist.</li>
      {:else if install.browser === 'safari'}
        <li>In Safari’s menu bar, choose <b>File › Add to Dock…</b></li>
        <li>Click <b>Add</b>.</li>
        <li>Open My Tasks from the Dock and connect it to your gist.</li>
      {:else}
        <li>Click the install button at the right of the address bar, or find <b>Install</b> in the browser’s menu.</li>
        <li>Click <b>Install</b>.</li>
      {/if}
    </ol>
  {/if}
  <div class="actions">
    <button type="button" class="done" onclick={close}>Done</button>
  </div>
</dialog>

<style>
  /* Same look as ChoiceDialog. */
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
    margin: 0 0 12px;
    color: var(--text-2);
    font-size: 14px;
    line-height: 1.45;
  }
  ol {
    margin: 0 0 16px;
    padding-left: 20px;
    font-size: 14px;
    line-height: 1.45;
  }
  li {
    margin-bottom: 6px;
  }
  li :global(svg) {
    vertical-align: -2px;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
  }
  .done {
    border: 0;
    border-radius: var(--radius);
    background: var(--accent);
    color: var(--on-accent);
    padding: 8px 14px;
    font-weight: 600;
  }
</style>
