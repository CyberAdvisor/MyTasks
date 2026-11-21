<!--
  Segmented control: a row of buttons where exactly one is chosen.
  Used by Today's grouping bar (FR-16.1) and the Theme setting (FR-V.3).
-->
<script lang="ts" generics="T extends string">
  let {
    options,
    value,
    label,
    onchange,
  }: {
    options: readonly { value: T; label: string }[];
    value: T;
    /** Accessible name for the group, e.g. "Group Today by". */
    label: string;
    onchange: (value: T) => void;
  } = $props();
</script>

<div class="segmented" role="group" aria-label={label}>
  {#each options as o (o.value)}
    <button type="button" aria-pressed={value === o.value} onclick={() => onchange(o.value)}>
      {o.label}
    </button>
  {/each}
</div>

<style>
  .segmented {
    display: inline-flex;
    gap: 2px;
    padding: 2px;
    background: var(--hover-bg);
    border-radius: 8px;
  }
  button {
    border: 0;
    background: transparent;
    padding: 4px 12px;
    border-radius: 6px;
    font-size: 13px;
    color: var(--text-2);
  }
  button[aria-pressed='true'] {
    background: var(--segment-on);
    color: var(--text);
    font-weight: 600;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
  }
</style>
