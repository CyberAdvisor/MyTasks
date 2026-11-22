<!--
  A list of to-do rows, with an optional group heading. With `zone`, its
  rows can be reordered by dragging or with Cmd/Ctrl+Up and Down (FR-10.3).
  The whole section, heading and bottom padding included, takes drops, so a
  row can be dropped on a group's title or in the gap below its last row.
  With "Move completed tasks to the bottom of the list" on, completed rows
  waiting to move show below the open ones (FR-12.7); display only.
  Long lists are drawn in steps (NFR-7): `start` is how many of the view's
  rows come before this list, and it draws only its share of the row limit;
  with none to draw it is left out, heading included.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import TodoRow from './TodoRow.svelte';
  import { dropZone, type DropZone } from '../lib/drag/drag';
  import { sinkClosed, type BuiltInList } from '../lib/model/lists';
  import { settings } from '../lib/state/live';
  import { rowLimit, shareOf } from '../lib/state/rowLimit.svelte';
  import { ui } from '../lib/state/ui.svelte';
  import type { LocalDate, Todo } from '../lib/model/types';

  let {
    todos,
    ref,
    title = '',
    subtitle = '',
    label = () => '',
    list = null,
    mode = 'open',
    showPriority = true,
    showContext = true,
    zone = null,
    start = 0,
    before,
    after,
    day = '',
    period = false,
  }: {
    todos: Todo[];
    ref: LocalDate;
    /** Group heading; omitted when empty. */
    title?: string;
    subtitle?: string;
    /** Container label for each row. */
    label?: (t: Todo) => string;
    /** The built-in list showing the rows, for their When marks; null elsewhere. */
    list?: BuiltInList | null;
    mode?: 'open' | 'logbook' | 'trash';
    /** Show priority chips on rows. */
    showPriority?: boolean;
    /** Show contexts on rows. */
    showContext?: boolean;
    /** How the rows are reordered; none for lists without a manual order. */
    zone?: DropZone | null;
    /** How many of the view's rows come before this list (the row limit, NFR-7). */
    start?: number;
    /** Shown under the heading, above the rows: a Scheduled group's calendar events (FR-21.6). */
    before?: Snippet;
    /** Shown under the rows: Unscheduled's Show All (FR-23.1). */
    after?: Snippet;
    /** Scheduled's day groups: the date's number, large before the title (FR-21.6). */
    day?: string;
    /** Scheduled's later groups (rest of the month, a month, a year): a plain heading with a rule above. */
    period?: boolean;
  } = $props();

  let shown = $derived(mode === 'open' && $settings.sinkCompleted ? sinkClosed(todos) : todos);
  let drawn = $derived(shown.slice(0, shareOf(shown.length, start, rowLimit.limit)));

  // A task asked to be shown (Quick Find, Show, a new task) that isn't drawn yet: draw every row.
  $effect(() => {
    const id = ui.scrollId;
    if (id && drawn.length < shown.length && !drawn.some((t) => t.id === id) && shown.some((t) => t.id === id)) {
      rowLimit.limit = Infinity;
    }
  });
</script>

{#if drawn.length || !shown.length}
  <section class="group" use:dropZone={zone}>
    {#if title}
      {#if day}
        <h2 class="dated"><span class="daynum">{day}</span>{title}<span class="rule" aria-hidden="true"></span></h2>
      {:else}
        <h2 class:period>{title}{#if subtitle}<span class="sub">{subtitle}</span>{/if}</h2>
      {/if}
    {/if}
    {@render before?.()}
    <ul>
      {#each drawn as todo (todo.id)}
        <TodoRow {todo} {ref} {mode} {showPriority} {showContext} containerLabel={label(todo)} {list} />
      {/each}
    </ul>
    {@render after?.()}
  </section>
{/if}

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
  /* Scheduled (FR-21.6): "20 Tomorrow" with a rule
     running on from it, and "November 27–30" under a rule. */
  h2.dated {
    margin-top: 14px;
    padding-bottom: 2px;
    border-bottom: 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--text-3);
  }
  .daynum {
    font-size: 28px;
    font-weight: 700;
    line-height: 1;
    color: var(--text);
  }
  .rule {
    flex: 1;
    align-self: flex-start;
    border-top: 1px solid var(--line);
  }
  h2.period {
    margin-top: 22px;
    padding-top: 10px;
    border-top: 1px solid var(--line);
    border-bottom: 0;
    font-size: 17px;
    color: var(--text);
  }
  h2.period .sub {
    font-size: 17px;
    font-weight: 700;
  }
  ul {
    margin: 0;
    padding: 0;
  }
</style>
