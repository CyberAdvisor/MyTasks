<!--
  The Print… item in a ⋯ menu (FR-12.5): opens the browser's print dialog
  for the current page. Cmd/Ctrl+P does the same. src/print.css decides what
  goes on paper. In the installed iPhone and iPad app, where Safari ignores
  the print command, it explains instead (App.svelte). Used by the built-in lists', project, area and saved search menus.
-->
<script lang="ts">
  import Icon from './Icon.svelte';
  import { printPage } from '../lib/print';

  let { onchoose }: { /** Called first, to close the menu. */ onchoose: () => void } = $props();

  function choose() {
    onchoose();
    printPage();
  }
</script>

<button type="button" class="menu-item" role="menuitem" onclick={choose}>
  <Icon name="printer" size={15} /> Print…
</button>
