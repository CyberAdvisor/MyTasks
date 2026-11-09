<!--
  Tag picker contents (FR-6.2): tick tags on or off, or type a new tag name
  and press Enter to create and add it. The owner decides where the choice
  is written (a stored to-do, project or area, or a Quick Entry draft).
-->
<script lang="ts">
  import Icon from './Icon.svelte';
  import { snapshot } from '../lib/state/live';
  import { go } from '../lib/state/route';
  import { bySortKey } from '../lib/model/order';
  import * as repo from '../lib/db/repo';
  import type { ID } from '../lib/model/types';

  let {
    tagIds,
    ontoggle,
  }: {
    /** The tags currently set. */
    tagIds: ID[];
    /** Called to add (`on`) or remove a tag. */
    ontoggle: (tagId: ID, on: boolean) => void;
  } = $props();

  let filter = $state('');
  let input: HTMLInputElement;

  let tags = $derived(bySortKey($snapshot.tags));
  let shown = $derived(tags.filter((t) => t.title.toLowerCase().includes(filter.trim().toLowerCase())));
  let exact = $derived(tags.find((t) => t.title.toLowerCase() === filter.trim().toLowerCase()));

  $effect(() => input.focus());

  const toggle = (tagId: ID) => ontoggle(tagId, !tagIds.includes(tagId));

  /** Enter adds the matching tag, or creates a new one with the typed name. */
  async function onKey(e: KeyboardEvent) {
    if (e.key !== 'Enter' || !filter.trim()) return;
    e.preventDefault();
    const name = filter;
    filter = '';
    const tagId = exact?.id ?? (await repo.createTag(name));
    ontoggle(tagId, true);
  }
</script>

<div class="picker">
  <input
    bind:this={input}
    bind:value={filter}
    onkeydown={onKey}
    class="filter"
    placeholder="Find or create a tag"
    aria-label="Find or create a tag"
    autocomplete="off"
  />
  <ul>
    {#each shown as tag (tag.id)}
      <li>
        <button type="button" class="menu-item" role="menuitemcheckbox" aria-checked={tagIds.includes(tag.id)} onclick={() => toggle(tag.id)}>
          <span class="tick">{#if tagIds.includes(tag.id)}<Icon name="check" size={13} color="var(--accent)" />{/if}</span>
          {tag.title || 'Untitled'}
        </button>
      </li>
    {/each}
  </ul>
  {#if filter.trim() && !exact}
    <p class="hint">Press Enter to create “{filter.trim()}”</p>
  {:else if !tags.length}
    <p class="hint">No tags yet. Type a name and press Enter.</p>
  {/if}
  <hr class="menu-sep" />
  <button type="button" class="menu-item manage" onclick={() => go({ kind: 'settings' })}>Manage Tags…</button>
</div>

<style>
  .picker {
    width: 220px;
  }
  .filter {
    width: 100%;
    border: 1px solid #d6d6da;
    border-radius: var(--radius);
    padding: 5px 8px;
    font-size: 13px;
    margin-bottom: 4px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 220px;
    overflow-y: auto;
  }
  .tick {
    width: 14px;
    display: inline-flex;
  }
  .hint {
    margin: 4px 10px;
    font-size: 12px;
    color: var(--text-3);
  }
  .manage {
    color: var(--text-2);
    font-size: 13px;
  }
</style>
