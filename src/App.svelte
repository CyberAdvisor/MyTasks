<!--
  App shell: sidebar plus the current view (design doc, Section 6, Layout).
  Desktop has a bottom toolbar; under 768 px it becomes a single pane (the
  Home screen of lists, or one view) with a round + button instead.
  Also hosts Quick Find, Quick Entry, Keyboard Help, the Undo toast and the
  app-wide keyboard handler (Section 7).
  Until this device is connected to a GitHub Gist, only Setup shows (FR-19.1).
-->
<script lang="ts">
  import { PHONE_QUERY, TOUCH_QUERY, isPhoneWidth } from './lib/breakpoints';
  import Sidebar from './components/Sidebar.svelte';
  import ResizeHandle from './components/ResizeHandle.svelte';
  import RevealHandle from './components/RevealHandle.svelte';
  import MoveDialog from './components/MoveDialog.svelte';
  import RepeatDialog from './components/RepeatDialog.svelte';
  import RepeatSheet from './components/RepeatSheet.svelte';
  import Icon from './components/Icon.svelte';
  import ChoiceDialog from './components/ChoiceDialog.svelte';
  import { failureMessages } from './lib/db/failures';
  import Toolbar from './components/Toolbar.svelte';
  import SelectBar from './components/SelectBar.svelte';
  import QuickFind from './components/QuickFind.svelte';
  import QuickEntry from './components/QuickEntry.svelte';
  import KeyboardHelp from './components/KeyboardHelp.svelte';
  import UndoToast from './components/UndoToast.svelte';
  import UpdateBanner from './components/UpdateBanner.svelte';
  import InstallGuide from './components/InstallGuide.svelte';
  import ListView from './views/ListView.svelte';
  import ProjectView from './views/ProjectView.svelte';
  import AreaView from './views/AreaView.svelte';
  import SettingsView from './views/SettingsView.svelte';
  import SearchView from './views/SearchView.svelte';
  import FilterView from './views/FilterView.svelte';
  import Setup from './components/Setup.svelte';
  import RowMenu from './components/RowMenu.svelte';
  import SidebarMenu from './components/SidebarMenu.svelte';
  import { sync } from './lib/sync/sync.svelte';
  import { route, go, hrefFor } from './lib/state/route';
  import { get } from 'svelte/store';
  import { tick, untrack } from 'svelte';
  import { focusArea, setFocus } from './lib/state/focus';
  import { fullSnapshot, listSnapshot, settings, todayDate } from './lib/state/live';
  import { outsideFocus } from './lib/model/focus';
  import { applyTheme } from './lib/theme';
  import { ui } from './lib/state/ui.svelte';
  import { canAddHere, draftStartFor, openQuickEntry, trashProject } from './lib/actions';
  import { COPY_NOW_DIALOG, DELETE_TEMPLATE_DIALOG, stopProjectDialog } from './lib/dialogs';
  import * as repo from './lib/db/repo';
  import { rowIds, runCommand, runTagShortcut } from './lib/commands';
  import { KeyResolver, focusKind, isMac, tagShortcut, typeAheadKey } from './lib/shortcuts';
  import { install } from './lib/pwa/install.svelte';
  import { update } from './lib/pwa/update.svelte';
  import { readSidebarWidth } from './lib/sidebarWidth';
  import { limitRefusal } from './lib/model/limits';

  const phoneQuery = window.matchMedia(PHONE_QUERY);
  let isPhone = $state(phoneQuery.matches);
  // This device's sidebar width; phones show the sidebar full width instead.
  let sidebarWidth = $state(readSidebarWidth());

  $effect(() => {
    const onChange = () => (isPhone = phoneQuery.matches);
    phoneQuery.addEventListener('change', onChange);
    return () => phoneQuery.removeEventListener('change', onChange);
  });

  // Light, dark or system theme (FR-V.3).
  $effect(() => applyTheme($settings.theme));

  // On wider screens there is no Home screen: open Today instead.
  $effect(() => {
    if (!isPhone && $route.kind === 'home') go({ kind: 'list', list: 'today' });
  });

  // Opening a page outside the focused area (with Back or a link) ends the
  // focus, so the page shows normally rather than empty (FR-22.1). Only a new
  // page or new data checks: focusing from another page opens the area first
  // (toggleAreaFocus), and the new focus mustn't be checked against the old page.
  $effect(() => {
    const [s, r] = [$fullSnapshot, $route];
    untrack(() => {
      if (outsideFocus(s, get(focusArea), r)) setFocus(null);
    });
  });

  // Reset the card, selection and tag filter when the view changes, then
  // select any to-do Quick Find asked to show.
  $effect(() => {
    void $route;
    ui.enterView();
  });

  // Selected rows that leave the list (moved, deleted) leave a selection of several (FR-10.1), or Select mode's (FR-10.2).
  $effect(() => {
    void $listSnapshot;
    untrack(() => {
      if (ui.multiple || ui.selecting) void tick().then(() => ui.keepOnly(rowIds()));
    });
  });

  // App-wide keys. Keys a component already handled (defaultPrevented) and
  // keys pressed while a dialog, Quick Find or Quick Entry is open are left alone.
  // Right after New To-Do, until its title has focus, every key is held for
  // the title instead (FR-1.1); this listener runs first, in the capture phase.
  $effect(() => {
    const resolver = new KeyResolver();
    const mac = isMac();
    const onTypeAhead = (e: KeyboardEvent) => {
      if (ui.typeAhead === null || e.isComposing) return;
      e.preventDefault();
      e.stopPropagation();
      ui.typeAhead = typeAheadKey(ui.typeAhead, e);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || !sync.config) return;
      if (ui.findOpen || ui.draft !== null || document.querySelector('dialog[open]')) return;
      const ctx = { focus: focusKind(document.activeElement), standalone: install.standalone, mac, now: Date.now() };
      const result = resolver.resolve(e, ctx);
      if (!result) {
        // Tag shortcuts (FR-6.4), only for keys no app shortcut uses.
        const tagKey = tagShortcut(e, mac, ctx.focus);
        if (tagKey && runTagShortcut(tagKey.kind, tagKey.key)) e.preventDefault();
        return;
      }
      if ('pending' in result) e.preventDefault();
      else if ('find' in result) {
        e.preventDefault();
        ui.openFind(result.find);
      } else if (runCommand(result.command)) e.preventDefault();
    };
    window.addEventListener('keydown', onTypeAhead, true);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onTypeAhead, true);
      document.removeEventListener('keydown', onKey);
    };
  });

  let showSidebar = $derived(isPhone ? $route.kind === 'home' : !ui.sidebarHidden);
  let showMain = $derived(!isPhone || $route.kind !== 'home');
</script>

{#if !sync.ready}
  <!-- Reading this device's sync settings: a moment, so nothing flashes. -->
{:else if !sync.config}
  <Setup />
{:else}
  <div class="app">
    {#if showSidebar}
      <div class="side" style:width={isPhone ? null : `${sidebarWidth}px`}>
        <Sidebar />
        {#if !isPhone}<ResizeHandle bind:width={sidebarWidth} />{/if}
      </div>
    {:else if !isPhone}
      <RevealHandle />
    {/if}

    {#if showMain}
      <main class:selecting={ui.selecting}>
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

        {#if ui.selecting}
          <!-- Select mode (FR-10.2): the floating bar in place of the + and the toolbar. -->
          <SelectBar />
        {:else if isPhone}
          {#if canAddHere($route)}
            <button type="button" class="plus" aria-label="New Task" onclick={() => openQuickEntry(draftStartFor($route, $todayDate))}>
              <Icon name="plus" size={22} color="#fff" />
            </button>
          {/if}
        {:else if $route.kind !== 'settings'}
          <Toolbar />
        {/if}
      </main>
    {/if}
  </div>

  <RowMenu />
  <SidebarMenu />

  {#if ui.movingIds}
    <MoveDialog todoIds={ui.movingIds} />
  {/if}

  {#if ui.repeating}
    {#key ui.repeating}
      <!-- Phones get the Repeat sheet; everything else the dialog (FR-4.1). -->
      {#if isPhoneWidth() && window.matchMedia(TOUCH_QUERY).matches}
        <RepeatSheet target={ui.repeating} />
      {:else}
        <RepeatDialog target={ui.repeating} />
      {/if}
    {/key}
  {/if}

  {#if ui.copyNow}
    <ChoiceDialog {...COPY_NOW_DIALOG} onchoose={(v) => void ui.answerCopyNow(v === 'create')} />
  {/if}
  {#if ui.projectConfirm}
    {@const c = ui.projectConfirm}
    <!-- Stop… and Delete Project on a repeating project's template (FR-4.6). -->
    <ChoiceDialog
      {...c.kind === 'stop'
        ? stopProjectDialog($fullSnapshot.projects.find((p) => p.id === c.id)?.title ?? '')
        : DELETE_TEMPLATE_DIALOG}
      onchoose={(v) => {
        // Read the id before clearing: `c` follows ui.projectConfirm.
        const id = c.id;
        ui.projectConfirm = null;
        if (v === 'stop') void repo.stopProjectRepeat(id);
        if (v === 'delete') void trashProject(id);
      }}
    />
  {/if}

  {#if ui.findOpen}
    <QuickFind />
  {/if}

  {#if ui.draft}
    {#key ui.draft}<QuickEntry draft={ui.draft} />{/key}
  {/if}

  {#if ui.helpOpen}
    <KeyboardHelp />
  {/if}

  {#if ui.printUnavailable}
    <ChoiceDialog
      title="Printing isn't available here"
      message="Printing isn't available in the installed app on iPhone and iPad. Print from My Tasks on a Mac, or in Safari."
      choices={[{ label: 'OK', value: 'ok' }]}
      onchoose={() => (ui.printUnavailable = false)}
    />
  {/if}
  {#if ui.limitRefused}
    <ChoiceDialog
      title="No room for more tasks"
      message={limitRefusal(ui.limitRefused.count, ui.limitRefused.adding)}
      choices={[{ label: 'OK', value: 'ok' }]}
      onchoose={() => (ui.limitRefused = null)}
    />
  {/if}
  {#if ui.saveFailed}
    <ChoiceDialog
      title={failureMessages[ui.saveFailed].title}
      message={failureMessages[ui.saveFailed].message}
      cancelLabel="OK"
      choices={[{ label: 'Reload', value: 'reload' }]}
      onchoose={(choice) => {
        ui.saveFailed = null;
        if (choice === 'reload') location.reload();
      }}
    />
  {/if}
  {#if ui.toast}
    <UndoToast message={ui.toast.message} undo={ui.toast.undo} where={ui.toast.where} />
  {:else if update.available && !update.dismissed}
    <!-- Shares the toast's place, so it waits while an Undo toast shows. -->
    <UpdateBanner />
  {/if}
{/if}

{#if install.guideOpen}
  <InstallGuide />
{/if}

<style>
  .app {
    display: flex;
    height: 100%;
  }
  .side {
    position: relative;
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
  /*
   * The list column starts near the sidebar (since
   * 1.1.17): a task's checkbox 76 px from the sidebar's edge (68 px here plus
   * the row's 8 px), at any window width; extra width stays on the right.
   */
  .scroll {
    flex: 1;
    overflow-y: auto;
    padding: 40px 48px 80px 68px;
  }
  .column {
    max-width: 680px;
  }
  /* Room below the last row for Select mode's floating bar (FR-10.2). */
  main.selecting .scroll {
    padding-bottom: 120px;
  }
  /* Phone only: round New Task button. */
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
