<!-- The app logo (design doc Section 6: FR-V.5): "MT" in small caps above a
     filled circle with a check cut out of it. The same drawing as
     public/favicon.svg, which every app icon is made from; here its colours
     follow the app's Light or Dark setting (--logo-bg, --logo-fg). The app
     never draws it below 32 px, so the favicon's 16 px MT-only form isn't
     needed here. -->
<script lang="ts">
  let { size = 32 }: { size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 110 110" role="img" aria-label="My Tasks logo">
  <rect width="110" height="110" rx="24" fill="var(--logo-bg)" />
  <g fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M20 51V21l15 19 15-19v30M58 21h32M74 21v30" stroke="var(--logo-fg)" stroke-width="8.5" />
    <circle cx="55" cy="74" r="15" fill="var(--logo-fg)" />
    <path d="M47.5 74l5.5 5.5 10-11" stroke="var(--logo-bg)" stroke-width="5" />
  </g>
</svg>
