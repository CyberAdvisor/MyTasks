<!--
  A heading-styled text field that saves as you type (debounced 300 ms).
  Used for project, area and heading titles.
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
  }: {
    value: string;
    placeholder: string;
    onsave: (v: string) => void;
    size?: number;
    label: string;
    autofocus?: boolean;
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

<input
  bind:this={input}
  bind:value={text}
  aria-label={label}
  {placeholder}
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
  input::placeholder {
    color: #b0b0b6;
  }
</style>
