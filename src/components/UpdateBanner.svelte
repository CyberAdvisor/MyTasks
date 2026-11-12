<!--
  "Update available | Restart | ×" (NFR-8). Looks like the Undo toast.
  Restart saves any edit in progress, then loads the new version; × hides
  the banner until the next start, when the update applies by itself.
-->
<svelte:options runes />

<script lang="ts">
  import Icon from './Icon.svelte';
  import { update } from '../lib/pwa/update.svelte';
</script>

<div class="toast" role="status">
  <span>Update available</span>
  <button type="button" class="restart" onclick={() => void update.restart()}>Restart</button>
  <button type="button" class="dismiss" aria-label="Dismiss" onclick={() => (update.dismissed = true)}>
    <Icon name="x" size={14} />
  </button>
</div>

<style>
  /* Same place and look as UndoToast. */
  .toast {
    position: fixed;
    left: 50%;
    bottom: calc(96px + env(safe-area-inset-bottom));
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 10px 8px 10px 16px;
    border-radius: 10px;
    background: var(--toast-bg);
    color: var(--toast-text);
    font-size: 14px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
    z-index: 50;
    white-space: nowrap;
  }
  button {
    border: 0;
    background: none;
  }
  .restart {
    color: var(--toast-link);
    font-weight: 600;
    padding: 4px 6px;
  }
  .dismiss {
    display: flex;
    color: var(--toast-text);
    opacity: 0.7;
    padding: 4px;
  }
</style>
