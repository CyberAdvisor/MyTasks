<!--
  A note shown with its light Markdown (FR-7.4): paragraphs with their line breaks,
  bullet and numbered lists, bold, italic and links. Built from parseNote's tree, so
  every piece of text is escaped by Svelte and no HTML from the note reaches the page.
  Links open in a new tab, and only http, https and mailto links are made.
-->
<script lang="ts">
  import { parseNote, type Inline } from '../lib/model/markdown';

  let { note }: { note: string } = $props();
  let blocks = $derived(parseNote(note));
</script>

{#snippet pieces(list: Inline[])}
  {#each list as piece, i (i)}
    {#if piece.kind === 'text'}{piece.text}{:else if piece.kind === 'strong'}<strong>{@render pieces(piece.children)}</strong
      >{:else if piece.kind === 'em'}<em>{@render pieces(piece.children)}</em
      >{:else}<a href={piece.href} target="_blank" rel="noopener noreferrer">{@render pieces(piece.children)}</a>{/if}
  {/each}
{/snippet}

{#each blocks as block, b (b)}
  {#if block.kind === 'p'}
    <p>
      {#each block.lines as line, l (l)}{#if l > 0}<br />{/if}{@render pieces(line)}{/each}
    </p>
  {:else if block.kind === 'ul'}
    <ul>
      {#each block.items as item, k (k)}<li>{@render pieces(item)}</li>{/each}
    </ul>
  {:else}
    <ol start={block.start}>
      {#each block.items as item, k (k)}<li>{@render pieces(item)}</li>{/each}
    </ol>
  {/if}
{/each}

<style>
  p,
  ul,
  ol {
    margin: 0 0 0.45em;
  }
  p:last-child,
  ul:last-child,
  ol:last-child {
    margin-bottom: 0;
  }
  ul,
  ol {
    padding-left: 1.4em;
  }
  strong {
    font-weight: 600;
    color: var(--text);
  }
  a {
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 2px;
    overflow-wrap: anywhere;
  }
</style>
