<!-- Project progress pie (FR-2.2): outline ring filled by the share done. -->
<script lang="ts">
  let { fraction = 0, size = 16 }: { fraction?: number; size?: number } = $props();

  // Inner circle of radius r drawn with a thick stroke renders a pie wedge.
  const r = 2.75;
  const circumference = 2 * Math.PI * r;
  let dash = $derived(`${Math.max(0, Math.min(1, fraction)) * circumference} ${circumference}`);
</script>

<svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" style="flex: none">
  <circle cx="8" cy="8" r="6.5" fill="none" stroke="var(--accent)" stroke-width="1.5" />
  {#if fraction > 0}
    <circle
      cx="8"
      cy="8"
      {r}
      fill="none"
      stroke="var(--accent)"
      stroke-width="5.5"
      stroke-dasharray={dash}
      transform="rotate(-90 8 8)"
    />
  {/if}
</svg>
