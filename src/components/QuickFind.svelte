<!--
  Quick Find (FR-9.1 to FR-9.3): type to find lists, saved searches, areas,
  projects, tags and to-dos. Arrow keys move, Enter opens, Escape closes.
  The last row opens the full results page, where the search can be saved.
-->
<script lang="ts">
  import { tick, untrack } from 'svelte';
  import Icon from './Icon.svelte';
  import ProgressPie from './ProgressPie.svelte';
  import { ui } from '../lib/state/ui.svelte';
  import { snapshot, todayDate } from '../lib/state/live';
  import { go, route } from '../lib/state/route';
  import { revealTodo } from '../lib/actions';
  import { containerLabel } from '../lib/labels';
  import { LIST_META } from '../lib/listMeta';
  import { projectProgress, type BuiltInList } from '../lib/model/lists';
  import { quickFind, type FindResult } from '../lib/model/search';

  let dialog: HTMLDialogElement;
  let input: HTMLInputElement;
  let list = $state<HTMLUListElement>();
  let query = $state(ui.findText);
  let active = $state(0);

  const LIST_TITLES = Object.fromEntries(
    Object.entries(LIST_META).map(([k, m]) => [k, m.title]),
  ) as Record<BuiltInList, string>;

  let results = $derived(quickFind($snapshot, query, LIST_TITLES));

  // A new query starts at the top.
  $effect(() => {
    void query;
    active = 0;
  });

  // Once, on open: show the dialog and put the caret after any text typed
  // before Quick Find opened.
  $effect(() => {
    dialog.showModal();
    input.focus();
    const end = untrack(() => query.length);
    input.setSelectionRange(end, end);
  });

  function close() {
    ui.findOpen = false;
  }

  /** Open a result and close Quick Find. */
  function choose(r: FindResult) {
    close();
    switch (r.kind) {
      case 'list':
        return go({ kind: 'list', list: r.list });
      case 'filter':
        return go({ kind: 'filter', filter: r.filter });
      case 'saved':
        return go({ kind: 'saved', id: r.id });
      case 'area':
        return go({ kind: 'area', id: r.id });
      case 'project':
        return go({ kind: 'project', id: r.id });
      case 'tag':
        return go({ kind: 'search', query: '', tagIds: [r.id] });
      case 'todo':
        return revealTodo(r.todo, $route, $todayDate);
      case 'search':
        return go({ kind: 'search', query: r.query, tagIds: [] });
    }
  }

  async function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!results.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length;
      await tick();
      list?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && results[active]) {
      e.preventDefault();
      choose(results[active]);
    }
  }

  /** Text shown for a result. */
  function titleOf(r: FindResult): string {
    if (r.kind === 'todo') return r.todo.title || 'New To-Do';
    if (r.kind === 'search') return `Search for “${r.query}”`;
    if (r.kind === 'area') return r.title || 'New Area';
    if (r.kind === 'project') return r.title || 'New Project';
    return r.title || 'Untitled';
  }

  /** Secondary text: where a to-do lives, or that an item is logged. */
  function noteOf(r: FindResult): string {
    if (r.kind === 'todo') return r.logged ? 'Logbook' : containerLabel(r.todo, $snapshot);
    if (r.kind === 'project' && r.logged) return 'Logbook';
    if (r.kind === 'tag') return 'Tag';
    return '';
  }
</script>

<dialog
  bind:this={dialog}
  aria-label="Quick Find"
  onkeydown={onKey}
  oncancel={(e) => e.preventDefault()}
  onclose={() => ui.findOpen && close()}
  onpointerdown={(e) => e.target === dialog && close()}
>
  <div class="field">
    <Icon name="search" size={16} color="var(--text-3)" />
    <input
      bind:this={input}
      bind:value={query}
      placeholder="Quick Find"
      aria-label="Quick Find"
      role="combobox"
      aria-expanded={results.length > 0}
      aria-controls="find-results"
      aria-activedescendant={results.length ? `find-${active}` : undefined}
      autocomplete="off"
    />
  </div>

  {#if results.length}
    <ul id="find-results" role="listbox" aria-label="Results" bind:this={list}>
      {#each results as r, i (i)}
        <!-- Keys are handled by the input (combobox pattern), so options only need clicks. -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <li
          id="find-{i}"
          role="option"
          aria-selected={i === active}
          class:todo={r.kind === 'todo'}
          class:last={r.kind === 'search'}
          onpointermove={() => (active = i)}
          onclick={() => choose(r)}
        >
          {#if r.kind === 'list'}
            <Icon name={LIST_META[r.list].icon} color={LIST_META[r.list].color} size={16} />
          {:else if r.kind === 'project'}
            <ProgressPie fraction={projectProgress($snapshot, r.id)} />
          {:else if r.kind === 'todo'}
            <span class="box" class:done={r.logged}></span>
          {:else}
            <Icon name={r.kind === 'area' ? 'area' : r.kind === 'tag' ? 'tag' : 'search'} size={16} color="var(--text-2)" />
          {/if}
          <span class="label">{titleOf(r)}</span>
          {#if noteOf(r)}<span class="note">{noteOf(r)}</span>{/if}
        </li>
      {/each}
    </ul>
  {:else}
    <p class="hint">Find lists, projects, tags and to-dos.</p>
  {/if}
</dialog>

<style>
  dialog {
    margin: 12vh auto auto;
    border: 1px solid #e5e5e8;
    border-radius: 12px;
    padding: 8px;
    width: min(520px, calc(100% - 24px));
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
  }
  dialog::backdrop {
    background: rgba(0, 0, 0, 0.12);
  }
  .field {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
  }
  input {
    flex: 1;
    border: 0;
    outline: none;
    font-size: 16px;
    background: transparent;
  }
  ul {
    list-style: none;
    margin: 6px 0 0;
    padding: 6px 0 0;
    border-top: 1px solid var(--rule);
    max-height: 50vh;
    overflow-y: auto;
  }
  li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 10px;
    border-radius: var(--radius);
    font-size: 14px;
    cursor: default;
  }
  li[aria-selected='true'] {
    background: var(--accent);
    color: #fff;
  }
  li[aria-selected='true'] .note {
    color: rgba(255, 255, 255, 0.85);
  }
  li.last {
    margin-top: 4px;
    color: var(--text-2);
  }
  .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .note {
    font-size: 12px;
    color: var(--text-3);
  }
  .box {
    width: 13px;
    height: 13px;
    flex: none;
    border: 1.5px solid var(--border);
    border-radius: 3px;
    background: #fff;
  }
  .box.done {
    background: var(--text-done);
    border-color: var(--text-done);
  }
  .hint {
    margin: 6px 10px 8px;
    font-size: 13px;
    color: var(--text-3);
  }
</style>
