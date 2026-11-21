<!--
  Today's calendar events (FR-21.3): a compact rounded block under the title,
  above the tag bar, each line with its calendar's name. Shown only when the
  day has events and Settings › Calendar Events › Show is on. Not printed.
  (Scheduled lists its events as plain lines: ScheduledEvents.)
-->
<script lang="ts">
  import EventLine from './EventLine.svelte';
  import { calendar, minuteClock } from '../lib/calendar/calendar';
  import { calendarOf, eventsOn, isEnded, occurrenceKey } from '../lib/calendar/events';
  import { settings } from '../lib/state/live';
  import type { LocalDate } from '../lib/model/types';

  let { day, label }: { day: LocalDate; /** Accessible name, e.g. "Today's calendar events". */ label: string } = $props();

  let data = $derived($settings.showCalendarEvents ? $calendar.data : null);
  let events = $derived(data ? eventsOn(data, day) : []);
</script>

{#if data && events.length}
  <section class="events" aria-label={label}>
    {#each events as e (occurrenceKey(e))}
      <EventLine event={e} calendar={calendarOf(data, e)} {day} showCalendar ended={isEnded(e, $minuteClock)} updatedAt={$calendar.updatedAt} />
    {/each}
  </section>
{/if}

<style>
  .events {
    display: flex;
    flex-direction: column;
    margin: 0 0 12px;
    padding: 6px 4px;
    border-radius: 10px;
    background: var(--chip-bg);
  }
  @media print {
    .events {
      display: none;
    }
  }
</style>
