/**
 * App settings (design doc, Section 4, "Settings" entity).
 *
 * Settings are stored as key/value rows. `readSettings` merges stored rows
 * over the defaults and ignores invalid values, so a damaged or missing row
 * never breaks the app.
 */
import type { TodayGrouping } from './lists';
import type { ID, Priority, SettingEntry } from './types';

export interface AppSettings {
  /** Display labels for P1 to P5 (FR-14.3). Index 0 is P1. */
  priorityLabels: string[];
  /** FR-14.9: set P1 automatically for due and overdue to-dos in Today. */
  autoP1: boolean;
  /** FR-14.10: set P2 by default for to-dos added to Today. */
  defaultP2: boolean;
  /** FR-16.1: how the Today list is grouped. */
  todayGrouping: TodayGrouping;
  /** FR-12.2: when completed items move to Completed. */
  moveToCompleted: MoveToCompleted;
  /** FR-12.7: show completed to-dos below the open ones in each section. */
  sinkCompleted: boolean;
  /** FR-7.5: show checked checklist items below the unchecked ones. */
  sinkChecked: boolean;
  /** FR-17.1: project tags that make a project sequential, in Settings order. */
  sequentialTags: SequentialTag[];
  /** FR-21.3: show the Mac calendar helper's events in Today and Scheduled. */
  showCalendarEvents: boolean;
  /** FR-23.1: how many tasks each group in Unscheduled shows before Show All; null for all. */
  unscheduledLimit: number | null;
  /** FR-19.14: this gist's name and colour; a null name shows as Default (`gistName`). */
  gistLabel: GistLabel;
}

/** A gist's colours (FR-19.14), in the order the colour picker shows them. */
export const GIST_COLOURS = ['blue', 'green', 'tan', 'red', 'teal', 'grey'] as const;
export type GistColour = (typeof GIST_COLOURS)[number];

/** A gist's name and colour (FR-19.14), kept in the gist as a synced setting. */
export interface GistLabel {
  /** Null until named: the gist of a device from before 1.11 shows as Default. */
  name: string | null;
  colour: GistColour;
}

/** A gist's name: at most this many characters (FR-19.14). */
export const GIST_NAME_MAX = 24;

/** The name shown for a gist with none. */
export const DEFAULT_GIST_NAME = 'Default';

/** When completed items move to Completed (FR-12.2). */
/** One row of Settings › Sequential projects (FR-17.1). */
export interface SequentialTag {
  tagId: ID;
  /** The priority a released task gets (FR-17.3); null for None. */
  priority: Priority | null;
  /** The context a released task with none gets (FR-17.4); null for none. */
  contextId: ID | null;
}

export type MoveToCompleted = 'immediately' | 'daily' | 'manually';

/** The Appearance setting (FR-V.3), kept per device (state/theme.ts), not here. */
export type Theme = 'system' | 'light' | 'dark';
export const THEMES: Theme[] = ['system', 'light', 'dark'];

/** Stored setting keys. */
export type SettingKey = keyof AppSettings;

export const DEFAULT_PRIORITY_LABELS = ['P1', 'P2', 'P3', 'P4', 'P5'];

export const DEFAULT_SETTINGS: AppSettings = {
  priorityLabels: DEFAULT_PRIORITY_LABELS,
  autoP1: true,
  defaultP2: true,
  todayGrouping: 'none',
  moveToCompleted: 'daily',
  sinkCompleted: false,
  sinkChecked: false,
  sequentialTags: [],
  showCalendarEvents: true,
  unscheduledLimit: 3,
  gistLabel: { name: null, colour: 'grey' },
};

const GROUPINGS: TodayGrouping[] = ['none', 'project', 'priority', 'context'];
export const MOVE_TO_COMPLETED: MoveToCompleted[] = ['immediately', 'daily', 'manually'];
/** The choices for Tasks shown per group in Unscheduled (FR-23.1); null is All. */
export const UNSCHEDULED_LIMITS: (number | null)[] = [1, 2, 3, 5, 10, 20, null];

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
    todayGrouping: GROUPINGS.find((g) => g === stored.get('todayGrouping')) ?? DEFAULT_SETTINGS.todayGrouping,
    moveToCompleted:
      MOVE_TO_COMPLETED.find((m) => m === stored.get('moveToCompleted')) ?? DEFAULT_SETTINGS.moveToCompleted,
    sinkCompleted: bool('sinkCompleted', DEFAULT_SETTINGS.sinkCompleted),
    sinkChecked: bool('sinkChecked', DEFAULT_SETTINGS.sinkChecked),
    sequentialTags: cleanSequentialTags(stored.get('sequentialTags')),
    showCalendarEvents: bool('showCalendarEvents', DEFAULT_SETTINGS.showCalendarEvents),
    unscheduledLimit: stored.has('unscheduledLimit') && UNSCHEDULED_LIMITS.includes(stored.get('unscheduledLimit') as number | null)
      ? (stored.get('unscheduledLimit') as number | null)
      : DEFAULT_SETTINGS.unscheduledLimit,
    gistLabel: cleanGistLabel(stored.get('gistLabel')),
  };
}

/** A stored gist label, or the default when it isn't well formed. */
export function cleanGistLabel(value: unknown): GistLabel {
  if (!value || typeof value !== 'object') return DEFAULT_SETTINGS.gistLabel;
  const v = value as Record<string, unknown>;
  const name = typeof v.name === 'string' && isGistName(v.name) ? v.name : null;
  const colour = GIST_COLOURS.find((c) => c === v.colour) ?? DEFAULT_SETTINGS.gistLabel.colour;
  return { name, colour };
}

/** Whether `name` is a usable gist name as stored: trimmed, 1 to GIST_NAME_MAX characters. */
export function isGistName(name: string): boolean {
  return name === name.trim() && name.length > 0 && [...name].length <= GIST_NAME_MAX;
}

/** The name a gist shows: its own, or Default. */
export function gistName(label: GistLabel): string {
  return label.name ?? DEFAULT_GIST_NAME;
}

/**
 * A gist's name as part of a file name (backup, archive; FR-19.11): characters
 * that file systems refuse become a hyphen.
 */
export function gistFileName(label: GistLabel): string {
  return gistName(label).replace(/[\\/:*?"<>|]/g, '-');
}

/**
 * What's wrong with a name typed for a gist, or null when it can be used
 * (FR-19.14): required, at most GIST_NAME_MAX characters, and different from
 * `others`, the names this device's other gists show (case ignored).
 */
export function gistNameProblem(typed: string, others: string[]): string | null {
  const name = typed.trim();
  if (!name) return 'Enter a name.';
  if ([...name].length > GIST_NAME_MAX) return `Use at most ${GIST_NAME_MAX} characters.`;
  const lower = name.toLocaleLowerCase();
  if (others.some((o) => o.toLocaleLowerCase() === lower)) return `“${name}” is already used on this device.`;
  return null;
}

/** The stored Sequential projects rows, keeping only well-formed ones, each tag once. */
export function cleanSequentialTags(value: unknown): SequentialTag[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<ID>();
  const rows: SequentialTag[] = [];
  for (const v of value) {
    if (!v || typeof v !== 'object' || typeof v.tagId !== 'string' || seen.has(v.tagId)) continue;
    seen.add(v.tagId);
    rows.push({
      tagId: v.tagId,
      priority: PRIORITIES.includes(v.priority) ? v.priority : null,
      contextId: typeof v.contextId === 'string' ? v.contextId : null,
    });
  }
  return rows;
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
