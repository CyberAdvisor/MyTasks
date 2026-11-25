<!--
  Reminder picker contents (FR-3.8), like the Start Date picker: a field for
  typing a date and time ("tomorrow 9am", "fri 2:30pm", "in 2 hours"), the
  line saying what it understood, the presets (Later Today, Tomorrow, On the
  start date), a month calendar, a time field and Clear Reminder. A date
  chosen in the calendar takes the time field's time. On a repeating task's
  template it asks only for a time, as each copy reminds on its own day.
  With a mouse or keyboard the typing field has focus when it opens; on
  touch screens it waits for a tap.
-->
<script lang="ts">
  import Icon from './Icon.svelte';
  import MonthCalendar from './MonthCalendar.svelte';
  import { DEFAULT_TIME, formatTime, parseTypedReminder, reminderAt, reminderDate, reminderLabel, reminderPresets, reminderTime } from '../lib/model/reminder';
  import type { LocalDate } from '../lib/model/types';

  let {
    reminder,
    template = false,
    startDate = null,
    ref,
    onchoose,
  }: {
    /** The task's reminder, or null. */
    reminder: string | null;
    /** A repeating task's template: a time only. */
    template?: boolean;
    /** The task's start date, for the On the start date preset. */
    startDate?: LocalDate | null;
    ref: LocalDate;
    /** Called with the new reminder (a time only on a template); null clears it. */
    onchoose: (reminder: string | null) => void;
  } = $props();

  /** The time a date picked in the calendar takes. */
  // svelte-ignore state_referenced_locally
  let time = $state(reminder ? reminderTime(reminder) : DEFAULT_TIME);
  let text = $state('');
  let input = $state<HTMLInputElement>();

  let typed = $derived(parseTypedReminder(text, new Date()));
  let presets = $derived(reminderPresets(new Date(), startDate));

  $effect(() => {
    if (input && !matchMedia('(pointer: coarse)').matches) input.focus();
  });

  function onKey(e: KeyboardEvent) {
    if (e.key !== 'Enter') return;
    // Return belongs to the field, not the card around it.
    e.preventDefault();
    e.stopPropagation();
    if (typed) onchoose(template ? reminderTime(typed) : typed);
  }

  /** A changed time applies at once to a reminder already set; otherwise it waits for a date. */
  function changeTime() {
    if (!time) return;
    if (template) onchoose(time);
    else if (reminder && reminderDate(reminder)) onchoose(reminderAt(reminderDate(reminder)!, time));
  }
</script>

<div class="reminder">
  {#if template}
    <p class="note">Reminder on each copy's day</p>
  {:else}
    <input
      bind:this={input}
      bind:value={text}
      onkeydown={onKey}
      class="typed"
      placeholder="Type a date and time: tom 9am"
      aria-label="Type a date and time"
      aria-describedby="typed-reminder-result"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
    />
    {#if text.trim()}
      <p id="typed-reminder-result" class="result" class:off={!typed} role="status">
        {#if typed}{reminderLabel(typed, ref)} · press Return{:else}Try “tomorrow 9am”, “fri 2:30pm” or “in 2 hours”{/if}
      </p>
    {/if}
    {#each presets as p (p.label)}
      <button type="button" class="menu-item preset" onclick={() => onchoose(p.value)}>
        {p.label}<span class="when">{reminderLabel(p.value, ref).replace(/^(Today|Tomorrow), /, '')}</span>
      </button>
    {/each}
    <hr class="menu-sep" />
    <MonthCalendar
      value={typed ? reminderDate(typed) : reminder ? reminderDate(reminder) : null}
      {ref}
      onpick={(d) => onchoose(reminderAt(d, time || DEFAULT_TIME))}
    />
  {/if}
  <label class="time">
    <span>Time</span>
    <input type="time" bind:value={time} onchange={changeTime} aria-label="Reminder time" />
    {#if template && time}<span class="hint">{formatTime(time)}</span>{/if}
  </label>
  {#if reminder}
    <hr class="menu-sep" />
    <button type="button" class="menu-item" onclick={() => onchoose(null)}>
      <Icon name="x" size={14} /> Clear Reminder
    </button>
  {/if}
</div>

<style>
  .reminder {
    display: flex;
    flex-direction: column;
    min-width: 224px;
  }
  .note {
    margin: 0;
    padding: 4px 8px 6px;
    font-size: 13px;
    font-weight: 600;
  }
  .typed {
    width: 100%;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 5px 8px;
    font-size: 13px;
    margin-bottom: 4px;
  }
  .result {
    margin: 0;
    padding: 0 8px 6px;
    font-size: 12px;
    color: var(--accent-text);
  }
  .result.off {
    color: var(--text-3);
  }
  .preset .when {
    margin-left: auto;
    padding-left: 12px;
    color: var(--text-3);
    font-size: 12px;
  }
  .time {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px 2px;
    font-size: 13px;
  }
  .time input {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 3px 6px;
    font: inherit;
    background: var(--field);
    color: var(--text);
  }
  .hint {
    color: var(--text-3);
    font-size: 12px;
  }
  /* 16 px on touch screens, so Safari on iPhone doesn't zoom in on focus. */
  @media (pointer: coarse) {
    .typed,
    .time input {
      font-size: 16px;
    }
  }
</style>
