<!--
  A Scheduled group's calendar events (FR-21.6):
  plain lines above the group's tasks, with no block and no calendar names.
  A day group lists its day's events with their times (or a bar, all-day);
  a later group (the rest of the month, a month) lists each event once with
  its day's number, a repeating one with its count. Year groups have none.
  Shown only when Settings › Calendar Events › Show is on. Not printed.
-->
<script lang="ts">
  import EventLine from './EventLine.svelte';
  import { calendar } from '../lib/calendar/calendar';
  import { calendarOf, eventsOn, occurrenceKey, periodLines } from '../lib/calendar/events';
  import { settings } from '../lib/state/live';
  import type { TodoGroup } from '../lib/model/lists';

  let { group }: { group: TodoGroup } = $props();

  let data = $derived($settings.showCalendarEvents && group.kind !== 'year' ? $calendar.data : null);
  let lines = $derived.by(() => {
    if (!data || !group.from || !group.to) return [];
    if (group.kind === 'day') return eventsOn(data, group.from).map((event) => ({ event, day: group.from!, count: 1 }));
    return periodLines(data, group.from, group.to);
  });
</script>

{#if data && lines.length}
  <div class="events" role="group" aria-label="Calendar events, {group.title}{group.subtitle ? ` ${group.subtitle}` : ''}">
    {#each lines as l (occurrenceKey(l.event))}
      <EventLine
        event={l.event}
        calendar={calendarOf(data, l.event)}
        day={l.day}
        lead={group.kind === 'day' ? 'time' : 'day'}
        count={l.count}
        updatedAt={$calendar.updatedAt}
      />
    {/each}
  </div>
{/if}

<style>
  .events {
    display: flex;
    flex-direction: column;
    margin: 6px 0 8px;
  }
  @media print {
    .events {
      display: none;
    }
  }
</style>
