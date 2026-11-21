<!--
  Search results (FR-9.2) and saved searches (FR-15.4, FR-15.5).

  Without `savedId`, shows the results for the search text and tags in the
  route, with a field to refine the text and a Save Search button.
  With `savedId`, runs that saved search live, with a menu to edit or delete
  it (saved searches are reordered by dragging them in the sidebar). Either
  way, open matches are grouped by Area and Project, and
  completed matches come last in a collapsed Completed group.
-->
<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import MenuItems from '../components/MenuItems.svelte';
  import { sidebarMenuItems } from '../lib/model/sidebarMenu';
  import { printPage } from '../lib/print';
  import SelectItem from '../components/SelectItem.svelte';
  import Popover from '../components/Popover.svelte';
  import TagBar from '../components/TagBar.svelte';
  import TodoList from '../components/TodoList.svelte';
  import MoreRows from '../components/MoreRows.svelte';
  import { rowLimit, startsOf } from '../lib/state/rowLimit.svelte';
  import ViewHeader from '../components/ViewHeader.svelte';
  import ChoiceDialog from '../components/ChoiceDialog.svelte';
  import SavedSearchDialog from '../components/SavedSearchDialog.svelte';
  import { listSnapshot, todayDate } from '../lib/state/live';
  import { go } from '../lib/state/route';
  import { ui } from '../lib/state/ui.svelte';
  import { containerLabel } from '../lib/labels';
  import { defaultSearchName, isEmptyFilter, searchResults, type SearchFilter } from '../lib/model/search';
  import { activeTag, tagTitles, tagsInUse } from '../lib/model/tags';
  import { contextTitle } from '../lib/model/contexts';
  import * as repo from '../lib/db/repo';
  import { deleteSavedSearch } from '../lib/actions';
  import { DELETE_SAVED_SEARCH_DIALOG } from '../lib/dialogs';
  import type { ID, Todo } from '../lib/model/types';

  let {
    query = '',
    tagIds = [],
    savedId = null,
  }: {
    /** Search text from the route (ignored for a saved search). */
    query?: string;
    /** Tags from the route (ignored for a saved search). */
    tagIds?: ID[];
    /** The saved search to run, if any. */
    savedId?: ID | null;
  } = $props();

  let s = $derived($listSnapshot);
  let ref = $derived($todayDate);
  let saved = $derived(savedId ? s.savedSearches.find((x) => x.id === savedId) : undefined);
  // svelte-ignore state_referenced_locally
  let text = $state(query);
  let showLogged = $state(false);
  let menuOpen = $state(false);
  let dialog = $state<'save' | 'edit' | null>(null);
  let askDelete = $state(false);

  /** The search as stored or typed, before the tag bar. */
  let base = $derived<SearchFilter>(
    saved
      ? { query: saved.query, tagIds: saved.tagIds, contextId: saved.contextId }
      : { query: text, tagIds, contextId: null },
  );
  let all = $derived(searchResults(s, base));

  // Filter bar (FR-6.3): narrow the results by one more tag.
  let found = $derived([...all.groups.flatMap((g) => g.todos), ...all.logged]);
  let offered = $derived(tagsInUse(found, s));
  let tag = $derived(activeTag(ui.tagFilter, offered, s.tags));
  let filter = $derived<SearchFilter>({
    ...base,
    tagIds: tag && !base.tagIds.includes(tag) ? [...base.tagIds, tag] : base.tagIds,
  });
  let results = $derived(tag ? searchResults(s, filter) : all);
  // The row limit (NFR-7): each group's rows, then the completed ones when shown.
  let counts = $derived([...results.groups.map((g) => g.todos.length), showLogged ? results.logged.length : 0]);
  let starts = $derived(startsOf(counts));
  let rowTotal = $derived(counts.reduce((a, b) => a + b, 0));

  let heading = $derived(saved ? saved.title || 'Saved Search' : 'Search');
  let summary = $derived(describe(base));
  let empty = $derived(!results.groups.length && !results.logged.length);
  let label = (t: Todo) => containerLabel(t, s);

  /** One line saying what is searched for, e.g. “milk” · Tagged Errands. */
  function describe(f: SearchFilter): string {
    const parts: string[] = [];
    if (f.query.trim()) parts.push(`“${f.query.trim()}”`);
    const tags = tagTitles(f.tagIds, s);
    if (tags.length) parts.push(`Tagged ${tags.join(', ')}`);
    const context = contextTitle(f.contextId ?? null, s);
    if (context) parts.push(`Context ${context}`);
    return parts.join(' · ');
  }

  async function onSave(fields: repo.SavedSearchFields) {
    dialog = null;
    if (saved) await repo.updateSavedSearch(saved.id, fields);
    else go({ kind: 'saved', id: await repo.createSavedSearch(fields) });
  }

  function onDeleteChoice(v: string | null) {
    askDelete = false;
    if (v === 'delete' && saved) void deleteSavedSearch(saved.id);
  }

  function menuAction(fn: () => void) {
    menuOpen = false;
    fn();
  }
</script>

{#if savedId && !saved}
  <p class="empty">This saved search no longer exists.</p>
{:else}
  <ViewHeader title={heading}>
    {#snippet icon()}<Icon name="search" size={26} color="var(--text-2)" />{/snippet}
    {#snippet actions()}
      {#if saved}
        <Popover bind:open={menuOpen} label="Saved search actions">
          {#snippet trigger(toggle, open)}
            <button type="button" class="btn-plain" aria-label="Saved search actions" aria-expanded={open} onclick={toggle}>
              <Icon name="more" size={18} />
            </button>
          {/snippet}
          <div role="menu" aria-label="Saved search actions">
            <SelectItem onchoose={() => (menuOpen = false)} />
            <!-- The same items as the saved search's right-click menu (review C8, F4). -->
            <MenuItems
              items={sidebarMenuItems({ kind: 'saved', id: saved.id })}
              icons
              onchoose={(action) =>
                menuAction(() => {
                  if (action === 'edit-search') dialog = 'edit';
                  else if (action === 'print') printPage();
                  else if (action === 'delete') askDelete = true;
                })}
            />
          </div>
        </Popover>
      {:else}
        <button type="button" class="btn-plain" disabled={isEmptyFilter(filter)} onclick={() => (dialog = 'save')}>Save Search</button>
      {/if}
    {/snippet}
  </ViewHeader>

  {#if saved}
    {#if summary}<p class="summary">{summary}</p>{/if}
  {:else}
    <div class="field">
      <Icon name="search" size={15} color="var(--text-3)" />
      <input bind:value={text} placeholder="Search tasks" aria-label="Search tasks" autocomplete="off" />
      {#if tagIds.length}<span class="summary">Tagged {tagTitles(tagIds, s).join(', ')}</span>{/if}
    </div>
  {/if}

  <TagBar tags={offered} />

  {#each results.groups as g, i (g.key)}
    <TodoList todos={g.todos} {ref} title={g.title} subtitle={g.subtitle} start={starts[i]} />
  {/each}

  {#if results.logged.length && starts[starts.length - 1] < rowLimit.limit}
    <button type="button" class="logged" aria-expanded={showLogged} onclick={() => (showLogged = !showLogged)}>
      <Icon name={showLogged ? 'chevron-down' : 'chevron-right'} size={12} />
      Completed <span class="count">{results.logged.length}</span>
    </button>
    {#if showLogged}
      <TodoList todos={results.logged} {ref} mode="logbook" {label} start={starts[starts.length - 1]} />
    {/if}
  {/if}

  <MoreRows total={rowTotal} />

  {#if empty}
    <p class="empty">{isEmptyFilter(filter) ? 'Type words to search for.' : 'No matching tasks.'}</p>
  {/if}
{/if}

{#if dialog}
  <SavedSearchDialog
    title={dialog === 'save' ? 'Save Search' : 'Edit Saved Search'}
    initial={dialog === 'edit' && saved
      ? { title: saved.title, query: saved.query, tagIds: saved.tagIds, contextId: saved.contextId }
      : { title: defaultSearchName(filter, s), query: filter.query, tagIds: filter.tagIds, contextId: filter.contextId }}
    onsave={onSave}
    oncancel={() => (dialog = null)}
  />
{/if}

{#if askDelete}
  <ChoiceDialog {...DELETE_SAVED_SEARCH_DIALOG} onchoose={onDeleteChoice} />
{/if}

<style>
  .field {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: -6px 0 16px 38px;
    padding: 6px 10px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }
  .field input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: none;
    font-size: 14px;
    background: transparent;
  }
  .summary {
    margin: -10px 0 16px 38px;
    font-size: 13px;
    color: var(--text-2);
  }
  .field .summary {
    margin: 0;
    white-space: nowrap;
  }
  .logged {
    display: flex;
    align-items: center;
    gap: 6px;
    border: 0;
    background: transparent;
    padding: 4px 8px 8px;
    font-size: 15px;
    font-weight: 700;
    color: var(--c-logbook);
  }
  .count {
    font-size: 12px;
    font-weight: 400;
    color: var(--text-3);
  }
  .empty {
    color: var(--text-3);
    font-size: 14px;
    margin: 24px 8px;
  }
</style>
