/**
 * The Appearance setting (FR-V.3): Light, Dark or System, kept on this device
 * for every gist on it (FR-19.11), like the sidebar's width. Never synced.
 *
 * Before 1.11 it was a row of the task database's settings; `adoptOldTheme`
 * moves that row here once.
 */
import { writable } from 'svelte/store';
import { db } from '../db/database';
import { THEMES, type Theme } from '../model/settings';
import { readText, writeText } from './flags';

const KEY = 'mytasks.theme';

function valid(value: unknown): Theme | null {
  return THEMES.find((t) => t === value) ?? null;
}

const store = writable<Theme>(valid(readText(KEY)) ?? 'system');

/** This device's theme. */
export const theme = { subscribe: store.subscribe };

/** Choose this device's theme. */
export function setTheme(value: Theme): void {
  writeText(KEY, value);
  store.set(value);
}

/**
 * Move the theme a device chose before 1.11 out of the task database, where
 * it was a setting, unless this device already has one here. Run at start-up.
 */
export async function adoptOldTheme(): Promise<void> {
  const row = await db.settings.get('theme');
  if (!row) return;
  const old = valid(row.value);
  if (old && valid(readText(KEY)) === null) setTheme(old);
  await db.settings.delete('theme');
}
