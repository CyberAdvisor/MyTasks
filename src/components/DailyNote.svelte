<!--
  A day's daily note (FR-24.1), in Today between the calendar events and the
  tag bar: one bullet per line, shown with light Markdown (FR-7.4), editing on
  a click (NotesField with `bullets`).

  Saved 300 ms after typing stops, on leaving the note, and when the app is
  hidden (onHide). While the note is being edited, a change synced from
  another device doesn't replace what's typed; it shows once the note is left.
-->
<script lang="ts">
  import NotesField from './NotesField.svelte';
  import { dayNotes, saveNote } from '../lib/notes/store';
  import { onHide } from '../lib/state/onHide';
  import { formatWeekdayDate } from '../lib/model/dates';
  import type { LocalDate } from '../lib/model/types';

  let { date }: { date: LocalDate } = $props();

  const SAVE_DELAY_MS = 300;

  let value = $state('');
  let focused = $state(false);
  let typed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  // The saved note, whenever it isn't being edited (a new day, or a sync).
  $effect(() => {
    const saved = $dayNotes.get(date)?.text ?? '';
    if (!focused && !typed) value = saved;
  });

  /** Save what's typed now, if anything is waiting. */
  function save() {
    clearTimeout(timer);
    if (!typed) return;
    typed = false;
    void saveNote(date, value);
  }

  $effect(() => onHide(save));
  // A new day, or leaving the page: save what's waiting for the day it was typed on.
  $effect(() => {
    void date;
    return () => save();
  });

  function input() {
    typed = true;
    clearTimeout(timer);
    timer = setTimeout(save, SAVE_DELAY_MS);
  }
</script>

<section class="daily-note" aria-labelledby="daily-note-heading">
  <div class="head">
    <h2 id="daily-note-heading">Daily Note</h2>
    <span class="date">{formatWeekdayDate(date)}</span>
  </div>
  <NotesField
    bind:value
    label="Daily note for {formatWeekdayDate(date)}"
    placeholder="Add a line…"
    bullets
    oninput={input}
    onfocus={() => (focused = true)}
    onblur={() => {
      focused = false;
      save();
    }}
  />
</section>

<style>
  .daily-note {
    margin: 0 0 12px;
    padding: 8px 12px 6px;
    border: 1px solid var(--line);
    border-radius: 10px;
  }
  .head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 2px;
  }
  h2 {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-2);
  }
  .date {
    font-size: 12px;
    color: var(--text-2);
  }
  /* The note reads as the user's own text, a little darker than a task's notes. */
  .daily-note :global(.notes),
  .daily-note :global(.notes-view) {
    color: var(--text);
  }
</style>
