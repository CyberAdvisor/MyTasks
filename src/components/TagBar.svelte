<!--
  Filter bar (FR-6.3, FR-18.5): the tags, then the contexts, used in the
  current view. Selecting a tag shows only to-dos carrying it (directly or
  through their project or area); selecting a context shows only to-dos in
  it. One tag and one context can be active together; All clears both.
  Hidden when the view has no tagged items and no contexts.
-->
<script lang="ts">
  import Icon from './Icon.svelte';
  import { ui } from '../lib/state/ui.svelte';
  import type { Context, Tag } from '../lib/model/types';

  let { tags, contexts = [] }: { tags: Tag[]; contexts?: Context[] } = $props();

  const selectTag = (id: string) => (ui.tagFilter = ui.tagFilter === id ? null : id);
  const selectContext = (id: string) => (ui.contextFilter = ui.contextFilter === id ? null : id);

  function clear() {
    ui.tagFilter = null;
    ui.contextFilter = null;
  }
</script>

{#if tags.length || contexts.length}
  <div class="bar" role="toolbar" aria-label="Filter">
    <button type="button" class="pill" aria-pressed={ui.tagFilter === null && ui.contextFilter === null} onclick={clear}>All</button>
    {#each tags as tag (tag.id)}
      <button type="button" class="pill" aria-pressed={ui.tagFilter === tag.id} onclick={() => selectTag(tag.id)}>
        {tag.title || 'Untitled'}
      </button>
    {/each}
    {#each contexts as c (c.id)}
      <button type="button" class="pill" aria-label="Context {c.title || 'Untitled'}" aria-pressed={ui.contextFilter === c.id} onclick={() => selectContext(c.id)}>
        <Icon name="context" size={11} />{c.title || 'Untitled'}
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
    display: inline-flex;
    align-items: center;
    gap: 4px;
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
