<!--
  Undo toast (FR-1.6). Shown on touch devices after a destructive change,
  in place of iOS shake to undo, which web apps cannot use.
-->
<script lang="ts">
  import { ui } from '../lib/state/ui.svelte';

  let { message }: { message: string } = $props();
</script>

<div class="toast" role="status">
  <span>{message}</span>
  <button type="button" onclick={() => ui.undoLast()}>Undo</button>
</div>

<style>
  .toast {
    position: fixed;
    left: 50%;
    bottom: calc(96px + env(safe-area-inset-bottom));
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 10px 12px 10px 16px;
    border-radius: 10px;
    background: var(--toast-bg);
    color: var(--toast-text);
    font-size: 14px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
    z-index: 50;
  }
  button {
    border: 0;
    background: none;
    color: var(--toast-link);
    font-weight: 600;
    padding: 4px 6px;
  }
</style>
