<!--
  The items of a project's, area's or saved search's menu, from
  sidebarMenuItems (lib/model/sidebarMenu.ts): the same list in the page's
  ⋯ menu (with icons, `icons`) and the sidebar's right-click menu (without,
  as the task right-click menu), so the two always match (review C8, F4).
-->
<script lang="ts">
  import Icon from './Icon.svelte';
  import type { SidebarMenuAction, SidebarMenuItem } from '../lib/model/sidebarMenu';

  let {
    items,
    icons = false,
    onchoose,
  }: { items: SidebarMenuItem[]; icons?: boolean; onchoose: (action: SidebarMenuAction) => void } = $props();
</script>

{#each items as item, i (i)}
  {#if item.kind === 'separator'}
    <hr class="menu-sep" />
  {:else}
    <button
      type="button"
      class="menu-item"
      class:danger={item.danger}
      role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
      aria-checked={item.checked}
      aria-haspopup={item.submenu ? 'menu' : undefined}
      disabled={item.disabled}
      onclick={() => onchoose(item.action)}
    >
      {#if icons}
        {#if item.checked === undefined && item.icon !== 'none'}
          <Icon name={item.icon} size={15} />
        {:else if item.checked}
          <Icon name="check" size={15} />
        {:else}
          <span class="menu-icon-space"></span>
        {/if}
        {item.label}
      {:else}
        <span>{item.label}</span>
        {#if item.checked}<span class="check" aria-hidden="true">✓</span>{/if}
      {/if}
      {#if item.submenu}<span class="more" aria-hidden="true">›</span>{/if}
    </button>
  {/if}
{/each}

<style>
  /* A setting that is on (Sort by Date), checked at the right in the right-click menu. */
  .check,
  .more {
    margin-left: auto;
  }
</style>
