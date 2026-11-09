<!--
  A heading-styled text field that saves as you type (debounced 300 ms).
  Used for project, area and heading titles. With `fit`, the field is only
  as wide as its text, so something can sit right after it (the project ⋯).
-->
<script lang="ts">
  import { onDestroy } from 'svelte';

  let {
    value,
    placeholder,
    onsave,
    size = 28,
    label,
    autofocus = false,
    fit = false,
  }: {
    value: string;
    placeholder: string;
    onsave: (v: string) => void;
    size?: number;
    label: string;
    autofocus?: boolean;
    fit?: boolean;
  } = $props();

  // svelte-ignore state_referenced_locally
  let text = $state(value);
  let focused = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let input: HTMLInputElement;

  // Follow outside changes (e.g. another view renamed it) while not editing.
  $effect(() => {
    if (!focused) text = value;
  });

  $effect(() => {
    if (autofocus) input.focus();
  });

  function flush() {
    clearTimeout(timer);
    timer = undefined;
    if (text !== value) onsave(text);
  }

  onDestroy(flush);
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

{#if fit}
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
  .mirror {
    visibility: hidden;
    white-space: pre;
    overflow: hidden;
    font-weight: 700;
    letter-spacing: -0.01em;
    padding-right: 2px;
  }
  input::placeholder {
    color: #b0b0b6;
  }
</style>
