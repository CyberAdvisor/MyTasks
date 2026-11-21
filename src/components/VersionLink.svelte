<!--
  The build's version and commit, linking to the website's Roadmap page
  (src/lib/website.ts) in a new tab. Shown beside the sync status at the
  bottom of the sidebar and on the Setup screen, so a tester always knows
  which build is running.
-->
<!-- It has no props, so say runes mode outright, like the rest of the app. -->
<svelte:options runes />

<script lang="ts">
  import { versionLabel } from '../lib/version';
  import SiteLink from './SiteLink.svelte';
</script>

<SiteLink page="roadmap" class="version" title="Roadmap">{versionLabel()}</SiteLink>

<style>
  /* SiteLink renders the <a>, so its class is styled from here with :global. */
  :global(a.version) {
    font-size: 11px;
    color: var(--text-3);
    text-decoration: none;
    white-space: nowrap;
  }
  :global(a.version:hover) {
    color: var(--accent-text);
    text-decoration: underline;
  }
</style>
