<!--
  The Select item in a ⋯ menu (FR-10.2): starts Select mode on
  iPhone. Only on touch screens; a mouse or keyboard selects with
  Cmd/Ctrl-click, Shift-click and Shift+arrows (FR-10.1). First in the
  built-in lists', project, area and saved search menus, with its own
  separator.
-->
<script lang="ts">
  import { ui } from '../lib/state/ui.svelte';

  let { onchoose }: { /** Called first, to close the menu. */ onchoose: () => void } = $props();

  const touch = matchMedia('(pointer: coarse)').matches;

  function choose() {
    onchoose();
    ui.startSelecting();
  }
</script>

{#if touch}
  <button type="button" class="menu-item" role="menuitem" onclick={choose}>
    <!-- No icon: a check here would read as a ticked choice, like Group By's. -->
    <span class="menu-icon-space"></span> Select
  </button>
  <hr class="menu-sep" />
{/if}
