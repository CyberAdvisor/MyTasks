<!--
  An editable list of named items for Settings (tags, FR-6.1; contexts,
  FR-18.2): rename in place, move up or down, delete, and add at the end.
  A blank name is not allowed, so the old one comes back.
-->
<script lang="ts">
  import Icon from './Icon.svelte';
  import type { ID } from '../lib/model/types';

  type Item = { id: ID; title: string };
  type IconName = 'tag' | 'context';

  let {
    items,
    icon,
    noun,
    onrename,
    onmove,
    ondelete,
    onadd,
  }: {
    items: Item[];
    icon: IconName;
    /** Singular, capitalised, e.g. "Tag". */
    noun: string;
    onrename: (id: ID, title: string) => void;
    onmove: (id: ID, direction: 'up' | 'down') => void;
    /** Ask before deleting; the caller confirms. */
    ondelete: (item: Item) => void;
    onadd: (title: string) => Promise<unknown>;
  } = $props();

  let draft = $state('');
  let lower = $derived(noun.toLowerCase());

  function rename(item: Item, input: HTMLInputElement) {
    const title = input.value.trim();
    if (!title) input.value = item.title;
    else if (title !== item.title) onrename(item.id, title);
  }

  async function add(e: SubmitEvent) {
    e.preventDefault();
    const title = draft.trim();
    if (!title) return;
    // Clear first, so a name typed while this one saves is not lost.
    draft = '';
    await onadd(title);
  }

  /** Enter saves the field by leaving it. */
  const blurOnEnter = (e: KeyboardEvent) => {
    if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
  };
</script>

{#if items.length}
  <ul class="rows">
    {#each items as item, i (item.id)}
      <li>
        <Icon name={icon} size={14} color="var(--text-3)" />
        <input
          class="text"
          value={item.title}
          aria-label="{noun} name"
          onchange={(e) => rename(item, e.currentTarget)}
          onkeydown={blurOnEnter}
        />
        <button type="button" class="btn-plain small" aria-label="Move {item.title} up" disabled={i === 0} onclick={() => onmove(item.id, 'up')}>
          <Icon name="arrow-up" size={14} />
        </button>
        <button type="button" class="btn-plain small" aria-label="Move {item.title} down" disabled={i === items.length - 1} onclick={() => onmove(item.id, 'down')}>
          <Icon name="arrow-down" size={14} />
        </button>
        <button type="button" class="btn-plain small danger" aria-label="Delete {item.title}" onclick={() => ondelete(item)}>
          <Icon name="trash" size={14} />
        </button>
      </li>
    {/each}
  </ul>
{:else}
  <p class="help">No {lower}s yet.</p>
{/if}
<form class="add" onsubmit={add}>
  <input class="text" bind:value={draft} placeholder="New {lower}" aria-label="New {lower} name" />
  <button type="submit" class="btn-plain" disabled={!draft.trim()}><Icon name="plus" size={14} /> Add {noun}</button>
</form>

<style>
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .rows li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
  }
  .text {
    border: 1px solid #d6d6da;
    border-radius: var(--radius);
    padding: 5px 8px;
    font-size: 14px;
    width: 220px;
    max-width: 100%;
  }
  .small {
    padding: 4px 6px;
    font-size: 13px;
  }
  .danger {
    color: var(--danger);
  }
  .help {
    font-size: 13px;
    color: var(--text-3);
    margin: 4px 0 10px;
  }
  .add {
    display: flex;
    gap: 8px;
    margin-top: 10px;
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
