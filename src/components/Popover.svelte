<!--
  A trigger button plus a floating panel. Closes on Escape (without closing
  the card around it), on any click outside, and when focus moves outside
  it, as with Tab or Shift+Tab. Closed from the keyboard (a choice made
  with Return or Space, or Escape), focus returns to its button, so Tab
  carries on through the card. With a keyboard, opening it focuses its
  current choice (or first option, unless it focuses a field of its own),
  and Up and Down move between its options and fields; the calendar keeps
  its own arrow keys. Used by the When, Deadline,
  Tags, Priority and More menus, and a calendar event's details (FR-21.4).

  On phones (under 768 px) the panel is a sheet along the bottom of the
  screen, full width, titled with `label`, over a dimmed backdrop that closes
  it when tapped (Section 6, Popovers; since v1.1.13). Pinned under its
  button, a panel could run off the screen: in the new-task dialog the empty
  fields' buttons sit on the left.
-->
<script lang="ts">
  import { tick, type Snippet } from 'svelte';

  let {
    open = $bindable(false),
    label,
    align = 'right',
    above = false,
    block = false,
    sheetTitle = true,
    trigger,
    children,
  }: {
    open?: boolean;
    /** Accessible name of the panel. */
    label: string;
    /** Which edge of the trigger the panel lines up with. */
    align?: 'left' | 'right';
    /** Open the panel above the trigger, e.g. from the bottom toolbar. */
    above?: boolean;
    /** Take the full width of the line, for a trigger that is a whole row (a calendar event). */
    block?: boolean;
    /** On phones, title the sheet with `label`; off when the panel shows its own title. */
    sheetTitle?: boolean;
    /** The trigger; call `toggle` to open or close the panel. */
    trigger: Snippet<[toggle: () => void, open: boolean]>;
    children: Snippet;
  } = $props();

  let wrap: HTMLDivElement;

  const toggle = () => (open = !open);

  // Outside clicks close the panel.
  $effect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.contains(e.target as Node)) open = false;
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  });

  // Focus moving outside closes the panel, so Tab and Shift+Tab never leave
  // it open under the next one. Only a known new focus counts: Safari doesn't
  // focus a clicked button, and clicks are handled above.
  $effect(() => {
    if (!open) return;
    const onOut = (e: FocusEvent) => {
      if (e.relatedTarget instanceof Node && !wrap.contains(e.relatedTarget)) open = false;
    };
    wrap.addEventListener('focusout', onOut);
    return () => wrap.removeEventListener('focusout', onOut);
  });

  // Closed from the keyboard, focus goes back to the trigger once the panel
  // has gone, unless something else has taken it. A choice can swap the
  // trigger (a Deadline button becomes a Deadline chip), so it is found again
  // by label in the card or dialog around it.
  let byKey = false;
  $effect(() => {
    if (!open) return;
    byKey = false;
    const scope = wrap.closest<HTMLElement>('[role="group"], dialog') ?? wrap;
    const onKey = (e: KeyboardEvent) => {
      byKey = ['Enter', ' ', 'Escape'].includes(e.key) && wrap.contains(document.activeElement);
    };
    const onDown = () => (byKey = false);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
      if (!byKey) return;
      // The saved choice reaches the card a moment later and may swap the
      // trigger then, so keep putting focus back for about half a second,
      // or until the next key or click, when the user has moved on.
      let frames = 30;
      const stop = () => (frames = 0);
      document.addEventListener('keydown', stop, { capture: true, once: true });
      document.addEventListener('pointerdown', stop, { capture: true, once: true });
      const refocus = () => {
        const lost = !document.activeElement || document.activeElement === document.body;
        const again =
          scope === wrap
            ? wrap.querySelector<HTMLElement>('button')
            : scope.querySelector<HTMLElement>(`[data-popover="${CSS.escape(label)}"] button`);
        if (frames <= 0) return;
        if (scope.isConnected && lost) again?.focus();
        if (--frames > 0) requestAnimationFrame(refocus);
        else {
          document.removeEventListener('keydown', stop, true);
          document.removeEventListener('pointerdown', stop, true);
        }
      };
      requestAnimationFrame(refocus);
    };
  });

  /** The options and fields Up and Down move between, in page order. */
  const options = (panel: HTMLElement) =>
    [...panel.querySelectorAll<HTMLElement>('input:not([type="hidden"]), .menu-item:not(:disabled)')].filter(
      (el) => el.getClientRects().length > 0,
    );

  // With a keyboard, focus starts on the current choice, then Up and Down move.
  // The panel is looked up when needed: it may render after this effect runs.
  // `wrap` is gone once the popover leaves the page (a new view), while a try may still be waiting.
  const panelOf = () => wrap?.querySelector<HTMLElement>('[data-popover-panel]') ?? null;
  $effect(() => {
    if (!open) return;
    if (!matchMedia('(pointer: coarse)').matches) {
      // A few frames at most, until the panel and its options are there.
      let tries = 5;
      const focusChoice = () => {
        const panel = panelOf();
        const target = panel && (panel.querySelector<HTMLElement>('[aria-checked="true"]') ?? options(panel)[0]);
        if (panel?.contains(document.activeElement)) return;
        if (target) target.focus();
        else if (--tries > 0) requestAnimationFrame(focusChoice);
      };
      // As soon as the panel is in the page (a frame can be slow in WebKit).
      void tick().then(focusChoice);
    }
    const onArrow = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const panel = panelOf();
      if (!panel || !panel.contains(e.target as Node) || (e.target as HTMLElement).closest('[role="grid"]')) return;
      const list = options(panel);
      if (list.length === 0) return;
      e.preventDefault();
      const i = list.indexOf(document.activeElement as HTMLElement);
      const by = e.key === 'ArrowDown' ? 1 : -1;
      list[i === -1 ? 0 : (i + by + list.length) % list.length].focus();
    };
    wrap.addEventListener('keydown', onArrow);
    return () => wrap.removeEventListener('keydown', onArrow);
  });

  // Escape closes only the panel, not the card it sits in. Listening in the
  // capture phase lets the panel take the key wherever focus is.
  $effect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        open = false;
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  });
</script>

<div class="wrap" class:block bind:this={wrap} data-popover={label}>
  {@render trigger(toggle, open)}
  {#if open}
    <!-- Phones only (hidden by CSS elsewhere); a tap on it closes the sheet. -->
    <div class="backdrop" aria-hidden="true" onclick={() => (open = false)}></div>
    <div class="panel" class:left={align === 'left'} class:above role="dialog" aria-label={label} data-popover-panel>
      {#if sheetTitle}<div class="sheet-title" aria-hidden="true">{label}</div>{/if}
      <div class="body">{@render children()}</div>
    </div>
  {/if}
</div>

<style>
  .wrap {
    position: relative;
    display: inline-flex;
  }
  .wrap.block {
    display: flex;
  }
  .panel {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    min-width: 200px;
    background: var(--surface);
    border-radius: 8px;
    box-shadow: var(--shadow-popover);
    padding: 4px;
    z-index: var(--z-popover);
  }
  .panel.above {
    top: auto;
    bottom: calc(100% + 6px);
  }
  .panel.left {
    right: auto;
    left: 0;
  }
  .backdrop,
  .sheet-title {
    display: none;
  }

  /* Phones: a sheet along the bottom of the screen (Section 6, Popovers). */
  @media (max-width: 767px) {
    .backdrop {
      display: block;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.38);
      z-index: var(--z-sheet-backdrop);
    }
    .panel,
    .panel.above,
    .panel.left {
      position: fixed;
      top: auto;
      left: 0;
      right: 0;
      bottom: 0;
      max-height: 75vh;
      overflow-y: auto;
      border-radius: 16px 16px 0 0;
      padding: 10px 16px calc(16px + env(safe-area-inset-bottom));
      z-index: var(--z-sheet);
    }
    .sheet-title {
      display: block;
      font-weight: 600;
      text-align: center;
      margin-bottom: 8px;
    }
    /* One centred column, so menus don't stretch across a wide phone, with
       pickers of a set width (the calendar, Tags) in its middle. */
    .body {
      max-width: 320px;
      margin: 0 auto;
    }
    .body > :global(*),
    .body :global(.cal) {
      margin-inline: auto;
    }
  }
</style>
