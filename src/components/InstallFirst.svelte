<!--
  Setup's "Install My Tasks first" box (FR-0.4). On iPhone and iPad the
  Home Screen app keeps its own data, so connecting in Safari first is
  wasted effort. Shown only there, in a tab (decided 2026-11-12, 5f).
-->
<svelte:options runes />

<script lang="ts">
  import { install } from '../lib/pwa/install.svelte';
</script>

<div class="box">
  <div class="title">Install My Tasks first</div>
  <p>
    On iPhone and iPad, the Home Screen app keeps its own data, separate from Safari. Add My Tasks to your Home
    Screen, then connect there.
  </p>
  <button type="button" class="link" onclick={() => (install.guideOpen = true)}>Show me how</button>
</div>

<style>
  .box {
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    padding: 14px 16px;
    margin: 0 0 22px;
  }
  .title {
    font-weight: 600;
    font-size: 15px;
    margin-bottom: 4px;
  }
  p {
    margin: 0;
    font-size: 13px;
    line-height: 1.5;
    color: var(--text-2);
  }
  .link {
    border: 0;
    background: none;
    padding: 0;
    margin-top: 8px;
    font-size: 13px;
    color: var(--accent-text);
  }
</style>
