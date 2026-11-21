<!--
  While the sidebar is hidden, the window's left edge: point at it and a
  thin line appears; pull it to the right to bring the sidebar back
  (design doc, Section 6). Mouse and trackpad
  only; on iPad the sidebar button in the page header does this
  (ViewHeader.svelte), and Cmd+/ works everywhere.
-->
<script lang="ts">
  import { ui } from '../lib/state/ui.svelte';

  /** How far to the right the pull must go to show the sidebar. */
  const SHOW_AFTER = 40;

  /** The pointer's x where the pull started. */
  let startX: number | null = $state(null);

  function down(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault(); // no text selection while pulling
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    startX = e.clientX;
  }

  function move(e: PointerEvent) {
    if (startX !== null && e.clientX - startX >= SHOW_AFTER) {
      startX = null;
      ui.setSidebarHidden(false);
    }
  }
</script>

<div
  class="reveal"
  class:pulling={startX !== null}
  role="separator"
  aria-orientation="vertical"
  aria-label="Show sidebar"
  title="Pull to the right to show the sidebar"
  onpointerdown={down}
  onpointermove={move}
  onpointerup={() => (startX = null)}
  onpointercancel={() => (startX = null)}
></div>

<style>
  .reveal {
    position: fixed;
    top: 0;
    left: 0;
    width: 8px;
    height: 100%;
    cursor: col-resize;
    touch-action: none;
    z-index: var(--z-reveal);
  }
  .reveal::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 3px;
    background: var(--accent);
    opacity: 0;
    transition: opacity 0.15s;
  }
  .reveal:hover::after,
  .reveal.pulling::after {
    opacity: 0.6;
  }
  /* Touch screens use the sidebar button instead. */
  @media (hover: none) {
    .reveal {
      display: none;
    }
  }
</style>
