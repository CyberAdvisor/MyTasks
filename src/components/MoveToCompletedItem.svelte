<!--
  The Move to Completed item in a ⋯ menu (FR-12.2): moves the view's
  completed items still waiting to move, and is greyed out when there are
  none. Used by the built-in lists' menu and the project and area menus.
-->
<script lang="ts">
  import Icon from './Icon.svelte';
  import { moveWaiting } from '../lib/actions';
  import { waitingInView, type ViewRef } from '../lib/model/lists';
  import { snapshot, todayDate } from '../lib/state/live';

  let { view, onchoose }: { view: ViewRef; /** Called first, to close the menu. */ onchoose: () => void } = $props();

  let waiting = $derived(waitingInView($snapshot, view, $todayDate));
  let none = $derived(!waiting.todos.length && !waiting.projects.length);

  function choose() {
    onchoose();
    void moveWaiting(waiting);
  }
</script>

<button type="button" class="menu-item" role="menuitem" disabled={none} onclick={choose}>
  <Icon name="logbook" size={15} /> Move to Completed
</button>
