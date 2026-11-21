<!--
  The Repeat dialog (FR-4.1, FR-4.2; Edit Rule… FR-4.4), for wider screens:
  a Repeat pop-up (after completion, daily, weekly, monthly,
  yearly), then the rows the choice needs, Next and Ends for a fixed
  schedule, and "Add deadlines and start N days earlier". Choosing another
  kind of repeat resets Next and Ends. OK makes the task the
  template (repo.setRepeat), one undo step; Cancel or Escape changes
  nothing. Opened from the task menu (`ui.repeatingId`); the form itself is
  shared with the phone sheet (lib/state/repeatForm.svelte.ts).
-->
<script lang="ts">
  import Icon from './Icon.svelte';
  import { formatNumeric } from '../lib/model/dates';
  import { MONTHS, WEEKDAYS, ordinalLabel } from '../lib/model/repeat';
  import type { RepeatDay, RepeatUnit } from '../lib/model/types';
  import { fullSnapshot, todayDate } from '../lib/state/live';
  import { KINDS, RepeatForm, UNITS, type RepeatKind } from '../lib/state/repeatForm.svelte';
  import { ui, type RepeatTarget } from '../lib/state/ui.svelte';

  let { target }: { target: RepeatTarget } = $props();

  // svelte-ignore state_referenced_locally
  const f = new RepeatForm(target, $fullSnapshot, $todayDate);

  let dialog: HTMLDialogElement;
  $effect(() => dialog.showModal());

  function close() {
    ui.repeating = null;
  }

  function ok() {
    if (!f.canSave) return;
    f.save();
    close();
  }
</script>

{#snippet number(value: number, set: (v: number) => void, label: string, min = 1)}
  <input
    class="num"
    type="number"
    inputmode="numeric"
    {min}
    max="999"
    aria-label={label}
    {value}
    oninput={(e) => set(e.currentTarget.valueAsNumber)}
  />
{/snippet}

{#snippet plusMinus(count: number, add: () => void, remove: () => void, what: string)}
  <button type="button" class="round" aria-label="Add another {what}" onclick={add}><Icon name="plus" size={12} /></button>
  {#if count > 1}
    <button type="button" class="round" aria-label="Remove this {what}" onclick={remove}><Icon name="minus" size={12} /></button>
  {/if}
{/snippet}

{#snippet dayRow(day: RepeatDay, i: number)}
  <select
    aria-label="Which"
    value={String(day.ordinal)}
    onchange={(e) => (f.days[i] = { ...day, ordinal: Number(e.currentTarget.value) })}
  >
    <option value="-1">last</option>
    {#each Array.from({ length: day.weekday === null ? 31 : 5 }, (_, n) => n + 1) as n (n)}
      <option value={String(n)}>{ordinalLabel(n)}</option>
    {/each}
  </select>
  <select
    aria-label="Day"
    value={day.weekday === null ? 'day' : String(day.weekday)}
    onchange={(e) => {
      const w = e.currentTarget.value === 'day' ? null : Number(e.currentTarget.value);
      // A weekday has at most five in a month.
      f.days[i] = { weekday: w, ordinal: w !== null && day.ordinal > 5 ? 1 : day.ordinal };
    }}
  >
    <option value="day">day</option>
    {#each WEEKDAYS as name, w (w)}<option value={String(w)}>{name}</option>{/each}
  </select>
{/snippet}

<dialog
  bind:this={dialog}
  aria-labelledby="repeat-title"
  oncancel={(e) => {
    e.preventDefault();
    close();
  }}
>
  <div class="head">
    <Icon name="repeat" size={16} color="var(--accent)" />
    <h2 id="repeat-title">Repeat</h2>
    <select aria-label="Repeat" value={f.kind} onchange={(e) => f.chooseKind(e.currentTarget.value as RepeatKind)}>
      {#each KINDS as k (k.value)}<option value={k.value}>{k.label}</option>{/each}
    </select>
  </div>

  <div class="box">
    {#if f.kind === 'afterCompletion'}
      <div class="line">
        {@render number(f.interval, (v) => (f.interval = v), 'How many')}
        <select aria-label="Unit" value={f.unit} onchange={(e) => (f.unit = e.currentTarget.value as RepeatUnit)}>
          {#each UNITS as u (u)}<option value={u}>{u}</option>{/each}
        </select>
        <span>after the previous task is completed.</span>
      </div>
    {:else}
      <div class="line">
        <span>Every</span>
        {@render number(f.interval, (v) => (f.interval = v), 'Every')}
        <span>{f.kind === 'day' ? 'days' : `${f.kind}s`}{f.kind === 'week' ? ' on' : f.kind === 'day' ? '' : ' on the'}</span>
        {#if f.kind === 'week'}
          <select aria-label="Weekday" value={String(f.weekdays[0])} onchange={(e) => (f.weekdays[0] = Number(e.currentTarget.value))}>
            {#each WEEKDAYS as name, w (w)}<option value={String(w)}>{name}</option>{/each}
          </select>
          {@render plusMinus(f.weekdays.length, () => f.addWeekday(0), () => f.weekdays.splice(0, 1), 'day')}
        {:else if f.kind !== 'day'}
          {@render dayRow(f.days[0], 0)}
          {#if f.kind === 'year'}
            <span>in</span>
            <select aria-label="Month" value={String(f.month)} onchange={(e) => (f.month = Number(e.currentTarget.value))}>
              {#each MONTHS as name, m (m)}<option value={String(m + 1)}>{name}</option>{/each}
            </select>
          {/if}
          {@render plusMinus(f.days.length, () => f.addDay(0), () => f.days.splice(0, 1), 'day')}
        {/if}
      </div>
      {#if f.kind === 'week'}
        {#each f.weekdays.slice(1) as w, j (j)}
          <div class="line more">
            <span>and on</span>
            <select aria-label="Weekday" value={String(w)} onchange={(e) => (f.weekdays[j + 1] = Number(e.currentTarget.value))}>
              {#each WEEKDAYS as name, n (n)}<option value={String(n)}>{name}</option>{/each}
            </select>
            {@render plusMinus(f.weekdays.length, () => f.addWeekday(j + 1), () => f.weekdays.splice(j + 1, 1), 'day')}
          </div>
        {/each}
      {:else if f.kind === 'month' || f.kind === 'year'}
        {#each f.days.slice(1) as d, j (j)}
          <div class="line more">
            <span>and on the</span>
            {@render dayRow(d, j + 1)}
            {@render plusMinus(f.days.length, () => f.addDay(j + 1), () => f.days.splice(j + 1, 1), 'day')}
          </div>
        {/each}
      {/if}
      <hr />
      <div class="line">
        <span>Next:</span>
        <select aria-label="Next" value={f.nextDate ?? ''} onchange={(e) => (f.next = e.currentTarget.value)}>
          {#each f.choices as d (d)}<option value={d}>{f.dateLabel(d)}</option>{/each}
        </select>
        {#if f.preview.length}<span class="dim">{f.preview.map(formatNumeric).join(', ')}, …</span>{/if}
      </div>
      <hr />
      <div class="line">
        <span>Ends</span>
        <select aria-label="Ends" value={f.ends} onchange={(e) => (f.ends = e.currentTarget.value as typeof f.ends)}>
          <option value="never">never</option>
          <option value="after">after</option>
          <option value="date">on date</option>
        </select>
        {#if f.ends === 'after'}
          {@render number(f.endCount, (v) => (f.endCount = v), 'Times')}
          <span>times</span>
        {:else if f.ends === 'date'}
          <input type="date" aria-label="End date" min={f.nextDate ?? f.ref} value={f.endDate} onchange={(e) => (f.endDate = e.currentTarget.value || f.ref)} />
        {/if}
      </div>
    {/if}
  </div>

  <label class="check-line">
    <input type="checkbox" bind:checked={f.deadlines} />
    <span>Add deadlines</span>
    {#if f.deadlines}
      <span>and start</span>
      {@render number(f.deadlineDays, (v) => (f.deadlineDays = v), 'Days earlier', 0)}
      <span>days earlier</span>
    {/if}
  </label>

  <div class="actions">
    <button type="button" class="btn-plain" onclick={close}>Cancel</button>
    <button type="button" class="ok" disabled={!f.canSave} onclick={ok}>OK</button>
  </div>
</dialog>

<style>
  dialog {
    border: 0;
    border-radius: 12px;
    padding: 16px 18px 14px;
    max-width: 520px;
    width: calc(100% - 32px);
    box-shadow: var(--shadow-dialog);
    font-size: 14px;
  }
  dialog::backdrop {
    background: var(--overlay);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
  }
  h2 {
    margin: 0;
    font-size: 15px;
  }
  .box {
    background: var(--chip-bg);
    border-radius: var(--radius);
    padding: 10px 12px;
  }
  .line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    min-height: 30px;
  }
  .more {
    padding-left: 24px;
  }
  hr {
    border: 0;
    border-top: 1px solid var(--rule);
    margin: 8px 0;
  }
  .dim {
    color: var(--text-3);
    font-size: 13px;
  }
  select,
  input[type='number'],
  input[type='date'] {
    min-width: 0;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 3px 6px;
    font: inherit;
    font-size: 14px;
    background: var(--bg);
    color: var(--text);
  }
  .num {
    width: 3.5em;
  }
  .round {
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--hover-bg);
    color: var(--text-2);
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .check-line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin: 12px 0 4px;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 10px;
  }
  .ok {
    border: 0;
    border-radius: var(--radius);
    background: var(--accent);
    color: var(--on-accent);
    padding: 7px 18px;
    font-weight: 600;
  }
  .ok:disabled {
    opacity: 0.5;
  }
</style>
