<!--
  When picker contents (FR-3.1): Today, Tomorrow, This Weekend, Next Week,
  a month calendar, Deferred and Clear. Shared by to-dos and projects.
-->
<script lang="ts">
  import Icon from './Icon.svelte';
  import MonthCalendar from './MonthCalendar.svelte';
  import { addDays, nextWeek, thisWeekend } from '../lib/model/dates';
  import type { WhenChoice } from '../lib/db/repo';
  import type { LocalDate } from '../lib/model/types';

  let {
    startDate,
    deferred,
    ref,
    onchoose,
  }: {
    startDate: LocalDate | null;
    deferred: boolean;
    ref: LocalDate;
    onchoose: (choice: WhenChoice) => void;
  } = $props();

  /** A date choice; today's date becomes the Today choice. */
  const pickDate = (date: LocalDate) => onchoose(date <= ref ? { kind: 'today' } : { kind: 'date', date });

  let isSet = $derived(deferred || startDate !== null);
</script>

<div class="when">
  <button type="button" class="menu-item" class:active={startDate !== null && startDate <= ref} onclick={() => onchoose({ kind: 'today' })}>
    <Icon name="star" size={14} color="var(--c-today)" /> Today
  </button>
  <button type="button" class="menu-item" onclick={() => pickDate(addDays(ref, 1))}>
    <Icon name="calendar" size={14} color="var(--c-scheduled)" /> Tomorrow
  </button>
  <button type="button" class="menu-item" onclick={() => pickDate(thisWeekend(ref))}>
    <Icon name="calendar" size={14} color="var(--c-scheduled)" /> This Weekend
  </button>
  <button type="button" class="menu-item" onclick={() => pickDate(nextWeek(ref))}>
    <Icon name="calendar" size={14} color="var(--c-scheduled)" /> Next Week
  </button>
  <hr class="menu-sep" />
  <MonthCalendar value={startDate} {ref} min={ref} onpick={pickDate} />
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
</style>
