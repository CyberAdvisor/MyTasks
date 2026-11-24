<!--
  The gist band (FR-19.15): which gist this device is working in, in the
  gist's colour. Hidden while the device has only one gist.
  - `sidebar`: under the sidebar's header, above the Focus band (on phones,
    the top of the Home screen of lists). A click opens the switcher: "Switch
    to", the other gists, Add Gist… and Manage Gists… (Settings › Sync).
    Up and Down move through it, Return chooses, Escape closes.
  - `view`: the gist's name under each page's title, shown where the sidebar
    isn't in view (ViewHeader decides, as for the Focus band). A label only.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import Icon from './Icon.svelte';
  import { deviceGists } from '../lib/gists/onDevice.svelte';
  import { gistName } from '../lib/model/settings';
  import { closeOnOutside, focusItem, step } from '../lib/menuNav';
  import { go } from '../lib/state/route';
  import { ui } from '../lib/state/ui.svelte';
  import { sync } from '../lib/sync/sync.svelte';
  import { errorText } from '../lib/sync/messages';

  let { place }: { place: 'sidebar' | 'view' } = $props();

  let active = $derived(deviceGists.active);
  let open = $state(false);
  let button = $state<HTMLButtonElement>();
  let menu = $state<HTMLDivElement>();

  $effect(() => {
    if (!open) return;
    return closeOnOutside(() => [menu, button], () => (open = false));
  });

  /** Open the menu with its first item focused (from the keyboard). */
  async function openFromKeys() {
    open = true;
    await tick();
    focusItem(menu, 0);
  }

  function onButtonKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      void openFromKeys();
    }
  }

  function onMenuKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      step(menu!, e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      open = false;
      button?.focus();
    }
  }

  /** Switch to another gist, then start again on it (FR-19.11). */
  async function switchTo(db: string) {
    open = false;
    try {
      await sync.switchTo(db);
      location.replace(location.pathname);
    } catch (e) {
      ui.say(errorText(e));
    }
  }

  function addGist() {
    open = false;
    ui.addingGist = true;
  }

  async function manage() {
    open = false;
    go({ kind: 'settings' });
    await tick();
    document.getElementById('your-gists')?.scrollIntoView({ block: 'start' });
  }
</script>

{#if active && deviceGists.list.length > 1}
  {#if place === 'sidebar'}
    <div class="wrap">
      <button
        type="button"
        class="band gist-{active.label.colour}"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Gist: ${gistName(active.label)}. Switch gist`}
        bind:this={button}
        onclick={() => (open = !open)}
        onkeydown={onButtonKey}
      >
        <span class="dot" aria-hidden="true"></span>
        <span class="name">{gistName(active.label)}</span>
        <Icon name="selector" size={14} />
      </button>
      {#if open}
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <div class="menu" role="menu" aria-label="Switch gist" tabindex="-1" bind:this={menu} onkeydown={onMenuKey}>
          <div class="heading" role="presentation">Switch to</div>
          {#each deviceGists.others as g (g.db)}
            <button type="button" role="menuitem" class="gist-{g.label.colour}" onclick={() => switchTo(g.db)}>
              <span class="dot" aria-hidden="true"></span><span class="name">{gistName(g.label)}</span>
            </button>
          {/each}
          <div class="divider" role="separator"></div>
          <button type="button" role="menuitem" onclick={addGist}>Add Gist…</button>
          <button type="button" role="menuitem" onclick={manage}>Manage Gists…</button>
        </div>
      {/if}
    </div>
  {:else}
    <div class="label gist-{active.label.colour}" role="status" aria-label="Gist">
      <span class="dot" aria-hidden="true"></span><span class="name">{gistName(active.label)}</span>
    </div>
  {/if}
{/if}

<style>
  /* Each colour sets the text and dot colour, and the band's background. */
  .gist-blue { --gist: var(--gist-blue); --gist-bg: var(--gist-blue-bg); }
  .gist-green { --gist: var(--gist-green); --gist-bg: var(--gist-green-bg); }
  .gist-tan { --gist: var(--gist-tan); --gist-bg: var(--gist-tan-bg); }
  .gist-red { --gist: var(--gist-red); --gist-bg: var(--gist-red-bg); }
  .gist-teal { --gist: var(--gist-teal); --gist-bg: var(--gist-teal-bg); }
  .gist-grey { --gist: var(--gist-grey); --gist-bg: var(--gist-grey-bg); }

  .wrap {
    position: relative;
    margin: 0 10px 8px;
  }
  .band {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    border: 0;
    border-radius: var(--radius);
    padding: 6px 10px;
    background: var(--gist-bg);
    color: var(--gist);
    font-size: 13px;
    font-weight: 600;
    text-align: left;
  }
  .dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--gist);
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    min-width: 180px;
    background: var(--surface);
    border-radius: 8px;
    box-shadow: var(--shadow-popover);
    padding: 4px;
    display: flex;
    flex-direction: column;
    z-index: var(--z-sidebar-menu);
    font-size: 13px;
  }
  .heading {
    padding: 6px 10px 2px;
    font-size: 11px;
    color: var(--text-3);
  }
  .menu button {
    display: flex;
    align-items: center;
    gap: 8px;
    text-align: left;
    border: 0;
    background: transparent;
    padding: 8px 10px;
    border-radius: var(--radius);
  }
  .menu button:hover,
  .menu button:focus-visible {
    background: var(--hover-bg);
  }
  .divider {
    height: 1px;
    margin: 4px 6px;
    background: var(--divider);
  }
  /* Phones: larger rows for touch. */
  @media (max-width: 767px) {
    .band {
      padding: 10px 12px;
      font-size: 15px;
    }
    .menu {
      font-size: 16px;
    }
    .menu button {
      padding: 11px 12px;
    }
  }
  .label {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: -4px 0 8px;
    color: var(--gist);
    font-size: 13px;
    font-weight: 600;
  }
  .label .name {
    flex: none;
  }
  @media print {
    .wrap,
    .label {
      display: none;
    }
  }
</style>
