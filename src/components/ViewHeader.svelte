<!--
  Header for every main view: phone back link, icon, title and optional
  actions on the right.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  let {
    title = '',
    icon,
    heading,
    actions,
  }: {
    /** Plain title text; ignored when `heading` is given. */
    title?: string;
    /** Leading visual (icon or progress pie). */
    icon?: Snippet;
    /** Custom title content, e.g. an editable title field. */
    heading?: Snippet;
    /** Buttons shown on the right. */
    actions?: Snippet;
  } = $props();
</script>

<a class="back" href="#/"><Icon name="chevron-left" size={18} /> Lists</a>
<header>
  <div class="title">
    {@render icon?.()}
    {#if heading}{@render heading()}{:else}<h1>{title}</h1>{/if}
  </div>
  {#if actions}<div class="actions">{@render actions()}</div>{/if}
</header>

<style>
  .back {
    display: none;
    align-items: center;
    gap: 4px;
    color: var(--accent);
    text-decoration: none;
    font-size: 16px;
    min-height: 44px;
  }
  @media (max-width: 767px) {
    .back {
      display: inline-flex;
    }
  }
  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 18px;
  }
  .title {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
    flex: 1;
  }
  h1 {
    margin: 0;
    font-size: 28px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }
</style>
