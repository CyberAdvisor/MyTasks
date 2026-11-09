<!--
  App shell: sidebar plus the current view (design doc, Section 6, Layout).
  Desktop has a bottom toolbar; under 768 px it becomes a single pane (the
  Home screen of lists, or one view) with a round + button instead.
  Also hosts Quick Find and Quick Entry and their app-wide keys.
-->
<script lang="ts">
  import Sidebar from './components/Sidebar.svelte';
  import MoveDialog from './components/MoveDialog.svelte';
  import Icon from './components/Icon.svelte';
  import Toolbar from './components/Toolbar.svelte';
  import QuickFind from './components/QuickFind.svelte';
  import QuickEntry from './components/QuickEntry.svelte';
  import ListView from './views/ListView.svelte';
  import ProjectView from './views/ProjectView.svelte';
  import AreaView from './views/AreaView.svelte';
  import SettingsView from './views/SettingsView.svelte';
  import SearchView from './views/SearchView.svelte';
  import FilterView from './views/FilterView.svelte';
  import { route, go, hrefFor } from './lib/state/route';
  import { todayDate } from './lib/state/live';
  import { ui } from './lib/state/ui.svelte';
  import { canAddHere, draftStartFor, openQuickEntry } from './lib/actions';
  import { focusKind, globalAction } from './lib/shortcuts';

  const phoneQuery = window.matchMedia('(max-width: 767px)');
  let isPhone = $state(phoneQuery.matches);

  $effect(() => {
    const onChange = () => (isPhone = phoneQuery.matches);
    phoneQuery.addEventListener('change', onChange);
    return () => phoneQuery.removeEventListener('change', onChange);
  });

  // On wider screens there is no Home screen: open Today instead.
  $effect(() => {
    if (!isPhone && $route.kind === 'home') go({ kind: 'list', list: 'today' });
  });

  // Reset the card, selection and tag filter when the view changes, then
  // select any to-do Quick Find asked to show.
  $effect(() => {
    void $route;
    ui.enterView();
  });

  // App-wide keys for Quick Find and Quick Entry.
  $effect(() => {
    const onKey = (e: KeyboardEvent) => {
      const busy = ui.findOpen || ui.draft !== null || document.querySelector('dialog[open]') !== null;
      const action = globalAction(e, focusKind(document.activeElement), busy);
      if (!action) return;
      e.preventDefault();
      if (action.kind === 'quick-entry') openQuickEntry();
      else ui.openFind(action.text);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  let showSidebar = $derived(!isPhone || $route.kind === 'home');
  let showMain = $derived(!isPhone || $route.kind !== 'home');
</script>

<div class="app">
  {#if showSidebar}
    <div class="side"><Sidebar /></div>
  {/if}

  {#if showMain}
    <main>
      <div class="scroll">
        <div class="column">
          {#if $route.kind === 'list'}
            {#key $route.list}<ListView list={$route.list} />{/key}
          {:else if $route.kind === 'project'}
            {#key $route.id}<ProjectView id={$route.id} />{/key}
          {:else if $route.kind === 'area'}
            {#key $route.id}<AreaView id={$route.id} />{/key}
          {:else if $route.kind === 'settings'}
            <SettingsView />
          {:else if $route.kind === 'search'}
            {#key hrefFor($route)}<SearchView query={$route.query} tagIds={$route.tagIds} />{/key}
          {:else if $route.kind === 'saved'}
            {#key $route.id}<SearchView savedId={$route.id} />{/key}
          {:else if $route.kind === 'filter'}
            {#key $route.filter}<FilterView filter={$route.filter} />{/key}
          {/if}
        </div>
      </div>

      {#if isPhone}
        {#if canAddHere($route)}
          <button type="button" class="plus" aria-label="New To-Do" onclick={() => openQuickEntry(draftStartFor($route, $todayDate))}>
            <Icon name="plus" size={22} color="#fff" />
          </button>
        {/if}
      {:else if $route.kind !== 'settings'}
        <Toolbar />
      {/if}
    </main>
  {/if}
</div>

{#if ui.movingId}
  <MoveDialog todoId={ui.movingId} />
{/if}

{#if ui.findOpen}
  <QuickFind />
{/if}

{#if ui.draft}
  {#key ui.draft}<QuickEntry draft={ui.draft} />{/key}
{/if}

<style>
  .app {
    display: flex;
    height: 100%;
  }
  .side {
    width: 260px;
    flex: none;
    height: 100%;
  }
  main {
    flex: 1;
    min-width: 0;
    height: 100%;
    display: flex;
    flex-direction: column;
  }
  .scroll {
    flex: 1;
    overflow-y: auto;
    padding: 40px 48px 80px;
  }
  .column {
    max-width: 680px;
    margin: 0 auto;
  }
  /* Phone only: round New To-Do button. */
  .plus {
    position: fixed;
    right: 28px;
    bottom: calc(28px + env(safe-area-inset-bottom));
    width: 48px;
    height: 48px;
    border-radius: 50%;
    border: 0;
    background: var(--accent);
    box-shadow: 0 4px 12px rgba(47, 111, 219, 0.35);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  @media (max-width: 767px) {
    .side {
      width: 100%;
    }
    .scroll {
      padding: calc(12px + env(safe-area-inset-top)) 18px 120px;
    }
    .plus {
      width: 56px;
      height: 56px;
    }
  }
</style>
