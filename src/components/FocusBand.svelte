<!--
  The focus marker (FR-22.1): "Focus: <area>" with an ✕ that leaves the
  focus. Shown at the top of the sidebar, and under each page's title when
  the sidebar isn't in view (phones, or a hidden sidebar on iPad and Mac).
  Shows nothing while no area is focused.
-->
<script lang="ts">
  import Icon from './Icon.svelte';
  import { focusedArea, fullSnapshot } from '../lib/state/live';
  import { setFocus } from '../lib/state/focus';

  let { place }: { place: 'sidebar' | 'view' } = $props();

  let title = $derived($fullSnapshot.areas.find((a) => a.id === $focusedArea)?.title || 'New Area');
</script>

{#if $focusedArea}
  <div class="focus-band {place}" role="status" aria-label="Focus">
    <Icon name="focus" size={15} />
    <span class="label">Focus: {title}</span>
    <button type="button" class="leave" aria-label="Leave Focus" title="Leave Focus" onclick={() => setFocus(null)}>
      <Icon name="x" size={14} weight={2.5} />
    </button>
  </div>
{/if}

<style>
  .focus-band {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--accent-text);
    font-size: 13px;
    font-weight: 600;
  }
  .sidebar {
    margin: 0 10px 8px;
    padding: 4px 4px 4px 10px;
    border-radius: var(--radius);
    background: var(--tag-bg);
  }
  .view {
    margin: -4px 0 8px;
  }
  .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .view .label {
    flex: none;
  }
  .leave {
    display: inline-flex;
    border: 0;
    background: transparent;
    color: inherit;
    padding: 6px;
    border-radius: var(--radius);
  }
  .leave:hover {
    background: var(--hover-bg);
  }
  @media print {
    .focus-band {
      display: none;
    }
  }
</style>
