<!--
  Destination list (FR-1.5): the Inbox, then each area with its projects and
  their headings, then projects with no area. Used by the Move dialog and by
  Quick Entry.
-->
<script lang="ts">
  import Icon from './Icon.svelte';
  import { snapshot } from '../lib/state/live';
  import { areaProjects } from '../lib/model/lists';
  import { bySortKey } from '../lib/model/order';
  import type { TodoPlacement } from '../lib/db/repo';
  import type { ID } from '../lib/model/types';

  let { onchoose }: { onchoose: (to: TodoPlacement) => void } = $props();

  let areas = $derived(bySortKey($snapshot.areas));

  function headingsOf(projectId: ID) {
    return bySortKey($snapshot.headings.filter((h) => h.projectId === projectId && !h.archived));
  }
</script>

<ul>
  <li><button type="button" onclick={() => onchoose({})}><Icon name="inbox" color="var(--c-inbox)" /> Inbox</button></li>
  {#each areas as area (area.id)}
    <li>
      <button type="button" class="area" onclick={() => onchoose({ areaId: area.id })}>
        <Icon name="area" /> {area.title || 'New Area'}
      </button>
    </li>
    {#each areaProjects($snapshot, area.id) as p (p.id)}
      <li><button type="button" class="indent" onclick={() => onchoose({ projectId: p.id })}>{p.title || 'New Project'}</button></li>
      {#each headingsOf(p.id) as h (h.id)}
        <li>
          <button type="button" class="indent2" onclick={() => onchoose({ projectId: p.id, headingId: h.id })}>
            <Icon name="heading" size={14} /> {h.title || 'Untitled heading'}
          </button>
        </li>
      {/each}
    {/each}
  {/each}
  {#each areaProjects($snapshot, null) as p (p.id)}
    <li><button type="button" onclick={() => onchoose({ projectId: p.id })}>{p.title || 'New Project'}</button></li>
    {#each headingsOf(p.id) as h (h.id)}
      <li>
        <button type="button" class="indent" onclick={() => onchoose({ projectId: p.id, headingId: h.id })}>
          <Icon name="heading" size={14} /> {h.title || 'Untitled heading'}
        </button>
      </li>
    {/each}
  {/each}
</ul>

<style>
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
