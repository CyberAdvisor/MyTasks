<!--
  Move to Completed button for a view's header (FR-12.2). Shown only while
  the view has completed items waiting to move; it moves just those. Things
  has this command (Log Completed) in a menu; here it is a header button
  and a Quick Find command (decided 2026-11-11).
-->
<script lang="ts">
  import { moveWaiting } from '../lib/actions';
  import { waitingInView, type ViewRef } from '../lib/model/lists';
  import { snapshot, todayDate } from '../lib/state/live';

  let { view }: { view: ViewRef } = $props();

  let waiting = $derived(waitingInView($snapshot, view, $todayDate));
</script>

{#if waiting.todos.length || waiting.projects.length}
  <button type="button" class="btn-plain" onclick={() => moveWaiting(waiting)}>Move to Completed</button>
{/if}
