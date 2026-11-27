<!--
  The typing field at the top of the Start Date and Deadline pickers
  (FR-3.2), with its heading, "Type a date", which stays while typing
  (the placeholder holds only examples). The line under it shows the date it understood ("Thu, Nov 19"),
  a reason the date can't be used, or examples; Return chooses the date.
  With a mouse or keyboard it has focus when the picker opens; on touch
  screens it waits for a tap, so the keyboard doesn't cover the sheet.
-->
<script lang="ts">
  import { formatWeekdayDate } from '../lib/model/dates';
  import { parseTypedDate } from '../lib/model/typedDate';
  import type { LocalDate } from '../lib/model/types';

  let {
    ref,
    blocked = () => null,
    onpreview,
    onpick,
  }: {
    /** Today, which typed dates count from. */
    ref: LocalDate;
    /** Why a date can't be chosen here (a start date after the deadline), or null. */
    blocked?: (date: LocalDate) => string | null;
    /** Called with the understood date as the text changes (null for none), so the calendar can show it. */
    onpreview: (date: LocalDate | null) => void;
    /** Called when Return chooses a usable date. */
    onpick: (date: LocalDate) => void;
  } = $props();

  let text = $state('');
  let input: HTMLInputElement;

  let date = $derived(parseTypedDate(text, ref));
  let reason = $derived(date ? blocked(date) : null);

  $effect(() => onpreview(date));
  $effect(() => {
    if (!matchMedia('(pointer: coarse)').matches) input.focus();
  });

  function onKey(e: KeyboardEvent) {
    if (e.key !== 'Enter') return;
    // Return belongs to the field, not the card or Quick Entry around it.
    e.preventDefault();
    e.stopPropagation();
    if (date && !reason) onpick(date);
  }
</script>

<label class="typed-label">
  <span class="typed-heading">Type a date</span>
  <input
    bind:this={input}
    bind:value={text}
    onkeydown={onKey}
    class="typed"
    placeholder="tom, next fri, jan 12"
    aria-describedby="typed-date-result"
    autocomplete="off"
    autocapitalize="off"
    spellcheck="false"
  />
</label>
{#if text.trim()}
  <p id="typed-date-result" class="result" class:off={!date || reason} role="status">
    {#if !date}
      Try “fri”, “in 3 days” or “jan 12”
    {:else if reason}
      {reason}
    {:else}
      {formatWeekdayDate(date)} · press Return
    {/if}
  </p>
{/if}

<style>
  .typed-label {
    display: block;
  }
  .typed-heading {
    display: block;
    padding: 0 2px 3px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-2);
  }
  .typed {
    width: 100%;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 5px 8px;
    font-size: 13px;
    margin-bottom: 4px;
  }
  /* 16 px on touch screens, so Safari on iPhone doesn't zoom in on focus. */
  @media (pointer: coarse) {
    .typed {
      font-size: 16px;
    }
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
</style>
