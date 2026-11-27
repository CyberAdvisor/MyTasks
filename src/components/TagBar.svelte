<!--
  Filter bar (FR-6.3): the tags used in the current view.
  Selecting a tag shows only to-dos carrying it or a tag nested under it
  (directly or through their project or area); All clears it. Hidden when
  the view has no tagged items. Contexts were in the bar until 1.3.5; they
  are filtered by Today's Group By, a saved search's context, and search
  (Michael, 2026-11-18). Nested tags (FR-6.1b): a top-level tag stands for
  its family, marked "…" when nested tags are in use; selecting it adds
  pills for those, and its parents stay lit while one of them is selected.
-->
<script lang="ts">
  import { ui } from '../lib/state/ui.svelte';
  import { snapshot } from '../lib/state/live';
  import { activeTag, nextTagFilter, tagPills } from '../lib/model/tags';
  import type { Tag } from '../lib/model/types';

  /** `tags`: the tags used in the view. */
  let { tags }: { tags: Tag[] } = $props();

  let active = $derived(activeTag(ui.tagFilter, tags, $snapshot.tags));
  let pills = $derived(tagPills(tags, active, $snapshot.tags));

  // A tag the view has no tasks for isn't a filter here, so none is kept
  // hidden: its filter key does nothing (FR-6.4).
  $effect(() => {
    if (ui.tagFilter !== null && active === null) ui.tagFilter = null;
  });

  const selectTag = (id: string) => (ui.tagFilter = nextTagFilter(ui.tagFilter, id, $snapshot.tags));
  const clear = () => (ui.tagFilter = null);
</script>

{#if tags.length}
  <div class="bar" role="toolbar" aria-label="Filter">
    <button type="button" class="pill" aria-pressed={ui.tagFilter === null} onclick={clear}>All</button>
    {#each pills as { tag, on, more } (tag.id)}
      <button type="button" class="pill" aria-pressed={on} onclick={() => selectTag(tag.id)}>
        {tag.title || 'Untitled'}{more ? '…' : ''}
      </button>
    {/each}
  </div>
{/if}

<style>
  .bar {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    /* 12 px under the title; 26 px above the first task, as under a title with no tag row. */
    margin: -14px 0 26px 38px;
  }
  /* Phones: the same, against the phone header's larger margin. */
  @media (max-width: 767px) {
    .bar {
      margin: -24px 0 26px 34px;
    }
  }
  /* Under Today's calendar events (FR-21.3) or daily note (FR-24.1) the bar
     isn't pulled up to the title: the block's own 12 px margin is the gap, on
     every device. */
  :global(section.events) + .bar,
  :global(section.daily-note) + .bar {
    margin-top: 0;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border: 1px solid var(--line);
    background: var(--field);
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
    color: var(--on-accent);
  }
</style>
