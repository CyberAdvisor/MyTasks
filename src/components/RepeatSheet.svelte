<!--
  The Repeat sheet for phones (FR-4.1, FR-4.2; Edit Rule… FR-4.4), laid out
  for touch: ✕ and ✓ at the top, After Completion | Regularly with
  a line saying what each does, then rows (Every; On, Next and Ends for a
  regular repeat; Add Deadline), each opening its own screen with ‹ to come
  back. The pickers are native selects, which iPhone shows as wheels. The
  form and saving are shared with the desktop dialog
  (lib/state/repeatForm.svelte.ts). Shown in place of the dialog on touch
  screens under 768 px (App.svelte).
-->
<script lang="ts">
  import Icon from './Icon.svelte';
  import Segmented from './Segmented.svelte';
  import { MONTHS, WEEKDAYS, dayLabel, ordinalLabel } from '../lib/model/repeat';
  import type { RepeatUnit } from '../lib/model/types';
  import { fullSnapshot, todayDate } from '../lib/state/live';
  import { RepeatForm, UNITS } from '../lib/state/repeatForm.svelte';
  import { ui, type RepeatTarget } from '../lib/state/ui.svelte';

  let { target }: { target: RepeatTarget } = $props();

  // svelte-ignore state_referenced_locally
  const f = new RepeatForm(target, $fullSnapshot, $todayDate);

  type Screen = 'main' | 'every' | 'on' | 'next' | 'ends' | 'deadline';
  let screen = $state<Screen>('main');
  const TITLES: Record<Screen, string> = { main: 'Repeat', every: 'Repeat', on: 'Repeat', next: 'Next', ends: 'Ends', deadline: 'Deadline' };

  let dialog: HTMLDialogElement;
  $effect(() => dialog.showModal());

  let regularly = $derived(f.kind !== 'afterCompletion');
  /** The unit Every shows: a regular repeat's kind, or the after-completion unit. */
  let unit = $derived<RepeatUnit>(regularly ? (f.kind as RepeatUnit) : f.unit);

  /** "week", "2 weeks". */
  let everyLabel = $derived(f.interval > 1 ? `${f.interval} ${unit}s` : unit);
  /** "Mon and Wed", "16th day", "2nd Tuesday and last day". */
  let onLabel = $derived(
    f.kind === 'week'
      ? [...new Set(f.weekdays)].sort().map((d) => WEEKDAYS[d].slice(0, 3)).join(' and ')
      : f.days.map((d) => dayLabel(d).replace('the ', '')).join(' and ') + (f.kind === 'year' ? ` in ${MONTHS[f.month - 1]}` : ''),
  );
  let endsLabel = $derived(f.ends === 'never' ? 'Never' : f.ends === 'after' ? `After ${f.endCount} times` : f.dateLabel(f.endDate));
  let deadlineLabel = $derived(!f.deadlines ? '' : f.deadlineDays ? `${f.deadlineDays} day${f.deadlineDays > 1 ? 's' : ''} earlier` : 'same day');

  function close() {
    ui.repeating = null;
  }

  function save() {
    if (!f.canSave) return;
    f.save();
    close();
  }

  /** After Completion | Regularly: a regular repeat starts weekly. */
  function setMode(mode: 'after' | 'regular') {
    if (mode === 'regular' && !regularly) f.chooseKind('week');
    if (mode === 'after' && regularly) f.chooseKind('afterCompletion');
  }

  /** Every's unit: for a regular repeat it is the kind of repeat. */
  function setUnit(u: RepeatUnit) {
    if (regularly) f.chooseKind(u);
    else f.unit = u;
  }

  /** On, weekly: tick or untick a day; at least one stays ticked. */
  function toggleWeekday(d: number) {
    if (!f.weekdays.includes(d)) f.weekdays.push(d);
    else if (f.weekdays.length > 1) f.weekdays.splice(f.weekdays.indexOf(d), 1);
  }
</script>

{#snippet rowButton(label: string, value: string, to: Screen)}
  <button type="button" class="row" onclick={() => (screen = to)}>
    <span>{label}</span>
    <span class="value">{value} <Icon name="chevron-right" size={12} /></span>
  </button>
{/snippet}

<dialog
  bind:this={dialog}
  aria-labelledby="repeat-sheet-title"
  oncancel={(e) => {
    e.preventDefault();
    if (screen === 'main') close();
    else screen = 'main';
  }}
>
  <div class="head">
    {#if screen === 'main'}
      <button type="button" class="circle" aria-label="Cancel" onclick={close}><Icon name="x" size={16} /></button>
    {:else}
      <button type="button" class="circle" aria-label="Back" onclick={() => (screen = 'main')}><Icon name="chevron-left" size={16} /></button>
    {/if}
    <h2 id="repeat-sheet-title">{TITLES[screen]}</h2>
    {#if screen === 'main'}
      <button type="button" class="circle done" aria-label="Save" disabled={!f.canSave} onclick={save}><Icon name="check" size={16} /></button>
    {:else}
      <span class="circle-space"></span>
    {/if}
  </div>

  {#if screen === 'main'}
    <div class="mode">
      <Segmented
        label="Repeat"
        options={[{ value: 'after', label: 'After Completion' }, { value: 'regular', label: 'Regularly' }]}
        value={regularly ? 'regular' : 'after'}
        onchange={setMode}
      />
    </div>
    <p class="explain">
      {#if regularly}
        You'll get a new copy regularly, whether you've completed the previous task or not.
      {:else}
        You'll get a new copy <strong>{f.interval} {f.interval > 1 ? `${unit}s` : unit}</strong> after you've completed the previous task.
      {/if}
    </p>
    <div class="group">
      {@render rowButton('Every', everyLabel, 'every')}
      {#if regularly && f.kind !== 'day'}{@render rowButton('On', onLabel, 'on')}{/if}
    </div>
    {#if regularly}
      <div class="group">
        {@render rowButton('Next', f.nextDate ? f.dateLabel(f.nextDate) : '—', 'next')}
        {@render rowButton('Ends', endsLabel, 'ends')}
      </div>
    {/if}
    <button type="button" class="row plain" onclick={() => (screen = 'deadline')}>
      <span><Icon name="flag" size={14} /> {f.deadlines ? 'Deadline' : 'Add Deadline'}</span>
      <span class="value">{deadlineLabel} <Icon name="chevron-right" size={12} /></span>
    </button>
  {:else if screen === 'every'}
    <div class="group pad">
      <div class="line">
        <span>Every</span>
        <select aria-label="How many" value={String(f.interval)} onchange={(e) => (f.interval = Number(e.currentTarget.value))}>
          {#each Array.from({ length: 30 }, (_, n) => n + 1) as n (n)}<option value={String(n)}>{n}</option>{/each}
        </select>
        <select aria-label="Unit" value={unit} onchange={(e) => setUnit(e.currentTarget.value as RepeatUnit)}>
          {#each UNITS as u (u)}<option value={u}>{f.interval > 1 ? `${u}s` : u}</option>{/each}
        </select>
      </div>
    </div>
  {:else if screen === 'on'}
    {#if f.kind === 'week'}
      <div class="group">
        {#each WEEKDAYS as name, d (d)}
          <button type="button" class="row" aria-pressed={f.weekdays.includes(d)} onclick={() => toggleWeekday(d)}>
            <span>On {name}</span>
            {#if f.weekdays.includes(d)}<Icon name="check" size={14} color="var(--accent)" />{/if}
          </button>
        {/each}
      </div>
    {:else}
      <div class="group pad">
        {#each f.days as day, i (i)}
          <div class="line">
            <span>{i === 0 ? 'On the' : 'and the'}</span>
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
                f.days[i] = { weekday: w, ordinal: w !== null && day.ordinal > 5 ? 1 : day.ordinal };
              }}
            >
              <option value="day">day</option>
              {#each WEEKDAYS as name, w (w)}<option value={String(w)}>{name}</option>{/each}
            </select>
            {#if f.days.length > 1}
              <button type="button" class="round" aria-label="Remove this day" onclick={() => f.days.splice(i, 1)}><Icon name="minus" size={12} /></button>
            {/if}
          </div>
        {/each}
        {#if f.kind === 'year'}
          <div class="line">
            <span>In</span>
            <select aria-label="Month" value={String(f.month)} onchange={(e) => (f.month = Number(e.currentTarget.value))}>
              {#each MONTHS as name, m (m)}<option value={String(m + 1)}>{name}</option>{/each}
            </select>
          </div>
        {/if}
      </div>
      <button type="button" class="wide" onclick={() => f.addDay(f.days.length - 1)}>Add More</button>
    {/if}
  {:else if screen === 'next'}
    <div class="group">
      {#each f.choices as d (d)}
        <button type="button" class="row" aria-pressed={d === f.nextDate} onclick={() => ((f.next = d), (screen = 'main'))}>
          <span>{f.dateLabel(d)}</span>
          {#if d === f.nextDate}<Icon name="check" size={14} color="var(--accent)" />{/if}
        </button>
      {/each}
    </div>
  {:else if screen === 'ends'}
    <div class="mode">
      <Segmented
        label="Ends"
        options={[{ value: 'never', label: 'Never' }, { value: 'date', label: 'On Date' }, { value: 'after', label: 'After' }]}
        value={f.ends}
        onchange={(v) => (f.ends = v)}
      />
    </div>
    {#if f.ends === 'never'}
      <p class="explain center">This task repeats forever.</p>
    {:else if f.ends === 'after'}
      <div class="group pad">
        <div class="line">
          <span>After</span>
          <select aria-label="Times" value={String(f.endCount)} onchange={(e) => (f.endCount = Number(e.currentTarget.value))}>
            {#each Array.from({ length: 99 }, (_, n) => n + 1) as n (n)}<option value={String(n)}>{n}</option>{/each}
          </select>
          <span>{f.endCount === 1 ? 'time' : 'times'}</span>
        </div>
      </div>
    {:else}
      <div class="group pad">
        <div class="line">
          <span>On</span>
          <input type="date" aria-label="End date" min={f.nextDate ?? f.ref} value={f.endDate} onchange={(e) => (f.endDate = e.currentTarget.value || f.ref)} />
        </div>
      </div>
    {/if}
  {:else if screen === 'deadline'}
    <div class="group">
      <label class="row">
        <span>Add Deadline</span>
        <input type="checkbox" class="switch" bind:checked={f.deadlines} />
      </label>
    </div>
    {#if f.deadlines}
      <p class="explain">
        Each copy has a deadline. It will appear in your Today list {f.deadlineDays ? `${f.deadlineDays} day${f.deadlineDays > 1 ? 's' : ''} earlier` : 'on the same day'}.
      </p>
      <div class="group pad">
        <div class="line">
          <select aria-label="Days earlier" value={String(f.deadlineDays)} onchange={(e) => (f.deadlineDays = Number(e.currentTarget.value))}>
            <option value="0">same day</option>
            {#each Array.from({ length: 30 }, (_, n) => n + 1) as n (n)}<option value={String(n)}>{n} day{n > 1 ? 's' : ''} earlier</option>{/each}
          </select>
        </div>
      </div>
    {/if}
  {/if}
</dialog>

<style>
  dialog {
    border: 0;
    border-radius: 16px;
    padding: 14px 14px 18px;
    width: calc(100% - 24px);
    max-width: 420px;
    min-height: 420px;
    font-size: 16px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  }
  dialog::backdrop {
    background: var(--overlay);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }
  h2 {
    margin: 0;
    font-size: 17px;
  }
  .circle,
  .circle-space {
    width: 36px;
    height: 36px;
  }
  .circle {
    border: 1px solid var(--line);
    border-radius: 50%;
    background: transparent;
    color: var(--text);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  }
  .circle.done {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--on-accent);
  }
  .circle.done:disabled {
    opacity: 0.5;
  }
  .mode {
    display: flex;
    justify-content: center;
    margin-bottom: 10px;
  }
  .explain {
    color: var(--text-2);
    font-size: 14px;
    margin: 0 4px 12px;
  }
  .explain strong {
    color: var(--accent-text);
    font-weight: 500;
  }
  .center {
    text-align: center;
  }
  .group {
    background: var(--chip-bg);
    border-radius: 10px;
    margin-bottom: 10px;
    overflow: hidden;
  }
  .group.pad {
    padding: 6px 12px;
  }
  .row {
    display: flex;
    width: 100%;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 11px 12px;
    border: 0;
    border-bottom: 1px solid var(--rule);
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: left;
  }
  .group .row:last-child {
    border-bottom: 0;
  }
  .row.plain {
    border: 0;
    color: var(--text-2);
  }
  .value {
    color: var(--accent-text);
    display: inline-flex;
    align-items: center;
    gap: 4px;
    text-align: right;
  }
  .line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    min-height: 40px;
  }
  select,
  input[type='date'] {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 6px 8px;
    font: inherit;
    font-size: 16px;
    background: var(--bg);
    color: var(--text);
  }
  .round {
    width: 26px;
    height: 26px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--hover-bg);
    color: var(--text-2);
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .wide {
    width: 100%;
    padding: 11px;
    border: 1px solid var(--line);
    border-radius: 22px;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-weight: 600;
  }
  .switch {
    width: 20px;
    height: 20px;
    accent-color: var(--accent);
  }
</style>
