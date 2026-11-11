<!--
  Month calendar used by the When and Deadline pickers (FR-3.1, FR-3.3).
  Monday first. Days before `min` are disabled. Arrow keys move between days.
-->
<script lang="ts">
  import Icon from './Icon.svelte';
  import { addDays, addMonths, formatMonth, monthGrid, monthStart, parseLocalDate } from '../lib/model/dates';
  import type { LocalDate } from '../lib/model/types';

  let {
    value = null,
    ref,
    min = null,
    onpick,
  }: {
    /** The selected date, highlighted. */
    value?: LocalDate | null;
    /** Today, marked in the grid. */
    ref: LocalDate;
    /** Earliest date that can be picked. */
    min?: LocalDate | null;
    onpick: (date: LocalDate) => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let month = $state(monthStart(value ?? ref));
  let grid: HTMLDivElement;

  let weeks = $derived(monthGrid(month));
  const DAY_NAMES = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
  const FULL = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  const disabled = (d: LocalDate) => min !== null && d < min;

  /** Arrow keys move focus by a day or a week, changing month as needed. */
  function onKey(e: KeyboardEvent, d: LocalDate) {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (!step) return;
    e.preventDefault();
    const next = addDays(d, step);
    month = monthStart(next);
    requestAnimationFrame(() => grid.querySelector<HTMLButtonElement>(`[data-date="${next}"]`)?.focus());
  }
</script>

<div class="cal">
  <div class="head">
    <button type="button" class="nav" aria-label="Previous month" onclick={() => (month = addMonths(month, -1))}>
      <Icon name="chevron-left" size={14} />
    </button>
    <span class="month" aria-live="polite">{formatMonth(month)}</span>
    <button type="button" class="nav" aria-label="Next month" onclick={() => (month = addMonths(month, 1))}>
      <Icon name="chevron-right" size={14} />
    </button>
  </div>
  <div class="grid" bind:this={grid} role="grid" aria-label={formatMonth(month)}>
    <div class="row" role="row">
      {#each DAY_NAMES as n (n)}<span class="dow" role="columnheader">{n}</span>{/each}
    </div>
    {#each weeks as week, wi (wi)}
      <div class="row" role="row">
        {#each week as d, di (di)}
          {#if d}
            <button
              type="button"
              role="gridcell"
              class="day"
              class:today={d === ref}
              class:selected={d === value}
              data-date={d}
              disabled={disabled(d)}
              aria-label={FULL.format(parseLocalDate(d))}
              aria-selected={d === value}
              onclick={() => onpick(d)}
              onkeydown={(e) => onKey(e, d)}
            >
              {Number(d.slice(8))}
            </button>
          {:else}
            <span class="day blank" role="gridcell"></span>
          {/if}
        {/each}
      </div>
    {/each}
  </div>
</div>

<style>
  .cal {
    padding: 4px 6px 6px;
    width: 224px;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 4px;
  }
  .month {
    font-size: 13px;
    font-weight: 600;
  }
  .nav {
    border: 0;
    background: transparent;
    padding: 4px;
    border-radius: var(--radius);
    display: inline-flex;
  }
  .nav:hover {
    background: var(--hover-bg);
  }
  .row {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
  }
  .dow {
    font-size: 11px;
    color: var(--text-3);
    text-align: center;
    padding: 2px 0;
  }
  .day {
    height: 28px;
    border: 0;
    background: transparent;
    border-radius: 50%;
    font-size: 13px;
    padding: 0;
  }
  .day:hover:not(:disabled) {
    background: var(--hover-bg);
  }
  .day.today {
    color: var(--accent-text);
    font-weight: 700;
  }
  .day.selected {
    background: var(--accent);
    color: var(--on-accent);
  }
  .day:disabled {
    color: var(--disabled);
    cursor: default;
  }
</style>
