<!--
  The line under a title while typing (FR-1.12): what the highlighted words
  will set ("Tomorrow · P1 · Errand — set on Return"), and why any recognised
  word will stay as text ("#utilities isn't one of your tags"). Nothing shows
  when there's nothing to say.
-->
<script lang="ts">
  import { titleHint } from '../lib/titleEntry';
  import type { TitleReading } from '../lib/model/titleWords';

  let { reading }: { reading: TitleReading | null } = $props();

  let hint = $derived(titleHint(reading));
</script>

<div class="hint" class:empty={!hint.set && !hint.why.length} aria-live="polite">
  {#if hint.set}<p class="set">{hint.set} <span class="when">— set on Return</span></p>{/if}
  {#each hint.why as why, i (i)}<p class="why">{why}</p>{/each}
</div>

<style>
  .hint {
    margin-left: 28px;
    font-size: 12px;
    line-height: 1.4;
    color: var(--accent-text);
  }
  .empty {
    display: none;
  }
  p {
    margin: 0;
  }
  .when,
  .why {
    color: var(--text-3);
  }
</style>
