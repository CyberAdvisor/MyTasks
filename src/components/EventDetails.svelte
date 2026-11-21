<!--
  A calendar event's details (FR-21.4), read-only, inside its Popover: a
  pop-over on the Mac and iPad, a sheet on phones. Only what the event has
  is shown. Only the link opens (in a new tab); notes, the location and the
  attendees are plain text, and Calendar is never opened. Layout as approved
  in the "My Tasks — Calendar events (Milestone 13)" canvas.
-->
<script lang="ts">
  import Icon from './Icon.svelte';
  import { formatTimestamp } from '../lib/model/dates';
  import {
    alertLine,
    attendeeRows,
    attendeeSummary,
    availabilityLine,
    dateLine,
    linkLabel,
    safeLink,
    timeLine,
    travelLine,
    type AttendeeStatus,
    type CalendarEvent,
    type CalendarInfo,
  } from '../lib/calendar/events';

  let {
    event,
    calendar,
    updatedAt,
    onclose,
  }: {
    event: CalendarEvent;
    calendar: CalendarInfo;
    /** When the helper last wrote the calendar file. */
    updatedAt: string | null;
    onclose: () => void;
  } = $props();

  let time = $derived(timeLine(event));
  let link = $derived(safeLink(event.url));
  let people = $derived(attendeeRows(event));
  let hasFacts = $derived(
    !!(event.location || event.travelMinutes || event.repeat || event.availability || event.alerts?.length || link),
  );

  /** How each answer is shown and read out. */
  const ANSWER: Record<AttendeeStatus, { icon: 'check' | 'x' | 'help' | 'minus'; color: string; label: string }> = {
    accepted: { icon: 'check', color: 'var(--c-logbook)', label: 'accepted' },
    declined: { icon: 'x', color: 'var(--danger)', label: 'declined' },
    tentative: { icon: 'help', color: 'var(--p2)', label: 'maybe' },
    other: { icon: 'minus', color: 'var(--text-3)', label: 'no answer' },
  };

  /** "updated today at 11:39 AM" */
  let updated = $derived(updatedAt ? formatTimestamp(updatedAt).replace(/^(Today|Yesterday)/, (w) => w.toLowerCase()) : '');
</script>

<div class="details">
  <div class="head">
    <span class="bar" style:background={calendar.color}></span>
    <div class="what">
      <h2>{event.title || 'New Event'}</h2>
      <span class="when">{dateLine(event)}</span>
      {#if time}<span class="when">{time}</span>{/if}
      {#if calendar.title}
        <span class="calendar-name"><span class="dot" style:background={calendar.color}></span>{calendar.title}</span>
      {/if}
    </div>
    <button type="button" class="close" aria-label="Close" onclick={onclose}><Icon name="x" size={16} /></button>
  </div>

  {#if hasFacts}
    <div class="rule"></div>
    {#if event.location}
      <div class="fact"><Icon name="pin" size={18} color="var(--text-3)" label="Location" /><div>{event.location}</div></div>
    {/if}
    {#if event.travelMinutes}
      <div class="fact"><Icon name="car" size={18} color="var(--text-3)" label="Travel time" /><div>{travelLine(event.travelMinutes)}</div></div>
    {/if}
    {#if event.repeat}
      <div class="fact"><Icon name="repeat" size={18} color="var(--text-3)" label="Repeats" /><div>{event.repeat}</div></div>
    {/if}
    {#if event.availability}
      <div class="fact"><Icon name="calendar" size={18} color="var(--text-3)" label="Show as" /><div>{availabilityLine(event.availability)}</div></div>
    {/if}
    {#if event.alerts?.length}
      <div class="fact">
        <Icon name="bell" size={18} color="var(--text-3)" label="Alerts" />
        <div>{#each event.alerts as a, i (i)}<div>{alertLine(a, event)}</div>{/each}</div>
      </div>
    {/if}
    {#if link}
      <div class="fact">
        <Icon name="link" size={18} color="var(--text-3)" label="Link" />
        <div class="link"><a href={link} target="_blank" rel="noopener noreferrer">{linkLabel(link)}</a></div>
      </div>
    {/if}
  {/if}

  {#if people.length}
    <div class="rule"></div>
    <div class="fact">
      <Icon name="people" size={18} color="var(--text-3)" label="Attendees" />
      <div>
        <div class="summary">{attendeeSummary(people)}</div>
        <ul class="people">
          {#each people as p, i (i)}
            <li>
              <Icon name={ANSWER[p.status].icon} size={15} weight={2.2} color={ANSWER[p.status].color} label={ANSWER[p.status].label} />
              <span>{p.name}</span>
              {#if p.organizer}<span class="organizer">Organizer</span>{/if}
            </li>
          {/each}
        </ul>
      </div>
    </div>
  {/if}

  {#if event.notes}
    <div class="rule"></div>
    <div class="fact"><Icon name="note" size={18} color="var(--text-3)" label="Notes" /><div class="notes">{event.notes}</div></div>
  {/if}

  <p class="source">From your Mac's calendar{updated ? `, updated ${updated}` : ''}. Read-only.</p>
</div>

<style>
  .details {
    width: 360px;
    max-width: 100%;
    /* A long event scrolls inside the pop-over rather than running off the window. */
    max-height: min(70vh, 640px);
    overflow-y: auto;
    box-sizing: border-box;
    padding: 10px 10px 6px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    text-align: left;
    font-size: 15px;
    line-height: 1.45;
    color: var(--text);
  }
  .head {
    display: flex;
    gap: 12px;
    align-items: flex-start;
  }
  .bar {
    width: 5px;
    align-self: stretch;
    border-radius: 3px;
    flex: none;
  }
  .what {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  h2 {
    margin: 0;
    font-size: 19px;
    font-weight: 700;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }
  .when {
    color: var(--text-2);
  }
  .calendar-name {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--text-3);
  }
  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
  }
  .close {
    flex: none;
    width: 30px;
    height: 30px;
    border: 0;
    border-radius: 15px;
    background: var(--chip-bg);
    color: var(--text-2);
    display: grid;
    place-items: center;
    cursor: pointer;
  }
  .rule {
    border-top: 1px solid var(--rule);
  }
  .fact {
    display: flex;
    gap: 12px;
    align-items: flex-start;
  }
  .fact > :global(svg) {
    flex: none;
    margin-top: 2px;
  }
  .fact > div {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .link a {
    color: var(--accent-text);
  }
  .summary {
    font-size: 13px;
    color: var(--text-3);
    margin-bottom: 2px;
  }
  .people {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .people li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 2px 0;
  }
  .organizer {
    font-size: 13px;
    color: var(--text-3);
  }
  .notes {
    white-space: pre-wrap;
  }
  .source {
    margin: 0;
    font-size: 12px;
    color: var(--text-3);
  }
  /* Phones: the sheet is the width of the screen. */
  @media (max-width: 767px) {
    .details {
      width: auto;
      max-height: none;
      padding: 4px 0 0;
    }
  }
</style>
