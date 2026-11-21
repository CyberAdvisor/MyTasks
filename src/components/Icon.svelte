<!--
  Inline stroke icons (original artwork). Decorative by default;
  pass `label` to expose the icon to screen readers.
-->
<script lang="ts">
  type Name =
    | 'inbox' | 'star' | 'calendar' | 'layers' | 'archive' | 'logbook' | 'trash'
    | 'search' | 'chevron-down' | 'chevron-right' | 'chevron-left' | 'area' | 'plus'
    | 'settings' | 'flag' | 'note' | 'move' | 'more' | 'x' | 'check' | 'heading'
    | 'tag' | 'checklist' | 'priority' | 'priority-circle' | 'arrow-up' | 'arrow-down' | 'heading-add' | 'copy'
    | 'project' | 'pencil' | 'cancel' | 'context' | 'cloud' | 'cloud-off' | 'alert' | 'help' | 'sync'
    | 'download' | 'share' | 'printer' | 'sidebar' | 'focus' | 'repeat' | 'minus' | 'grip'
    | 'pin' | 'car' | 'bell' | 'link' | 'people';

  let { name, size = 18, color = 'currentColor', label = '', weight = 2, filled = false }: {
    name: Name; size?: number; color?: string; label?: string;
    /** Fill the shape with `color` too (the Today star on task rows). */
    filled?: boolean;
    /** Stroke width; higher is bolder (e.g. the project title's ⋯). */
    weight?: number;
  } = $props();

  const PATHS: Record<Name, string> = {
    // Calendar event details (FR-21.4).
    pin: 'M12 21s-6.5-5.9-6.5-11a6.5 6.5 0 0 1 13 0c0 5.1-6.5 11-6.5 11z M12 7.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z',
    car: 'M5 16v-4l2-5h10l2 5v4z M5 16v2 M19 16v2 M5 12h14 M8 14h.01 M16 14h.01',
    bell: 'M6 16v-5a6 6 0 1 1 12 0v5l2 2H4z M10 20a2 2 0 0 0 4 0',
    link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
    people: 'M9 4.8a3.2 3.2 0 1 1 0 6.4 3.2 3.2 0 0 1 0-6.4z M3 20a6 6 0 0 1 12 0 M17 6.5a2.5 2.5 0 1 1 0 5 M15.5 14.2A5 5 0 0 1 21 19',
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
    // A gear, as most apps show Settings (review F8; Feather's "settings", MIT).
    settings:
      'M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z',
    flag: 'M5 22V3h12l-2 4 2 4H5',
    note: 'M6 2h9l5 5v15H6z M15 2v5h5 M9.5 12.5h7 M9.5 17h7',
    move: 'M5 12h14 M13 6l6 6-6 6',
    more: 'M5 12h.01 M12 12h.01 M19 12h.01',
    x: 'M6 6l12 12 M18 6 6 18',
    check: 'm5 12 5 5 9-10',
    heading: 'M4 6h16 M4 12h10',
    tag: 'M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z M7 7h.01',
    checklist: 'M10 6h11 M10 12h11 M10 18h11 M3 6l1.5 1.5L7 5 M3 12l1.5 1.5L7 11 M3 18l1.5 1.5L7 17',
    priority: 'M12 4v10 M12 19.5h.01',
    'priority-circle': 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z M12 7.5v5.5 M12 16.5h.01',
    grip: 'M5 8h14 M5 12h14 M5 16h14',
    'arrow-up': 'M12 19V5 M5 12l7-7 7 7',
    'arrow-down': 'M12 5v14 M19 12l-7 7-7-7',
    copy: 'M9 9h11v11H9z M5 15H4V4h11v1',
    'heading-add': 'M3 6h12.5l5 6-5 6H3z M7.5 12h6 M10.5 9v6',
    project: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z',
    pencil: 'M4 20h4L19 9l-4-4L4 16z M13.5 6.5l4 4',
    cancel: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M9 9l6 6 M15 9l-6 6',
    context: 'M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11z M12 7.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z',
    cloud: 'M17.5 19H7a5 5 0 1 1 1.1-9.88A6 6 0 0 1 19.6 11.1 4 4 0 0 1 17.5 19z',
    'cloud-off': 'M17.5 19H7a5 5 0 0 1-1.8-9.67 M10.2 6.6A6 6 0 0 1 19.6 11.1a4 4 0 0 1 1.3 6.6 M3 3l18 18',
    alert: 'M12 3 2 20h20z M12 10v4 M12 17h.01',
    help: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3 M12 17h.01',
    download: 'M12 3v12 M7 10l5 5 5-5 M5 21h14',
    share: 'M12 3v13 M8 7l4-4 4 4 M7 11H5v10h14V11h-2',
    printer: 'M6 9V3h12v6 M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2 M6 14h12v7H6z',
    sidebar: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M9 4v16',
    focus: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z M12 11.99v.02',
    sync: 'M20 11a8 8 0 0 0-14.3-4.9L4 8 M4 4v4h4 M4 13a8 8 0 0 0 14.3 4.9L20 16 M20 20v-4h-4',
    repeat: 'M20 12a8 8 0 1 1-2.3-5.6 M20 3.5v4.5h-4.5',
    minus: 'M5 12h14',
  };
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill={filled ? color : 'none'}
  stroke={color}
  stroke-width={weight}
  stroke-linecap="round"
  stroke-linejoin="round"
  role={label ? 'img' : undefined}
  aria-label={label || undefined}
  aria-hidden={label ? undefined : 'true'}
  style="flex: none"
>
  <path d={PATHS[name]} />
</svg>
