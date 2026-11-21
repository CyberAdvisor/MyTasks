<!--
  Placed after a view's last list (NFR-7, 11b): tells the row limit how many
  rows the view has, and draws the next step when it comes within about a
  screen of the bottom of the scrolling area (src/lib/state/rowLimit.svelte.ts).
-->
<script lang="ts">
  import { rowLimit } from '../lib/state/rowLimit.svelte';

  /** All the view's rows, drawn or not. */
  let { total }: { total: number } = $props();

  let marker = $state<HTMLDivElement>();

  $effect(() => {
    rowLimit.total = total;
  });
  $effect(() => () => (rowLimit.total = 0));

  $effect(() => {
    if (!marker) return;
    const node = marker;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting) || !rowLimit.more) return;
        rowLimit.grow();
        // Still in reach after the new rows (a tall window): look again once they're drawn.
        requestAnimationFrame(() => {
          observer.unobserve(node);
          observer.observe(node);
        });
      },
      { root: node.closest('.scroll'), rootMargin: '0px 0px 800px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  });
</script>

{#if rowLimit.more}<div class="more" bind:this={marker} aria-hidden="true"></div>{/if}

<style>
  .more {
    height: 1px;
  }
</style>
