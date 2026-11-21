<!--
  Deadline picker contents (FR-3.3): a field for typing a date (FR-3.2), a
  month calendar and Clear. Choosing a
  deadline before the item's start date (When) shows a warning in its place,
  with Move Start Date to the deadline or Cancel (FR-3.6).
-->
<script lang="ts">
  import Icon from './Icon.svelte';
  import MonthCalendar from './MonthCalendar.svelte';
  import TypedDate from './TypedDate.svelte';
  import { formatWeekdayDate, whenAfterDeadline } from '../lib/model/dates';
  import type { LocalDate } from '../lib/model/types';

  let {
    deadline,
    when = null,
    noun = 'task',
    ref,
    onchoose,
  }: {
    deadline: LocalDate | null;
    /** The item's When date, which can't be later than the deadline. */
    when?: LocalDate | null;
    /** What the warning calls the item; 'tasks' for several selected (FR-10.1). */
    noun?: 'task' | 'project' | 'tasks';
    ref: LocalDate;
    /** Called with the new deadline (null clears it); `moveWhen` moves the When date to it. */
    onchoose: (deadline: LocalDate | null, moveWhen: boolean) => void;
  } = $props();

  /** A chosen deadline earlier than the When date, waiting for the user's answer. */
  let pending = $state<LocalDate | null>(null);
  /** The date being typed, shown in the calendar. */
  let typed = $state<LocalDate | null>(null);

  function pick(date: LocalDate) {
    if (whenAfterDeadline(when, date, ref)) pending = date;
    else onchoose(date, false);
  }
</script>

<div class="deadline">
  {#if pending}
    <div class="warn" role="alert">
      {#if noun === 'tasks'}
        <p>This deadline is before some of these tasks' start dates (the latest is {formatWeekdayDate(when!)}).</p>
      {:else}
        <p>This deadline is before the {noun}'s start date ({formatWeekdayDate(when!)}).</p>
      {/if}
      <button type="button" class="menu-item" onclick={() => onchoose(pending, true)}>
        <Icon name="calendar" size={14} color="var(--c-scheduled)" /> {noun === 'tasks' ? 'Move those start dates' : 'Move Start Date'} to the deadline
      </button>
      <button type="button" class="menu-item" onclick={() => (pending = null)}>
        <Icon name="x" size={14} /> Cancel
      </button>
    </div>
  {:else}
    <TypedDate {ref} onpreview={(d) => (typed = d)} onpick={pick} />
    <MonthCalendar value={typed ?? deadline} {ref} onpick={pick} />
    {#if deadline}
      <hr class="menu-sep" />
      <button type="button" class="menu-item" onclick={() => onchoose(null, false)}>
        <Icon name="x" size={14} /> Clear Deadline
      </button>
    {/if}
  {/if}
</div>

<style>
  .warn {
    width: 224px;
    display: flex;
    flex-direction: column;
  }
  .warn p {
    margin: 0;
    padding: 6px 10px 8px;
    font-size: 13px;
  }
</style>
