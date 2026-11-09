<!--
  Tag filter bar (FR-6.3): the tags used in the current view. Selecting one
  shows only to-dos carrying it (directly or through their project or area).
  Hidden when the view has no tagged items.
-->
<script lang="ts">
  import { ui } from '../lib/state/ui.svelte';
  import type { Tag } from '../lib/model/types';

  let { tags }: { tags: Tag[] } = $props();

  const select = (id: string | null) => (ui.tagFilter = ui.tagFilter === id ? null : id);
</script>

{#if tags.length}
  <div class="bar" role="toolbar" aria-label="Filter by tag">
    <button type="button" class="pill" aria-pressed={ui.tagFilter === null} onclick={() => (ui.tagFilter = null)}>All</button>
    {#each tags as tag (tag.id)}
      <button type="button" class="pill" aria-pressed={ui.tagFilter === tag.id} onclick={() => select(tag.id)}>
        {tag.title || 'Untitled'}
      </button>
    {/each}
  </div>
{/if}

<style>
  .bar {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: -6px 0 16px 38px;
  }
  .pill {
    border: 1px solid #d6d6da;
    background: #fff;
    border-radius: 999px;
    padding: 3px 10px;
    font-size: 12px;
    color: var(--text-2);
  }
  .pill:hover {
    background: var(--hover-bg);
  }
  .pill[aria-pressed='true'] {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
</style>
