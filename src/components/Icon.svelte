<!--
  Inline stroke icons (original artwork). Decorative by default;
  pass `label` to expose the icon to screen readers.
-->
<script lang="ts">
  type Name =
    | 'inbox' | 'star' | 'calendar' | 'layers' | 'archive' | 'logbook' | 'trash'
    | 'search' | 'chevron-down' | 'chevron-right' | 'chevron-left' | 'area' | 'plus'
    | 'settings' | 'flag' | 'notes' | 'move' | 'more' | 'x' | 'check' | 'heading';

  let { name, size = 18, color = 'currentColor', label = '' }: {
    name: Name; size?: number; color?: string; label?: string;
  } = $props();

  const PATHS: Record<Name, string> = {
    inbox: 'M22 12h-6l-2 3h-4l-2-3H2 M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
    star: 'M12 2.5l2.95 6 6.55.95-4.75 4.62 1.12 6.53L12 17.5l-5.87 3.1 1.12-6.53L2.5 9.45l6.55-.95z',
    calendar: 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M16 2v4 M8 2v4 M3 10h18',
    layers: 'M12 2 2 7l10 5 10-5-10-5z M2 17l10 5 10-5 M2 12l10 5 10-5',
    archive: 'M3 3h18a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8 M10 12h4',
    logbook: 'M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20 M9 9l2 2 4-4',
    trash: 'M3 6h18 M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
    search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14z M21 21l-4.3-4.3',
    'chevron-down': 'm6 9 6 6 6-6',
    'chevron-right': 'm9 6 6 6-6 6',
    'chevron-left': 'm15 18-6-6 6-6',
    area: 'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z',
    plus: 'M12 5v14 M5 12h14',
    settings: 'M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 14h6 M9 8h6 M17 16h6',
    flag: 'M5 22V3h12l-2 4 2 4H5',
    notes: 'M4 6h16 M4 12h16 M4 18h10',
    move: 'M5 12h14 M13 6l6 6-6 6',
    more: 'M5 12h.01 M12 12h.01 M19 12h.01',
    x: 'M6 6l12 12 M18 6 6 18',
    check: 'm5 12 5 5 9-10',
    heading: 'M4 6h16 M4 12h10',
  };
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke={color}
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  role={label ? 'img' : undefined}
  aria-label={label || undefined}
  aria-hidden={label ? undefined : 'true'}
  style="flex: none"
>
  <path d={PATHS[name]} />
</svg>
