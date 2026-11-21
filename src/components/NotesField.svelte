<!--
  A notes field that shows its light Markdown when not being edited (FR-7.4), used
  in the task card and on project pages.

  - Showing: the note drawn by NoteText, links clickable (a new tab). A click or tap
    anywhere else on it, or Tab reaching it, turns it into the text box, the caret
    at the end. A press on a link doesn't take focus, so the link opens instead.
  - Editing: a plain text box, growing with its text; leaving it shows the note again.
  - An empty note is always the text box, so its placeholder shows.
  The note itself stays plain text: what's typed is what's saved.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import NoteText from './NoteText.svelte';

  let {
    value = $bindable(''),
    id,
    label,
    placeholder = 'Notes',
    oninput,
    onfocus,
    onblur,
  }: {
    value: string;
    id?: string;
    label: string;
    placeholder?: string;
    oninput?: () => void;
    onfocus?: () => void;
    onblur?: () => void;
  } = $props();

  let editing = $state(false);
  let box = $state<HTMLTextAreaElement>();
  let showing = $derived(!editing && value.trim() !== '');

  /** Make the box as tall as its text, at least its two rows. */
  function fit() {
    if (!box) return;
    box.style.height = 'auto';
    box.style.height = `${box.scrollHeight}px`;
  }

  /** Switch to the text box, focused, with the caret after the text. */
  async function edit() {
    if (editing) return;
    editing = true;
    await tick();
    if (!box) return;
    fit();
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
  }

  /**
   * A press on a link opens it; anywhere else starts editing. With a mouse the
   * press is cancelled so it can't focus the note (Safari doesn't focus links);
   * a touch must not be cancelled, or iPhone drops the tap, so the note instead
   * ignores the focus that comes with it.
   */
  let pressingLink = false;
  function onViewDown(e: PointerEvent) {
    if (!(e.target as Element).closest('a')) return;
    if (e.pointerType === 'mouse') e.preventDefault();
    else {
      pressingLink = true;
      setTimeout(() => (pressingLink = false), 1000);
    }
  }

  function onViewClick(e: MouseEvent) {
    if ((e.target as Element).closest('a')) {
      pressingLink = false;
      return;
    }
    void edit();
  }

  function onViewFocus() {
    if (!pressingLink) void edit();
  }

  $effect(() => {
    // Fit again whenever the text changes while the box shows (typing, or a save from elsewhere).
    void value;
    if (box) fit();
  });
</script>

{#if showing}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    {id}
    class="notes-view"
    role="textbox"
    aria-label={label}
    aria-multiline="true"
    tabindex="0"
    onpointerdown={onViewDown}
    onclick={onViewClick}
    onkeydown={(e) => {
      if (e.key === 'Enter' && !(e.target as Element).closest('a')) void edit();
    }}
    onfocus={onViewFocus}
  >
    <NoteText note={value} />
  </div>
{:else}
  <textarea
    {id}
    class="notes"
    aria-label={label}
    bind:this={box}
    bind:value
    {placeholder}
    rows="2"
    oninput={() => {
      fit();
      oninput?.();
    }}
    onfocus={() => {
      editing = true;
      onfocus?.();
    }}
    onblur={() => {
      editing = false;
      onblur?.();
    }}
  ></textarea>
{/if}

<style>
  .notes,
  .notes-view {
    display: block;
    width: 100%;
    box-sizing: border-box;
    margin: 0;
    padding: 2px 0;
    border: 0;
    font: inherit;
    font-size: 14px;
    line-height: 1.45;
    color: var(--text-2);
    background: transparent;
    overflow-wrap: anywhere;
  }
  .notes {
    outline: none;
    resize: none;
    overflow: hidden;
  }
  .notes-view {
    cursor: text;
    min-height: calc(1.45em + 4px);
  }
  .notes-view:focus {
    outline: none;
  }
</style>
