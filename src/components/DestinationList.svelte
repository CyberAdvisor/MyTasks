<!--
  Destination list (FR-1.5): the Inbox, then each area with its projects and
  their headings, then projects with no area (model/destinations.ts). Used by
  the Move dialog and by Quick Entry. A filter field at the top narrows it as
  you type (review F10); Return picks the first match (once something is
  typed; not the area or project shown above it), Down moves into
  the list. With a keyboard the field takes focus at once; on touch screens
  it waits for a tap, so the keyboard doesn't cover the list.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import Icon from './Icon.svelte';
  import { fullSnapshot } from '../lib/state/live';
  import { destinations } from '../lib/model/destinations';
  import type { TodoPlacement } from '../lib/db/repo';

  let { onchoose }: { onchoose: (to: TodoPlacement) => void } = $props();

  let query = $state('');
  let field = $state<HTMLInputElement>();
  let list = $state<HTMLUListElement>();
  let rows = $derived(destinations($fullSnapshot, query));

  $effect(() => {
    if (!matchMedia('(pointer: coarse)').matches) void tick().then(() => field?.focus());
  });

  function onFieldKey(e: KeyboardEvent) {
    // Return picks the first place left by a filter; with nothing typed it does nothing.
    const first = rows.find((r) => r.match);
    if (e.key === 'Enter' && query.trim() && first) {
      e.preventDefault();
      onchoose(first.to);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      list?.querySelector('button')?.focus();
    }
  }

  /** Up and Down move through the places; Up from the first goes back to the field. */
  function onListKey(e: KeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const buttons = [...list!.querySelectorAll('button')];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = i + (e.key === 'ArrowDown' ? 1 : -1);
    if (next < 0) field?.focus();
    else buttons[Math.min(next, buttons.length - 1)]?.focus();
  }

  const INDENT = ['', 'indent', 'indent2'];
  const ICON = { inbox: 'inbox', area: 'area', heading: 'heading' } as const;
</script>

<input
  bind:this={field}
  bind:value={query}
  class="filter"
  type="search"
  placeholder="Filter"
  aria-label="Filter places"
  autocomplete="off"
  onkeydown={onFieldKey}
/>
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<ul bind:this={list} onkeydown={onListKey}>
  {#each rows as row (row.kind + row.id)}
    <li>
      <button type="button" class="{INDENT[row.depth] ?? 'indent2'} {row.kind === 'area' ? 'area' : ''}" onclick={() => onchoose(row.to)}>
        {#if row.kind === 'inbox'}<Icon name="inbox" color="var(--c-inbox)" />
        {:else if row.kind === 'area'}<Icon name={ICON.area} />
        {:else if row.kind === 'heading'}<Icon name={ICON.heading} size={14} />{/if}
        {row.title}
      </button>
    </li>
  {:else}
    <li class="none">No matching places</li>
  {/each}
</ul>

<style>
  .filter {
    width: 100%;
    box-sizing: border-box;
    margin: 0 0 8px;
    padding: 7px 10px;
    font-size: 14px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--field);
    color: var(--text);
  }
  .none {
    padding: 8px;
    font-size: 14px;
    color: var(--text-3);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    text-align: left;
    border: 0;
    background: transparent;
    padding: 8px 8px;
    border-radius: var(--radius);
    font-size: 14px;
    min-height: 36px;
  }
  li button:hover {
    background: var(--hover-bg);
  }
  .area {
    font-weight: 600;
  }
  .indent {
    padding-left: 34px;
  }
  .indent2 {
    padding-left: 52px;
    color: var(--text-2);
  }
</style>
