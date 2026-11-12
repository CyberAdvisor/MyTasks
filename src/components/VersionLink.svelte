<!--
  The build's version and commit, linking to its section of the changelog
  (CHANGELOG.md on GitHub). Shown beside the sync status at the bottom of
  the sidebar and on the Setup screen, so a tester always knows which build is running.
-->
<!-- It has no props, so say runes mode outright, like the rest of the app. -->
<svelte:options runes />

<script lang="ts">
  import { changelogUrl, versionLabel } from '../lib/version';
</script>

<a class="version" href={changelogUrl()} target="_blank" rel="noopener noreferrer" title="What’s new in this version">
  {versionLabel()}
</a>

<style>
  .version {
    font-size: 11px;
    color: var(--text-3);
    text-decoration: none;
    white-space: nowrap;
  }
  .version:hover {
    color: var(--accent-text);
    text-decoration: underline;
  }
</style>
