<!--
  Header for every main view: phone back link, icon, title, an optional ⋯
  menu right after a plain title, and optional actions on the right.
  On paper only, a "Printed <date>" line follows the title (FR-12.5).
  On touch screens 768 px and wider (iPad), a sidebar button above the title
  hides and shows the sidebar (Section 6).
  While an area is focused (FR-22.1), its marker shows under the title when the
  sidebar's own marker isn't in view: on phones, or with the sidebar hidden.
  In Select mode (FR-10.2) a line with the number selected and Done takes the
  place of the back link and the sidebar button.
-->
<script lang="ts">
  import { LOCALE } from '../lib/model/dates';
  import type { Snippet } from 'svelte';
  import FocusBand from './FocusBand.svelte';
  import Icon from './Icon.svelte';
  import { todayDate } from '../lib/state/live';
  import { ui } from '../lib/state/ui.svelte';

  let {
    title = '',
    icon,
    heading,
    menu,
    actions,
  }: {
    /** Plain title text; ignored when `heading` is given. */
    title?: string;
    /** Leading visual (icon or progress pie). */
    icon?: Snippet;
    /** Custom title content, e.g. an editable title field. */
    heading?: Snippet;
    /** The ⋯ menu after a plain title (built-in lists). */
    menu?: Snippet;
    /** Buttons shown on the right. */
    actions?: Snippet;
  } = $props();

  /** Today's date in words, for the printed page ("Saturday, November 14, 2026"). */
  let printed = $derived(
    new Date(`${$todayDate}T12:00:00`).toLocaleDateString(LOCALE, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
  );
</script>

{#if ui.selecting}
  <div class="select-line">
    <span>{ui.selection.ids.length} Selected</span>
    <button type="button" class="done" onclick={() => ui.stopSelecting()}>Done</button>
  </div>
{:else}
<a class="back" href="#/"><Icon name="chevron-left" size={18} /> Lists</a>
<button
  type="button"
  class="sidebar-btn"
  aria-label={ui.sidebarHidden ? 'Show sidebar' : 'Hide sidebar'}
  title={ui.sidebarHidden ? 'Show sidebar' : 'Hide sidebar'}
  aria-expanded={!ui.sidebarHidden}
  onclick={() => ui.toggleSidebar()}
>
  <Icon name="sidebar" size={22} />
</button>
{/if}
<header>
  <div class="title">
    {@render icon?.()}
    {#if heading}{@render heading()}{:else}<h1>{title}</h1>{@render menu?.()}{/if}
  </div>
  {#if actions}<div class="actions">{@render actions()}</div>{/if}
</header>
<div class="focus" class:shown={ui.sidebarHidden}><FocusBand place="view" /></div>
<p class="printed">Printed {printed}</p>

<style>
  .printed {
    display: none;
  }
  .select-line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 44px;
    font-size: 15px;
    color: var(--text-2);
  }
  .done {
    border: 0;
    background: transparent;
    padding: 0 0 0 12px;
    min-height: 44px;
    font-size: 17px;
    font-weight: 600;
    color: var(--accent);
  }
  @media print {
    .printed {
      display: block;
      margin: -8px 0 16px;
      font-size: 12px;
      color: var(--text-3);
    }
  }
  .focus {
    display: none;
    margin-top: -10px;
  }
  .focus.shown {
    display: block;
  }
  @media (max-width: 767px) {
    .focus {
      display: block;
    }
  }
  .back {
    display: none;
    align-items: center;
    gap: 4px;
    color: var(--accent);
    text-decoration: none;
    font-size: 16px;
    min-height: 44px;
  }
  @media (max-width: 767px) {
    .back {
      display: inline-flex;
    }
  }
  .sidebar-btn {
    display: none;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    margin: -6px 0 4px -10px;
    border: 0;
    background: transparent;
    color: var(--accent);
  }
  /* iPad and other touch screens wide enough for a sidebar. */
  @media (min-width: 768px) and (any-pointer: coarse) {
    .sidebar-btn {
      display: inline-flex;
    }
  }
  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    /* The first task starts 26 px below the title, or below the tag row when
       there is one (TagBar), on every device (Michael, 2026-11-18). */
    margin-bottom: 26px;
  }
  .title {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
    flex: 1;
  }
  /* Phones: a long project or area title wraps, and the ⋯ follows its last
     word (EditableTitle's wrap): one line of text after the icon. */
  @media (max-width: 767px) {
    .title:has(:global(.wrapped), :global(.box)) {
      display: block;
      position: relative;
      padding-left: 38px;
    }
    .title:has(:global(.wrapped), :global(.box)) > :global(:first-child) {
      position: absolute;
      left: 0;
      top: 0.2em;
    }
  }
  h1 {
    margin: 0;
    font-size: 28px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  /* Phones: the title's box sits higher in the header, so a larger margin gives the same 26 px. */
  @media (max-width: 767px) {
    header {
      margin-bottom: 36px;
    }
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }
</style>
