<!-- Deadline picker contents (FR-3.3): a month calendar and Clear. -->
<script lang="ts">
  import Icon from './Icon.svelte';
  import MonthCalendar from './MonthCalendar.svelte';
  import type { LocalDate } from '../lib/model/types';

  let {
    deadline,
    ref,
    onchoose,
  }: {
    deadline: LocalDate | null;
    ref: LocalDate;
    /** Called with the new deadline, or null to clear it. */
    onchoose: (deadline: LocalDate | null) => void;
  } = $props();
</script>

<div class="deadline">
  <MonthCalendar value={deadline} {ref} onpick={onchoose} />
  {#if deadline}
    <hr class="menu-sep" />
    <button type="button" class="menu-item" onclick={() => onchoose(null)}>
      <Icon name="x" size={14} /> Clear Deadline
    </button>
  {/if}
</div>
