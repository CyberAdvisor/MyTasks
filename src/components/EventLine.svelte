<!--
  One calendar event in a list (FR-21.3, FR-21.6), its title's first line
  only. Before the title, in its calendar's colour:
  - `lead="time"`: a short bar for an all-day event, the time for a timed one
    (Today, and Scheduled's next 7 days)
  - `lead="day"`: the day's number, "03" (Scheduled's later groups), with a
    repeating event's count after the title, "(2×)"
  With `showCalendar`, the calendar's name in grey at the right (Today). An
  ended event is dimmed. Clicking or tapping it opens its details (FR-21.4).
-->
<script lang="ts">
  import Popover from './Popover.svelte';
  import EventDetails from './EventDetails.svelte';
  import { firstLine, listTime, type CalendarEvent, type CalendarInfo } from '../lib/calendar/events';
  import { formatShort } from '../lib/model/dates';
  import type { LocalDate } from '../lib/model/types';

  let {
    event,
    calendar,
    day,
    lead = 'time',
    count = 1,
    showCalendar = false,
    ended = false,
    updatedAt,
  }: {
    event: CalendarEvent;
    calendar: CalendarInfo;
    /** The day the line is listed on. */
    day: LocalDate;
    lead?: 'time' | 'day';
    /** A repeating event's occurrences in the group (`lead="day"`). */
    count?: number;
    showCalendar?: boolean;
    ended?: boolean;
    updatedAt: string | null;
  } = $props();

  let open = $state(false);
  let time = $derived(listTime(event, day));
  let title = $derived(firstLine(event.title) || 'New Event');
  let times = $derived(count > 1 ? ` (${count}×)` : '');
  let label = $derived(
    lead === 'day'
      ? `${title}${times}, ${formatShort(day)}`
      : `${title}, ${time ?? 'All day'}${showCalendar && calendar.title ? `, ${calendar.title}` : ''}`,
  );
</script>

<Popover bind:open label={title} align="left" block sheetTitle={false}>
  {#snippet trigger(toggle, isOpen)}
    <button
      type="button"
      class="line"
      class:ended
      class:open={isOpen}
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      onclick={toggle}
    >
      {#if lead === 'day'}
        <span class="lead daynum" style:color={calendar.color}>{day.slice(8)}</span>
      {:else if time === null}
        <span class="bar" style:background={calendar.color}></span>
      {:else}
        <span class="lead" style:color={calendar.color}>{time}</span>
      {/if}
      <span class="title">{title}{times}</span>
      {#if showCalendar && calendar.title}<span class="cal">{calendar.title}</span>{/if}
    </button>
  {/snippet}
  <EventDetails {event} {calendar} {updatedAt} onclose={() => (open = false)} />
</Popover>

<style>
  .line {
    all: unset;
    box-sizing: border-box;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    min-height: 24px;
    padding: 0 8px;
    border-radius: 6px;
    font-size: 15px;
    color: var(--text);
  }
  .line:hover {
    background: var(--hover-bg);
  }
  .line.open {
    background: var(--selected-row);
  }
  .line:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .ended {
    opacity: 0.45;
  }
  .bar {
    width: 3px;
    height: 14px;
    border-radius: 2px;
    flex: none;
  }
  .lead {
    flex: none;
    font-variant-numeric: tabular-nums;
  }
  .daynum {
    min-width: 1.4em;
  }
  .title {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cal {
    flex: none;
    font-size: 13px;
    color: var(--text-3);
  }
  /* Phones: a taller line to tap. */
  @media (pointer: coarse) {
    .line {
      min-height: 32px;
    }
  }
</style>
