/**
 * Local-date helpers.
 *
 * Dates without a time are stored as local `YYYY-MM-DD` strings, so a to-do
 * for "Thursday" stays on Thursday across time zones (design doc, Section 4).
 * Because the format is zero-padded, plain string comparison orders dates.
 */
import type { LocalDate } from './types';

/** Format a Date as a local `YYYY-MM-DD` string. */
export function toLocalDate(d: Date): LocalDate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Today's local date. */
export function today(): LocalDate {
  return toLocalDate(new Date());
}

/** Parse a `YYYY-MM-DD` string into a local Date at midnight. */
export function parseLocalDate(s: LocalDate): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Add whole days to a local date. */
export function addDays(s: LocalDate, days: number): LocalDate {
  const d = parseLocalDate(s);
  d.setDate(d.getDate() + days);
  return toLocalDate(d);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: LocalDate, to: LocalDate): number {
  const ms = parseLocalDate(to).getTime() - parseLocalDate(from).getTime();
  return Math.round(ms / 86_400_000);
}

/** Milliseconds until the next local midnight, for day rollover (FR-3.5). */
export function msUntilMidnight(now: Date = new Date()): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next.getTime() - now.getTime();
}

const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: 'long' });
const SHORT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const MONTH = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });

/** Human label for a date relative to `ref`: Today, Tomorrow, weekday, or "Nov 12". */
export function formatRelative(s: LocalDate, ref: LocalDate): string {
  const diff = daysBetween(ref, s);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return WEEKDAY.format(parseLocalDate(s));
  return SHORT.format(parseLocalDate(s));
}

/** "Month Year" label, used for Scheduled groups beyond the next 7 days. */
export function formatMonth(s: LocalDate): string {
  return MONTH.format(parseLocalDate(s));
}

/** Deadline wording for rows: "Today", "2 days left", "1 day overdue" (FR-3.3). */
export function deadlineLabel(deadline: LocalDate, ref: LocalDate): string {
  const diff = daysBetween(ref, deadline);
  if (diff === 0) return 'Today';
  if (diff > 0) return `${diff} ${diff === 1 ? 'day' : 'days'} left`;
  const over = -diff;
  return `${over} ${over === 1 ? 'day' : 'days'} overdue`;
}
