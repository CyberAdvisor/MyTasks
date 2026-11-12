<!--
  The bold ⋯ after a built-in list's title. Today's menu starts with its
  Group By choices (FR-16.1); every list's menu has Move to Completed
  (FR-12.2). Things has no menu here: grouping is an addition, and Things
  keeps Log Completed in its Items menu (decided 2026-11-12).
-->
<script lang="ts">
  import Icon from './Icon.svelte';
  import Popover from './Popover.svelte';
  import MoveToCompletedItem from './MoveToCompletedItem.svelte';
  import { settings } from '../lib/state/live';
  import { LIST_META } from '../lib/listMeta';
  import * as repo from '../lib/db/repo';
  import type { BuiltInList, TodayGrouping } from '../lib/model/lists';

  let { list }: { list: BuiltInList } = $props();

  const GROUPINGS: { value: TodayGrouping; label: string }[] = [
    { value: 'none', label: 'All' },
    { value: 'project', label: 'Projects' },
    { value: 'priority', label: 'Priorities' },
    { value: 'context', label: 'Contexts' },
  ];

  let open = $state(false);
  let title = $derived(LIST_META[list].title);

  /** Group Today this way; the app remembers the choice (FR-16.1). */
  function group(value: TodayGrouping) {
    open = false;
    void repo.setSetting('todayGrouping', value);
  }
</script>

<Popover bind:open label="{title} actions" align="left">
  {#snippet trigger(toggle, isOpen)}
    <button type="button" class="more-btn" aria-label="More {title} actions" aria-expanded={isOpen} onclick={toggle}>
      <Icon name="more" size={22} weight={3.5} />
    </button>
  {/snippet}
  <div role="menu" aria-label="{title} actions">
    {#if list === 'today'}
      <div class="menu-label" role="presentation">Group By</div>
      {#each GROUPINGS as g (g.value)}
        {@const chosen = $settings.todayGrouping === g.value}
        <button type="button" class="menu-item" role="menuitemradio" aria-checked={chosen} onclick={() => group(g.value)}>
          {#if chosen}<Icon name="check" size={15} />{:else}<span class="menu-icon-space"></span>{/if}
          {g.label}
        </button>
      {/each}
      <hr class="menu-sep" />
    {/if}
    <MoveToCompletedItem view={{ kind: 'list', list }} onchoose={() => (open = false)} />
  </div>
</Popover>
