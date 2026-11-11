<!-- The app logo (placeholder artwork, design doc Section 6: FR-V.5). -->
<script lang="ts">
  let { size = 32 }: { size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label="My Tasks logo">
  <rect width="32" height="32" rx="8" fill="var(--accent)" />
  <path d="M9 16.5l4.5 4.5L23 11" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
</svg>
