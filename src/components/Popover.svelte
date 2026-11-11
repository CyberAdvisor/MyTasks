<!--
  A trigger button plus a floating panel. Closes on Escape (without closing
  the card around it) and on any click outside. Used by the When, Deadline,
  Tags, Priority and More menus.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    open = $bindable(false),
    label,
    align = 'right',
    above = false,
    trigger,
    children,
  }: {
    open?: boolean;
    /** Accessible name of the panel. */
    label: string;
    /** Which edge of the trigger the panel lines up with. */
    align?: 'left' | 'right';
    /** Open the panel above the trigger, e.g. from the bottom toolbar. */
    above?: boolean;
    /** The trigger; call `toggle` to open or close the panel. */
    trigger: Snippet<[toggle: () => void, open: boolean]>;
    children: Snippet;
  } = $props();

  let wrap: HTMLDivElement;

  const toggle = () => (open = !open);

  // Outside clicks close the panel.
  $effect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.contains(e.target as Node)) open = false;
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  });

  // Escape closes only the panel, not the card it sits in. Listening in the
  // capture phase lets the panel take the key wherever focus is.
  $effect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        open = false;
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  });
</script>

<div class="wrap" bind:this={wrap}>
  {@render trigger(toggle, open)}
  {#if open}
    <div class="panel" class:left={align === 'left'} class:above role="dialog" aria-label={label}>
      {@render children()}
    </div>
  {/if}
</div>

<style>
  .wrap {
    position: relative;
    display: inline-flex;
  }
  .panel {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    min-width: 200px;
    background: var(--surface);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
    padding: 4px;
    z-index: 30;
  }
  .panel.above {
    top: auto;
    bottom: calc(100% + 6px);
  }
  .panel.left {
    right: auto;
    left: 0;
  }
</style>
