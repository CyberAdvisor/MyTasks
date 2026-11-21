<!--
  A heading-styled text field that saves as you type (debounced 300 ms).
  Used for project, area and heading titles. With `fit`, the field is only
  as wide as its text, so something can sit right after it (the project ⋯).

  With `wrap`, on phones (under 768 px) a long title wraps, with what follows
  it (the ⋯) after its last word (Milestone 11 PR 8b): the
  title shows as text, and a tap turns it into a wrapping text box until it
  is left or Return is pressed. A title has no line breaks: pasted ones
  become spaces. Wider screens keep the one-line field.
-->
<script lang="ts">
  import { PHONE_QUERY } from '../lib/breakpoints';
  import { onDestroy, tick } from 'svelte';
  import { onHide } from '../lib/state/onHide';

  let {
    value,
    placeholder,
    onsave,
    size = 28,
    label,
    autofocus = false,
    fit = false,
    wrap = false,
  }: {
    value: string;
    placeholder: string;
    onsave: (v: string) => void;
    size?: number;
    label: string;
    autofocus?: boolean;
    fit?: boolean;
    /** Wrap on phones, as text, with the next element after its last word. */
    wrap?: boolean;
  } = $props();

  // svelte-ignore state_referenced_locally
  let text = $state(value);
  let focused = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let input = $state<HTMLInputElement>();
  let box = $state<HTMLTextAreaElement>();

  // Phones wrap a `wrap` title; the same width as the app's other phone layouts.
  const phoneQuery = typeof matchMedia === 'undefined' ? null : matchMedia(PHONE_QUERY);
  let phone = $state(phoneQuery?.matches ?? false);
  $effect(() => {
    if (!phoneQuery) return;
    const follow = () => (phone = phoneQuery.matches);
    phoneQuery.addEventListener('change', follow);
    return () => phoneQuery.removeEventListener('change', follow);
  });
  let wrapping = $derived(wrap && phone);
  /** Wrapping: whether the text box is showing, from the start for a new (empty) title. */
  // svelte-ignore state_referenced_locally
  let editing = $state(autofocus || !value);

  /** Grow the text box to its text, so every line shows. */
  function fitBox() {
    if (!box) return;
    box.style.height = 'auto';
    box.style.height = `${box.scrollHeight}px`;
  }

  async function startEditing() {
    editing = true;
    await tick();
    fitBox();
    box?.focus();
    box?.setSelectionRange(text.length, text.length);
  }

  /** Text sent to `onsave` that `value` has not caught up with yet. */
  let saved: string | null = null;

  // Follow outside changes (e.g. another view renamed it) while not editing.
  // Until our own save comes back, keep showing the saved text: falling back
  // to the old value would flash it, and move anything placed after the title.
  $effect(() => {
    const current = value;
    if (focused || (saved !== null && current !== saved)) return;
    saved = null;
    text = current;
  });

  $effect(() => {
    if (autofocus) (wrapping ? box : input)?.focus();
  });
  $effect(() => {
    void text;
    if (wrapping && editing) void tick().then(fitBox);
  });

  function flush() {
    clearTimeout(timer);
    timer = undefined;
    if (text !== value) {
      saved = text;
      onsave(text);
    }
  }

  onDestroy(flush);
  // Leaving the app saves the typed title at once (review C7).
  $effect(() => onHide(flush));
</script>

{#snippet field()}
  <input
    bind:this={input}
    bind:value={text}
    aria-label={label}
    {placeholder}
    size={fit ? 1 : undefined}
    style:font-size="{size}px"
    oninput={() => {
      clearTimeout(timer);
      timer = setTimeout(flush, 300);
    }}
    onfocus={() => (focused = true)}
    onblur={() => {
      focused = false;
      flush();
    }}
    onkeydown={(e) => {
      if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
    }}
  />
{/snippet}

{#if wrapping && editing}
  <textarea
    bind:this={box}
    bind:value={text}
    class="box"
    rows="1"
    aria-label={label}
    {placeholder}
    style:font-size="{size}px"
    oninput={() => {
      // A title is one line: pasted line breaks become spaces.
      if (/[\r\n]/.test(text)) text = text.replace(/[\r\n]+/g, ' ');
      clearTimeout(timer);
      timer = setTimeout(flush, 300);
    }}
    onfocus={() => (focused = true)}
    onblur={() => {
      focused = false;
      flush();
      if (text) editing = false;
    }}
    onkeydown={(e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        (e.currentTarget as HTMLTextAreaElement).blur();
      }
    }}
  ></textarea>
{:else if wrapping}
  <span
    class="wrapped"
    role="button"
    tabindex="0"
    aria-label="{label}: {text || placeholder}"
    style:font-size="{size}px"
    onclick={startEditing}
    onkeydown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        void startEditing();
      }
    }}>{text || placeholder}</span
  >
{:else if fit}
  <!-- A hidden copy of the text sets the width; the field fills the same cell. -->
  <span class="fit">
    <span class="mirror" aria-hidden="true" style:font-size="{size}px">{text || placeholder}</span>
    {@render field()}
  </span>
{:else}
  {@render field()}
{/if}

<style>
  input {
    border: 0;
    outline: none;
    background: transparent;
    font-weight: 700;
    letter-spacing: -0.01em;
    min-width: 0;
    width: 100%;
    padding: 0;
  }
  .fit {
    display: inline-grid;
    min-width: 0;
    max-width: 100%;
  }
  .fit > * {
    grid-area: 1 / 1;
  }
  /* Size from the text copy only: browsers give even a one-character field
     room for their widest character, which left a gap after short titles. */
  .fit > input {
    width: 0;
    min-width: 100%;
  }
  .mirror {
    visibility: hidden;
    white-space: pre;
    overflow: hidden;
    font-weight: 700;
    letter-spacing: -0.01em;
    padding-right: 2px;
  }
  input::placeholder,
  textarea::placeholder {
    color: var(--placeholder);
  }
  /* Phones, wrapping: the title as text, then as a text box while edited. */
  .wrapped,
  .box {
    font-weight: 700;
    letter-spacing: -0.01em;
    line-height: 1.15;
    overflow-wrap: anywhere;
  }
  .wrapped {
    cursor: text;
    outline: none;
    /* A non-breaking gap before what follows (the ⋯). */
    margin-right: 0.15em;
  }
  .box {
    display: block;
    width: 100%;
    border: 0;
    outline: none;
    background: transparent;
    padding: 0;
    margin: 0;
    resize: none;
    overflow: hidden;
    font-family: inherit;
    color: inherit;
  }
</style>
