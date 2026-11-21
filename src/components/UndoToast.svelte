<!--
  The toast. Undo (FR-1.6) shows on touch devices after a destructive change,
  in place of iOS shake to undo, which web apps cannot use. Show opens the
  list a task went to when it left the Inbox, on every device (FR-1.10).
-->
<script lang="ts">
  import { ui } from '../lib/state/ui.svelte';
  import { go, type Route } from '../lib/state/route';

  let { message, undo, where }: { message: string; undo: boolean; where?: Route } = $props();

  function show(r: Route): void {
    ui.dismissUndo();
    go(r);
  }
</script>

<div class="toast" role="status">
  <span>{message}</span>
  {#if where}<button type="button" onclick={() => show(where)}>Show</button>{/if}
  {#if undo}<button type="button" onclick={() => ui.undoLast()}>Undo</button>{/if}
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
    box-shadow: var(--shadow-toast);
    z-index: var(--z-toast);
    max-width: calc(100vw - 32px);
    white-space: nowrap;
  }
  /* One line; a long project or area name ends in "…". */
  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  button {
    flex: none;
    border: 0;
    background: none;
    color: var(--toast-link);
    font-weight: 600;
    padding: 4px 6px;
  }
</style>
