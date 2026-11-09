<!-- A list of to-do rows, with an optional group heading. -->
<script lang="ts">
  import TodoRow from './TodoRow.svelte';
  import type { LocalDate, Todo } from '../lib/model/types';

  let {
    todos,
    ref,
    title = '',
    subtitle = '',
    label = () => '',
    starred = () => false,
    mode = 'open',
  }: {
    todos: Todo[];
    ref: LocalDate;
    /** Group heading; omitted when empty. */
    title?: string;
    subtitle?: string;
    /** Container label for each row. */
    label?: (t: Todo) => string;
    /** Whether a row shows the Today star. */
    starred?: (t: Todo) => boolean;
    mode?: 'open' | 'logbook' | 'trash';
  } = $props();
</script>

<section class="group">
  {#if title}
    <h2>{title}{#if subtitle}<span class="sub">{subtitle}</span>{/if}</h2>
  {/if}
  <ul>
    {#each todos as todo (todo.id)}
      <TodoRow {todo} {ref} {mode} containerLabel={label(todo)} starred={starred(todo)} />
    {/each}
  </ul>
</section>

<style>
  .group {
    margin-bottom: 18px;
  }
  h2 {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin: 0 0 4px;
    padding: 0 8px 6px;
    border-bottom: 1px solid var(--rule);
    font-size: 15px;
    font-weight: 700;
    color: var(--accent-text);
  }
  .sub {
    font-size: 12px;
    font-weight: 400;
    color: var(--text-3);
  }
  ul {
    margin: 0;
    padding: 0;
  }
</style>
