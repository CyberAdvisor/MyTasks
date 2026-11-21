/**
 * Local-date helpers.
 *
 * Dates without a time are stored as local `YYYY-MM-DD` strings, so a to-do
 * for "Thursday" stays on Thursday across time zones (design doc, Section 4).
 * Because the format is zero-padded, plain string comparison orders dates.
 */
import type { LocalDate } from './types';


/**
 * Every date and time is shown in US English: month first in numeric dates,
 * English names, a 12-hour clock, whatever the device's region (review C12,
 * Michael's choice). Typed dates are read the same way (typedDate.ts), and
 * the calendar starts on Sunday.
 */
export const LOCALE = 'en-US';

/** Format a Date as a local `YYYY-MM-DD` string. */
export function toLocalDate(d: Date): LocalDate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** The local date of an ISO timestamp, e.g. the day a to-do was completed. */
export function localDay(iso: string): LocalDate {
  return toLocalDate(new Date(iso));
}

/**
 * A moment as "Today at 6:02 AM", "Yesterday at 9:14 PM" or
 * "Nov 10, 2026 at 9:14 AM" (Get Info, Settings › Sync).
 */
export function formatTimestamp(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString(LOCALE, { hour: 'numeric', minute: '2-digit' });
  const days = Math.round(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
      new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) /
      86_400_000,
  );
  if (days === 0) return `Today at ${time}`;
  if (days === 1) return `Yesterday at ${time}`;
  return `${d.toLocaleDateString(LOCALE, { month: 'short', day: 'numeric', year: 'numeric' })} at ${time}`;
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

/** Day of week of a local date: 0 Sunday to 6 Saturday. */
export function weekday(s: LocalDate): number {
  return parseLocalDate(s).getDay();
}

/** "This Weekend" in the When picker: the coming Saturday, or today if it is a weekend day. */
export function thisWeekend(ref: LocalDate): LocalDate {
  const wd = weekday(ref);
  if (wd === 6 || wd === 0) return ref;
  return addDays(ref, 6 - wd);
}

/** "Next Week" in the When picker: the next Monday after today. */
export function nextWeek(ref: LocalDate): LocalDate {
  const wd = weekday(ref);
  return addDays(ref, wd === 0 ? 1 : 8 - wd);
}

/** First day (`YYYY-MM-01`) of the month containing `s`. */
export function monthStart(s: LocalDate): LocalDate {
  return `${s.slice(0, 7)}-01`;
}

/** First day of the month `delta` months from the month containing `s`. */
export function addMonths(s: LocalDate, delta: number): LocalDate {
  const d = parseLocalDate(monthStart(s));
  d.setMonth(d.getMonth() + delta);
  return toLocalDate(d);
}

/**
 * Weeks for a month calendar, Sunday first, as US calendars are (review
 * C12). Each week has seven dates; days outside the month are `null`.
 */
export function monthGrid(month: LocalDate): (LocalDate | null)[][] {
  const first = monthStart(month);
  const lead = weekday(first); // days before the 1st, Sunday first
  const nextMonth = addMonths(first, 1);
  const days: (LocalDate | null)[] = Array(lead).fill(null);
  for (let d = first; d < nextMonth; d = addDays(d, 1)) days.push(d);
  while (days.length % 7) days.push(null);
  const weeks: (LocalDate | null)[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
}

const WEEKDAY = new Intl.DateTimeFormat(LOCALE, { weekday: 'long' });
const SHORT = new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric' });
const MONTH = new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric' });
const WEEKDAY_SHORT = new Intl.DateTimeFormat(LOCALE, { weekday: 'short' });
const MONTH_YEAR_SHORT = new Intl.DateTimeFormat(LOCALE, { month: 'short', year: 'numeric' });
const WEEKDAY_DATE = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', month: 'short', day: 'numeric' });
const NUMERIC = new Intl.DateTimeFormat(LOCALE, { month: 'numeric', day: 'numeric', year: '2-digit' });

/** A date as "Nov 14" (the When picker's deadline note, FR-3.6). */
export function formatShort(s: LocalDate): string {
  return SHORT.format(parseLocalDate(s));
}

/** A date as "11/23/26", as a repeat's next dates are listed (FR-4.1). */
export function formatNumeric(s: LocalDate): string {
  return NUMERIC.format(parseLocalDate(s));
}

/** A date as "Fri, Nov 20" (the deadline picker's warning, FR-3.6). */
export function formatWeekdayDate(s: LocalDate): string {
  return WEEKDAY_DATE.format(parseLocalDate(s));
}

/**
 * Would this When date be later than the deadline (FR-3.6)? Only a date
 * after today counts: an item already in Today stays there whatever its
 * deadline, and a deadline reached sets When to today (FR-3.7).
 */
export function whenAfterDeadline(when: LocalDate | null, deadline: LocalDate | null, ref: LocalDate): boolean {
  return when !== null && deadline !== null && when > ref && when > deadline;
}

/** Human label for a date relative to `ref`: Today, Tomorrow, weekday, or "Nov 12". */
export function formatRelative(s: LocalDate, ref: LocalDate): string {
  const diff = daysBetween(ref, s);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return WEEKDAY.format(parseLocalDate(s));
  return SHORT.format(parseLocalDate(s));
}

/**
 * The grey label before a scheduled task's title, worded by
 * how far off the date is: the weekday for the next 6 days ("Sun"), then
 * month and day for the rest of this year ("Nov 22"), and month and year
 * for another year ("Aug 2027"). Seven days out shows the date, since the
 * weekday would be today's.
 */
export function whenLabel(s: LocalDate, ref: LocalDate): string {
  const diff = daysBetween(ref, s);
  const d = parseLocalDate(s);
  if (diff >= 1 && diff <= 6) return WEEKDAY_SHORT.format(d);
  return s.slice(0, 4) === ref.slice(0, 4) ? SHORT.format(d) : MONTH_YEAR_SHORT.format(d);
}

/** "Month Year" label, as the month calendar's heading shows it. */
export function formatMonth(s: LocalDate): string {
  return MONTH.format(parseLocalDate(s));
}

const MONTH_NAME = new Intl.DateTimeFormat(LOCALE, { month: 'long' });

/** The month's name alone, "December" (Scheduled's month groups, FR-21.6). */
export function formatMonthName(s: LocalDate): string {
  return MONTH_NAME.format(parseLocalDate(s));
}

/** The weekday's name, "Thursday" (Scheduled's days, FR-21.6). */
export function formatWeekday(s: LocalDate): string {
  return WEEKDAY.format(parseLocalDate(s));
}

/** The last day of the month containing `s`. */
export function monthEnd(s: LocalDate): LocalDate {
  return addDays(addMonths(s, 1), -1);
}

/** Deadline wording for rows: "Today", "2 days left", "1 day overdue" (FR-3.3). */
export function deadlineLabel(deadline: LocalDate, ref: LocalDate, short = false): string {
  const diff = daysBetween(ref, deadline);
  if (diff === 0) return 'Today';
  const n = Math.abs(diff);
  // Short, for phone rows (Milestone 11, PR 2): "2d left", "3d overdue".
  const days = short ? `${n}d` : `${n} ${n === 1 ? 'day' : 'days'}`;
  return `${days} ${diff > 0 ? 'left' : 'overdue'}`;
}
