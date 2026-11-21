<!--
  When picker contents (FR-3.1), shown as "Start Date": a field for typing a
  date (FR-3.2), Today, Tomorrow, This Weekend, Next Week, a month calendar,
  Deferred and Clear. Shared by tasks and projects.
  With a deadline, days after it are greyed out and a note says why
  (FR-3.6); Today and Deferred stay available.
-->
<script lang="ts">
  import Icon from './Icon.svelte';
  import MonthCalendar from './MonthCalendar.svelte';
  import TypedDate from './TypedDate.svelte';
  import { addDays, formatShort, nextWeek, thisWeekend } from '../lib/model/dates';
  import type { WhenChoice } from '../lib/db/repo';
  import type { LocalDate } from '../lib/model/types';

  let {
    startDate,
    deferred,
    deadline = null,
    ref,
    onchoose,
  }: {
    startDate: LocalDate | null;
    deferred: boolean;
    /** The item's deadline: a When date can't be later (FR-3.6). */
    deadline?: LocalDate | null;
    ref: LocalDate;
    onchoose: (choice: WhenChoice) => void;
  } = $props();

  /** A date choice; today's date becomes the Today choice. */
  const pickDate = (date: LocalDate) => onchoose(date <= ref ? { kind: 'today' } : { kind: 'date', date });

  let isSet = $derived(deferred || startDate !== null);
  /** A preset date after the deadline is greyed out (FR-3.6). */
  const late = (date: LocalDate) => deadline !== null && date > deadline;
  /** A typed date can't be after the deadline either; today or earlier is Today. */
  const blocked = (date: LocalDate) =>
    date > ref && late(date) ? `After the deadline (${formatShort(deadline!)})` : null;

  /** The date being typed, shown in the calendar. */
  let typed = $state<LocalDate | null>(null);
</script>

<div class="when">
  <TypedDate {ref} {blocked} onpreview={(d) => (typed = d)} onpick={pickDate} />
  <button type="button" class="menu-item" class:active={startDate !== null && startDate <= ref} onclick={() => onchoose({ kind: 'today' })}>
    <Icon name="star" size={14} color="var(--c-today)" /> Today
  </button>
  <button type="button" class="menu-item" disabled={late(addDays(ref, 1))} onclick={() => pickDate(addDays(ref, 1))}>
    <Icon name="calendar" size={14} color="var(--c-scheduled)" /> Tomorrow
  </button>
  <button type="button" class="menu-item" disabled={late(thisWeekend(ref))} onclick={() => pickDate(thisWeekend(ref))}>
    <Icon name="calendar" size={14} color="var(--c-scheduled)" /> This Weekend
  </button>
  <button type="button" class="menu-item" disabled={late(nextWeek(ref))} onclick={() => pickDate(nextWeek(ref))}>
    <Icon name="calendar" size={14} color="var(--c-scheduled)" /> Next Week
  </button>
  <hr class="menu-sep" />
  <MonthCalendar value={typed ?? startDate} {ref} min={ref} max={deadline} onpick={pickDate} />
  {#if deadline}
    <p class="note">Deadline: {formatShort(deadline)}. A start date can't be later.</p>
  {/if}
  <hr class="menu-sep" />
  <button type="button" class="menu-item" class:active={deferred} onclick={() => onchoose({ kind: 'deferred' })}>
    <Icon name="archive" size={14} color="var(--c-deferred)" /> Deferred
  </button>
  {#if isSet}
    <button type="button" class="menu-item" onclick={() => onchoose({ kind: 'clear' })}>
      <Icon name="x" size={14} /> Clear
    </button>
  {/if}
</div>

<style>
  .when {
    display: flex;
    flex-direction: column;
  }
  .note {
    margin: 0;
    padding: 0 10px 4px;
    max-width: 224px;
    font-size: 12px;
    color: var(--text-3);
  }
</style>
