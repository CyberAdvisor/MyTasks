<!--
  A link to a page of the website (src/lib/website.ts). It always opens in a
  new tab, or in the browser from the installed app, so the app keeps its place.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { siteUrl, type SitePage } from '../lib/website';

  let {
    page,
    children,
    ...rest
  }: { page: SitePage; children: Snippet; class?: string; title?: string; 'aria-label'?: string } = $props();
</script>

<a href={siteUrl(page)} target="_blank" rel="noopener noreferrer" {...rest}>{@render children()}</a>
