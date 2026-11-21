/**
 * Typed dates (FR-3.2): turns what the user types in the Start Date or
 * Deadline picker into a local date. English only, ignoring capitals,
 * commas and extra spaces. Understood, with today as `ref`:
 *
 * - "today" / "tod", "tomorrow" / "tom" / "tmr"
 * - a weekday, full or from its first three letters ("fri", "thurs"): the
 *   next one after today; "this fri" is the same; "next fri" is Friday of
 *   next week, with weeks starting on Sunday as in the calendar (review C12;
 *   Monday until 1.3.12)
 * - "weekend" / "this weekend", "next week" (Monday), "next month" (the 1st)
 * - "in 3 days", "in a week", "2 weeks", "in 1 month", "in 1 year"
 *   (a month from Jan 31 is the last day of February)
 * - a month and day, either way round ("jan 12", "12 january", "jan 12th"),
 *   with an optional year ("jan 12 2027"); without one, a date already
 *   past this year means next year
 * - month/day ("1/12", "1/12/2027", "1/12/27") and "2027-01-12"
 *
 * Anything else, or a date that doesn't exist ("feb 30"), gives null.
 */
import { addDays, nextWeek, thisWeekend, toLocalDate, weekday } from './dates';
import type { LocalDate } from './types';

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

/** Index of the name `word` starts (at least three letters), or -1. */
function nameIndex(names: string[], word: string): number {
  if (word.length < 3) return -1;
  return names.findIndex((n) => n.startsWith(word));
}

/** A real date from year, month (1–12) and day, or null ("feb 30"). */
function makeDate(y: number, m: number, d: number): LocalDate | null {
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return toLocalDate(date);
}

/** A two-digit year means this century. */
const fullYear = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));

/** Month and day with no year: this year, or next year if already past. */
function nextOccurrence(m: number, d: number, ref: LocalDate): LocalDate | null {
  const y = Number(ref.slice(0, 4));
  const date = makeDate(y, m, d);
  return date !== null && date >= ref ? date : makeDate(y + 1, m, d);
}

/** Months later, keeping the day or using the month's last day. */
function addMonthsKeepDay(ref: LocalDate, months: number): LocalDate {
  const [y, m, d] = ref.split('-').map(Number);
  const target = new Date(y, m - 1 + months, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d, last));
  return toLocalDate(target);
}

/** The weekday `wd` (0 Sunday) after today, or in next week with `next`. */
function weekdayDate(wd: number, next: boolean, ref: LocalDate): LocalDate {
  const today = weekday(ref);
  if (!next) return addDays(ref, ((wd - today + 6) % 7) + 1);
  const sundayNextWeek = addDays(ref, 7 - today);
  return addDays(sundayNextWeek, wd);
}

/** "in 3 days", "a week", "2 weeks": an amount of time from today. */
function relative(words: string[], ref: LocalDate): LocalDate | null {
  if (words[0] === 'in') words = words.slice(1);
  if (words.length !== 2) return null;
  const n = words[0] === 'a' || words[0] === 'an' ? 1 : /^\d{1,3}$/.test(words[0]) ? Number(words[0]) : NaN;
  if (Number.isNaN(n)) return null;
  const unit = words[1].replace(/s$/, '');
  if (unit === 'day' || unit === 'd') return addDays(ref, n);
  if (unit === 'week' || unit === 'wk' || unit === 'w') return addDays(ref, 7 * n);
  if (unit === 'month' || unit === 'mo') return addMonthsKeepDay(ref, n);
  if (unit === 'year' || unit === 'yr' || unit === 'y') return addMonthsKeepDay(ref, 12 * n);
  return null;
}

/** "jan 12", "12 jan", "jan 12th 2027". */
function monthDay(words: string[], ref: LocalDate): LocalDate | null {
  if (words.length < 2 || words.length > 3) return null;
  const day = (w: string) => (/^\d{1,2}(st|nd|rd|th)?$/.test(w) ? parseInt(w, 10) : NaN);
  let m = nameIndex(MONTHS, words[0]);
  let d = day(words[1]);
  if (m < 0) {
    m = nameIndex(MONTHS, words[1]);
    d = day(words[0]);
  }
  if (m < 0 || Number.isNaN(d)) return null;
  if (words.length === 3) return /^\d{4}$/.test(words[2]) ? makeDate(Number(words[2]), m + 1, d) : null;
  return nextOccurrence(m + 1, d, ref);
}

/** "1/12", "1/12/2027", "1/12/27" (month first) and "2027-01-12". */
function numeric(text: string, ref: LocalDate): LocalDate | null {
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (iso) return makeDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const us = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(text);
  if (!us) return null;
  const [m, d] = [Number(us[1]), Number(us[2])];
  return us[3] ? makeDate(fullYear(us[3]), m, d) : nextOccurrence(m, d, ref);
}

/** The date typed in a picker (FR-3.2), or null if it isn't one. */
export function parseTypedDate(input: string, ref: LocalDate): LocalDate | null {
  const text = input.toLowerCase().replace(/[,.]/g, ' ').trim().replace(/\s+/g, ' ');
  if (!text) return null;

  switch (text) {
    case 'today':
    case 'tod':
      return ref;
    case 'tomorrow':
    case 'tom':
    case 'tmr':
    case 'tmrw':
      return addDays(ref, 1);
    case 'weekend':
    case 'this weekend':
      return thisWeekend(ref);
    case 'next week':
      return nextWeek(ref);
    case 'next month':
      return addMonthsKeepDay(`${ref.slice(0, 7)}-01`, 1);
  }

  const words = text.split(' ');
  const last = words[words.length - 1];
  const wd = nameIndex(WEEKDAYS, last);
  if (wd >= 0 && words.length <= 2) {
    if (words.length === 1 || words[0] === 'this') return weekdayDate(wd, false, ref);
    if (words[0] === 'next') return weekdayDate(wd, true, ref);
    return null;
  }

  return relative(words, ref) ?? monthDay(words, ref) ?? numeric(text, ref);
}
