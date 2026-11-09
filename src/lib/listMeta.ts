/**
 * Display names, icons and colors for the built-in lists
 * (design doc, Section 6, Color).
 */
import type { BuiltInList } from './model/lists';

export interface ListMeta {
  title: string;
  icon: 'inbox' | 'star' | 'calendar' | 'layers' | 'archive' | 'logbook' | 'trash';
  /** CSS color token for the icon. */
  color: string;
}

export const LIST_META: Record<BuiltInList, ListMeta> = {
  inbox: { title: 'Inbox', icon: 'inbox', color: 'var(--c-inbox)' },
  today: { title: 'Today', icon: 'star', color: 'var(--c-today)' },
  scheduled: { title: 'Scheduled', icon: 'calendar', color: 'var(--c-scheduled)' },
  unscheduled: { title: 'Unscheduled', icon: 'layers', color: 'var(--c-unscheduled)' },
  deferred: { title: 'Deferred', icon: 'archive', color: 'var(--c-deferred)' },
  logbook: { title: 'Logbook', icon: 'logbook', color: 'var(--c-logbook)' },
  trash: { title: 'Trash', icon: 'trash', color: 'var(--c-trash)' },
};
