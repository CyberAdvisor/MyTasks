/**
 * App settings (design doc, Section 4, "Settings" entity).
 *
 * Settings are stored as key/value rows. `readSettings` merges stored rows
 * over the defaults and ignores invalid values, so a damaged or missing row
 * never breaks the app.
 */
import type { Priority, SettingEntry } from './types';

export interface AppSettings {
  /** Display labels for P1 to P5 (FR-14.3). Index 0 is P1. */
  priorityLabels: string[];
  /** FR-14.9: set P1 automatically for due and overdue to-dos in Today. */
  autoP1: boolean;
  /** FR-14.10: set P2 by default for to-dos added to Today. */
  defaultP2: boolean;
}

/** Stored setting keys. */
export type SettingKey = keyof AppSettings;

export const DEFAULT_PRIORITY_LABELS = ['P1', 'P2', 'P3', 'P4', 'P5'];

export const DEFAULT_SETTINGS: AppSettings = {
  priorityLabels: DEFAULT_PRIORITY_LABELS,
  autoP1: true,
  defaultP2: true,
};

/** All priorities, highest first. */
export const PRIORITIES: Priority[] = [1, 2, 3, 4, 5];

/** Build settings from stored rows, falling back to defaults per key. */
export function readSettings(rows: SettingEntry[]): AppSettings {
  const stored = new Map(rows.map((r) => [r.key, r.value]));
  const labels = stored.get('priorityLabels');
  const bool = (key: SettingKey, fallback: boolean) => {
    const v = stored.get(key);
    return typeof v === 'boolean' ? v : fallback;
  };
  return {
    priorityLabels: cleanLabels(labels),
    autoP1: bool('autoP1', DEFAULT_SETTINGS.autoP1),
    defaultP2: bool('defaultP2', DEFAULT_SETTINGS.defaultP2),
  };
}

/**
 * Five non-empty labels. A missing or blank label falls back to its default,
 * since a label cannot be empty (FR-14.3).
 */
export function cleanLabels(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [];
  return DEFAULT_PRIORITY_LABELS.map((def, i) => {
    const v = list[i];
    return typeof v === 'string' && v.trim() ? v.trim() : def;
  });
}

/** The user's label for a priority, e.g. "Urgent" for P1. */
export function priorityLabel(p: Priority, settings: AppSettings): string {
  return settings.priorityLabels[p - 1] ?? `P${p}`;
}
