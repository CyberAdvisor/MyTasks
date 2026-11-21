/**
 * Repeating tasks (FR-4.1 to FR-4.4): the dates a repeat rule gives, its
 * wording, and the id of each copy. Pure functions, with no storage access;
 * repo.ts makes the copies.
 *
 * A repeating task is a template (a task whose `repeat` is set); its
 * `startDate` holds the date of its next copy. A fixed schedule steps from
 * one date to the next; after completion counts from the day the last copy
 * was done.
 */
import { addDays, parseLocalDate, toLocalDate, weekday } from './dates';
import type { ID, LocalDate, RepeatDay, RepeatRule, RepeatUnit } from './types';

/** Weekday names, 0 Sunday to 6 Saturday. The app is in English only. */
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Month names, index 0 for January. */
export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Upper bound on steps when searching for a date, so a rule with no dates left can't loop forever. */
const MAX_STEPS = 5000;


/** "1st", "2nd", "23rd", "last". */
export function ordinalLabel(n: number): string {
  if (n === -1) return 'last';
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** Days in month `m` (1–12) of year `y`. */
function monthLength(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

/** `YYYY-MM-DD` for year, month (1–12) and day. */
function ymd(y: number, m: number, d: number): LocalDate {
  return toLocalDate(new Date(y, m - 1, d));
}

/**
 * The date `day` names in month `m` of year `y`, or null when the month has
 * none (a 5th Tuesday in a month with four). A day of the month past the
 * month's end falls on its last day, so "the 31st" is April 30.
 */
function dayInMonth(y: number, m: number, day: RepeatDay): LocalDate | null {
  const length = monthLength(y, m);
  if (day.weekday === null) {
    return ymd(y, m, day.ordinal === -1 ? length : Math.min(day.ordinal, length));
  }
  if (day.ordinal === -1) {
    const last = ymd(y, m, length);
    return addDays(last, -((weekday(last) - day.weekday + 7) % 7));
  }
  const first = ymd(y, m, 1);
  const date = 1 + ((day.weekday - weekday(first) + 7) % 7) + (day.ordinal - 1) * 7;
  return date <= length ? ymd(y, m, date) : null;
}

/** A monthly or yearly rule's dates in month `m` of year `y`, in order, without repeats. */
function datesInMonth(rule: RepeatRule, y: number, m: number): LocalDate[] {
  const dates = rule.days.map((d) => dayInMonth(y, m, d)).filter((d): d is LocalDate => d !== null);
  return [...new Set(dates)].sort();
}

/** Year and month (1–12) `delta` months after those of `date`. */
function monthFrom(date: LocalDate, delta: number): [number, number] {
  const d = parseLocalDate(date);
  const index = d.getFullYear() * 12 + d.getMonth() + delta;
  return [Math.floor(index / 12), (index % 12) + 1];
}

/**
 * The fixed schedule's next date after `date`. Within the same week (weeks
 * start on Sunday) or month, the next listed day comes first; past the last,
 * the rule moves on by its interval, or by one when `date` isn't one of its
 * dates (finding the first date from today). Null if there is none.
 */
export function nextAfter(rule: RepeatRule, date: LocalDate, fromStart = false): LocalDate | null {
  const step = fromStart ? 1 : rule.interval;
  if (rule.unit === 'day') return addDays(date, step);
  if (rule.unit === 'week') {
    const days = [...new Set(rule.weekdays)].sort();
    if (!days.length) return null;
    const wd = weekday(date);
    const later = days.find((d) => d > wd);
    if (later !== undefined) return addDays(date, later - wd);
    return addDays(date, 7 * step - wd + days[0]);
  }
  // Monthly and yearly: the rest of this month, then every interval months (or years).
  const months = rule.unit === 'year' ? 12 : 1;
  const [y, m] = monthFrom(date, 0);
  if (rule.unit === 'month' || m === rule.month) {
    const later = datesInMonth(rule, y, m).find((d) => d > date);
    if (later) return later;
  }
  // A yearly rule starts from its own month: this year's if still ahead, else next year's.
  let ahead = step * months;
  if (rule.unit === 'year') {
    const target = rule.month ?? m;
    ahead = target > m && fromStart ? target - m : target - m + 12 * step;
  }
  for (let i = 0; i < MAX_STEPS / 10; i++) {
    const [ny, nm] = monthFrom(date, ahead);
    const dates = datesInMonth(rule, ny, nm);
    if (dates.length) return dates[0];
    ahead += step * months;
  }
  return null;
}

/** Whether `date` is one of a fixed schedule's dates. */
function isOccurrence(rule: RepeatRule, date: LocalDate): boolean {
  if (rule.unit === 'day') return true;
  if (rule.unit === 'week') return rule.weekdays.includes(weekday(date));
  const [y, m] = monthFrom(date, 0);
  if (rule.unit === 'year' && m !== rule.month) return false;
  return datesInMonth(rule, y, m).includes(date);
}

/** A fixed schedule's first date on or after `ref`, or null. */
export function firstDate(rule: RepeatRule, ref: LocalDate): LocalDate | null {
  return isOccurrence(rule, ref) ? ref : nextAfter(rule, ref, true);
}

/** Up to `n` dates of a fixed schedule from `start` (included), stopping at its end date. */
export function upcoming(rule: RepeatRule, start: LocalDate | null, n: number): LocalDate[] {
  const dates: LocalDate[] = [];
  for (let d = start; d !== null && dates.length < n; d = nextAfter(rule, d)) {
    if (rule.endDate !== null && d > rule.endDate) break;
    dates.push(d);
  }
  return dates;
}

/** `date` plus `n` months, on the same day or the month's last when shorter. */
function addMonthsKeepDay(date: LocalDate, n: number): LocalDate {
  const [y, m] = monthFrom(date, n);
  return ymd(y, m, Math.min(parseLocalDate(date).getDate(), monthLength(y, m)));
}

/** After completion: the next copy's date, counted from the day the last was done. */
export function afterCompletionDate(rule: RepeatRule, doneOn: LocalDate): LocalDate {
  const n = rule.interval;
  if (rule.unit === 'day') return addDays(doneOn, n);
  if (rule.unit === 'week') return addDays(doneOn, 7 * n);
  return addMonthsKeepDay(doneOn, rule.unit === 'year' ? 12 * n : n);
}

/** The day a copy for `date` starts: earlier by the deadline offset, when there is one (FR-4.2). */
export function copyStart(rule: RepeatRule, date: LocalDate): LocalDate {
  return rule.deadlineDays ? addDays(date, -rule.deadlineDays) : date;
}

/** Whether a fixed schedule has ended at `date`, with `made` copies made (FR-4.2). */
function ended(rule: RepeatRule, date: LocalDate, made: number): boolean {
  return (rule.endCount !== null && made >= rule.endCount) || (rule.endDate !== null && date > rule.endDate);
}

/** The copy a template is due to make now, and what follows it. */
interface DueCopy {
  /** The copy's scheduled date (its deadline, when the rule adds one). */
  date: LocalDate;
  /** The template's next date afterwards, or null: waiting for completion, or ended. */
  next: LocalDate | null;
  /** The repeat has ended: the template is finished. */
  finished: boolean;
}

/**
 * The copy a template makes now, if one is due: when the start of its next
 * date has come and the rule isn't paused or ended. If the app wasn't
 * opened for several of a fixed schedule's dates, one copy is made, for the
 * latest (decided 2026-11-16, conversation 2026-11-16-E), so a week away
 * doesn't fill Today. After completion, the template then waits for that
 * copy to be done.
 */
export function dueCopy(rule: RepeatRule, next: LocalDate | null, ref: LocalDate): DueCopy | null {
  if (rule.paused || next === null || copyStart(rule, next) > ref) return null;
  if (rule.mode === 'afterCompletion') return { date: next, next: null, finished: false };
  if (ended(rule, next, rule.made)) return null;
  let date = next;
  let following = nextAfter(rule, date);
  for (let i = 0; following !== null && copyStart(rule, following) <= ref && i < MAX_STEPS; i++) {
    if (ended(rule, following, rule.made)) break;
    date = following;
    following = nextAfter(rule, date);
  }
  const finished = following === null || ended(rule, following, rule.made + 1);
  return { date, next: finished ? null : following, finished };
}

/**
 * After a copy for `date` is made ahead of its time (Create Next Copy,
 * completing early; FR-4.4): the template's next date, or the end of the
 * repeat. After completion, the template waits for that copy to be done.
 */
export function afterCopy(rule: RepeatRule, date: LocalDate): Pick<DueCopy, 'next' | 'finished'> {
  if (rule.mode === 'afterCompletion') return { next: null, finished: false };
  const following = nextAfter(rule, date);
  const finished = following === null || ended(rule, following, rule.made + 1);
  return { next: finished ? null : following, finished };
}

// ---------------------------------------------------------------------------
// Copy ids
// ---------------------------------------------------------------------------

/** FNV-1a, 32 bits, with a seed. */
function fnv(text: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * The id of the copy `templateId` makes for `date` (or of that copy's
 * checklist item, given the template item's id as `templateId`). The same on
 * every device, so two devices that make the same copy at midnight end up
 * with one record when they sync. Shaped like a UUID (version 8).
 */
export function copyId(templateId: ID, date: LocalDate): ID {
  const key = `${templateId}|${date}`;
  const hex = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b]
    .map((seed) => fnv(key, seed).toString(16).padStart(8, '0'))
    .join('');
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

// ---------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------

/** "Monday", "Monday and Wednesday", "Monday, Wednesday and Friday". */
function joinAnd(items: string[]): string {
  return items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/** "the 16th day", "the 2nd Tuesday", "the last day". */
export function dayLabel(day: RepeatDay): string {
  return `the ${ordinalLabel(day.ordinal)} ${day.weekday === null ? 'day' : WEEKDAYS[day.weekday]}`;
}

/** "week", "2 weeks". */
function every(n: number, unit: RepeatUnit): string {
  return n === 1 ? unit : `${n} ${unit}s`;
}

/**
 * The rule in words, as a task's card shows it: "Repeat every
 * week on Monday", "Repeat every month on the 2nd Tuesday", "Repeat 1 week
 * after completion".
 */
export function ruleText(rule: RepeatRule): string {
  if (rule.mode === 'afterCompletion') {
    return `Repeat ${rule.interval} ${rule.interval === 1 ? rule.unit : `${rule.unit}s`} after completion`;
  }
  const base = `Repeat every ${every(rule.interval, rule.unit)}`;
  if (rule.unit === 'week') {
    const days = [...new Set(rule.weekdays)].sort().map((d) => WEEKDAYS[d]);
    return `${base} on ${joinAnd(days)}`;
  }
  if (rule.unit === 'month' || rule.unit === 'year') {
    const on = `${base} on ${joinAnd(rule.days.map(dayLabel))}`;
    return rule.unit === 'year' && rule.month ? `${on} in ${MONTHS[rule.month - 1]}` : on;
  }
  return base;
}
