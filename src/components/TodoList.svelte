<!--
  A list of to-do rows, with an optional group heading. With `zone`, its
  rows can be reordered by dragging or with Cmd/Ctrl+Up and Down (FR-10.3).
  The whole section, heading and bottom padding included, takes drops, so a
  row can be dropped on a group's title or in the gap below its last row.
  With "Move completed to-dos to the bottom of the list" on, completed rows
  waiting to move show below the open ones (FR-12.7); display only.
-->
<script lang="ts">
  import TodoRow from './TodoRow.svelte';
  import { dropZone, type DropZone } from '../lib/drag/drag';
  import { sinkClosed } from '../lib/model/lists';
  import { settings } from '../lib/state/live';
  import type { LocalDate, Todo } from '../lib/model/types';

  let {
    todos,
    ref,
    title = '',
    subtitle = '',
    label = () => '',
    starred = () => false,
    mode = 'open',
    showPriority = true,
    showContext = true,
    zone = null,
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
    /** Show priority chips on rows. */
    showPriority?: boolean;
    /** Show contexts on rows. */
    showContext?: boolean;
    /** How the rows are reordered; none for lists without a manual order. */
    zone?: DropZone | null;
  } = $props();

  let shown = $derived(mode === 'open' && $settings.sinkCompleted ? sinkClosed(todos) : todos);
</script>

<section class="group" use:dropZone={zone}>
  {#if title}
    <h2>{title}{#if subtitle}<span class="sub">{subtitle}</span>{/if}</h2>
  {/if}
  <ul>
    {#each shown as todo (todo.id)}
      <TodoRow {todo} {ref} {mode} {showPriority} {showContext} containerLabel={label(todo)} starred={starred(todo)} />
    {/each}
  </ul>
</section>

<style>
  .group {
    padding-bottom: 18px;
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
