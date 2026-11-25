/**
 * Todoist's dates (FR-12.13): the DATE and DEADLINE text of a Todoist
 * export, in English, read into a date or into Import's repeat columns
 * (FR-12.9). Todoist writes dates as words ("Nov 26", "every friday at
 * 4pm"), so only the common English forms are understood; anything else
 * gives null, and the task comes in without it (its text kept in the notes).
 *
 * Understood, with today as `ref`:
 *
 * - a date: "Nov 26" (the year nearest today, so an overdue date stays in
 *   this year), "Nov 26 2027", "26 Nov", "2026-11-26", and the typed dates
 *   of FR-3.2 ("today", "tomorrow", "fri"…)
 * - a repeat: "every day" / "daily", "every 3 days", "every other week",
 *   "weekly", "monthly", "yearly"; "every weekday"; "every fri", "every mon,
 *   wed and fri"; "every 1st", "every 15th", "every last day", "every 2nd
 *   tue"; "every jan 15"; "every!" for a repeat counted from completion
 *   ("every! 3 days"); with "starting …" and "ending …" / "until …"
 *
 * A time of day ("at 4pm", "16:00") is dropped: tasks have no times.
 */
import { parseTypedDate } from '../model/typedDate';
import { toLocalDate } from '../model/dates';
import type { LocalDate } from '../model/types';

/** Import's repeat columns (rows.ts), as text, for a repeating task. */
export interface RepeatColumns {
  repeat: 'regularly' | 'after_completion';
  repeat_every: string;
  repeat_unit: 'day' | 'week' | 'month' | 'year';
  repeat_weekdays: string;
  repeat_month_day: string;
  repeat_month: string;
  repeat_first: string;
  repeat_ends_on: string;
}

/** What a DATE cell holds: one date, or a repeat. */
export type TodoistDate = { date: LocalDate } | { repeat: RepeatColumns };

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const UNITS: Record<string, RepeatColumns['repeat_unit']> = { day: 'day', week: 'week', month: 'month', year: 'year' };
const SHORTHAND: Record<string, RepeatColumns['repeat_unit']> = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year', annually: 'year' };
const ORDINAL_WORDS: Record<string, string> = { first: '1st', second: '2nd', third: '3rd', fourth: '4th', fifth: '5th', last: 'last' };

/** The day index of a day name ("fri", "friday", "thurs"), or -1. */
function dayIndex(word: string): number {
  return word.length >= 3 ? DAYS.indexOf(word.slice(0, 3)) : -1;
}

/** The month index (0–11) of a month name ("nov", "november"), or -1. */
function monthIndex(word: string): number {
  return word.length >= 3 ? MONTHS.indexOf(word.slice(0, 3)) : -1;
}

/** A real date, or null ("feb 30"). */
function makeDate(y: number, m: number, d: number): LocalDate | null {
  const t = new Date(y, m - 1, d);
  return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d ? toLocalDate(t) : null;
}

/** The days between two dates, ignoring which comes first. */
function daysApart(a: LocalDate, b: LocalDate): number {
  return Math.abs(new Date(`${a}T12:00`).getTime() - new Date(`${b}T12:00`).getTime()) / 86_400_000;
}

/** Month and day with no year: the one nearest `ref`, last year, this year or next. */
function nearest(m: number, d: number, ref: LocalDate): LocalDate | null {
  const y = Number(ref.slice(0, 4));
  const dates = [y - 1, y, y + 1].map((yy) => makeDate(yy, m, d)).filter((x): x is LocalDate => x !== null);
  if (!dates.length) return null;
  return dates.reduce((best, x) => (daysApart(x, ref) < daysApart(best, ref) ? x : best));
}

/** Drop a time of day: "at 4pm", "4:30 pm", "at 16:00", "16:00". */
function withoutTime(s: string): string {
  return s
    .replace(/\b(at\s+)?\d{1,2}(:\d{2})?\s*(am|pm)\b/g, ' ')
    .replace(/\b(at\s+)?\d{1,2}:\d{2}\b/g, ' ')
    .replace(/\bat\s+(noon|midnight)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Lower case, single spaces, no time of day, no stray punctuation at the ends. */
function clean(text: string): string {
  return withoutTime(text.toLowerCase().replace(/\s+/g, ' ').trim()).replace(/^[,.\s]+|[,.\s]+$/g, '');
}

/** One date: "Nov 26", "26 Nov 2027", "2026-11-26T…", or a typed date (FR-3.2). */
export function readTodoistDay(text: string, ref: LocalDate): LocalDate | null {
  const s = clean(text).replace(/,/g, ' ').replace(/\s+/g, ' ');
  if (!s) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return makeDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  // Month and day either way round, with an optional year.
  const md = /^([a-z]+)\.? (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?$/.exec(s);
  const dm = /^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)\.?(?: (\d{4}))?$/.exec(s);
  const parts = md ? { month: md[1], day: md[2], year: md[3] } : dm ? { month: dm[2], day: dm[1], year: dm[3] } : null;
  if (parts) {
    const m = monthIndex(parts.month);
    if (m < 0) return null;
    return parts.year ? makeDate(Number(parts.year), m + 1, Number(parts.day)) : nearest(m + 1, Number(parts.day), ref);
  }
  return parseTypedDate(s, ref);
}

/** "1st" → "1", "last" → "last", "2nd tue" stays; null if not a day of the month. */
function monthDay(words: string[]): string | null {
  const [first, second] = words;
  const ordinal = ORDINAL_WORDS[first] ?? first;
  if (words.length === 1) {
    const n = /^(\d{1,2})(st|nd|rd|th)?$/.exec(ordinal);
    if (n && Number(n[1]) >= 1 && Number(n[1]) <= 31) return String(Number(n[1]));
    return ordinal === 'last' ? 'last' : null;
  }
  if (words.length === 2 && second === 'day' && ordinal === 'last') return 'last';
  if (words.length === 2 && /^([1-5](st|nd|rd|th)|last)$/.test(ordinal) && dayIndex(second) >= 0) return `${ordinal} ${DAYS[dayIndex(second)]}`;
  return null;
}

/** The part of a repeat after "every" (or the shorthand word); null if not understood. */
function readRule(body: string, afterCompletion: boolean): Omit<RepeatColumns, 'repeat_first' | 'repeat_ends_on'> | null {
  const base = {
    repeat: afterCompletion ? ('after_completion' as const) : ('regularly' as const),
    repeat_every: '1',
    repeat_weekdays: '',
    repeat_month_day: '',
    repeat_month: '',
  };
  const words = body.split(' ').filter(Boolean);
  if (!words.length) return null;

  // "day", "3 days", "other week"
  const count = words[0] === 'other' ? 2 : /^\d+$/.test(words[0]) ? Number(words[0]) : 1;
  const unitWord = (count === 1 && words[0] !== '1' ? words : words.slice(1)).join(' ').replace(/s$/, '');
  if (UNITS[unitWord] && count >= 1) return { ...base, repeat_every: String(count), repeat_unit: UNITS[unitWord] };

  // Rules on set days don't count from completion.
  if (afterCompletion) return null;

  // "weekday" / "workday", "weekend"
  if (body === 'weekday' || body === 'workday') return { ...base, repeat_unit: 'week', repeat_weekdays: 'mon;tue;wed;thu;fri' };
  if (body === 'weekend') return { ...base, repeat_unit: 'week', repeat_weekdays: 'sat;sun' };

  // "fri", "mon, wed and fri", "other friday"
  const dayWords = body.replace(/^other /, '').split(/\s*,\s*|\s+and\s+|\s+/).filter(Boolean);
  if (dayWords.every((w) => dayIndex(w) >= 0)) {
    const days = [...new Set(dayWords.map((w) => DAYS[dayIndex(w)]))];
    return { ...base, repeat_every: body.startsWith('other ') ? '2' : '1', repeat_unit: 'week', repeat_weekdays: days.join(';') };
  }

  // "1st", "15", "last day", "2nd tue"
  const day = monthDay(words);
  if (day) return { ...base, repeat_unit: 'month', repeat_month_day: day };

  // "jan 15", "15 jan"
  if (words.length === 2) {
    const [a, b] = words;
    const m = monthIndex(a) >= 0 ? monthIndex(a) : monthIndex(b);
    const d = monthDay([monthIndex(a) >= 0 ? b : a]);
    if (m >= 0 && d && /^\d+$/.test(d)) return { ...base, repeat_unit: 'year', repeat_month: MONTHS[m], repeat_month_day: d };
  }
  return null;
}

/** A repeat, or null when the text isn't one Import understands. */
function readRepeat(s: string, ref: LocalDate): RepeatColumns | null {
  let rest = s;
  let ends = '';
  let first = '';
  const until = /\s(?:ending|until|end)\s(.+)$/.exec(rest);
  if (until) {
    const d = readTodoistDay(until[1], ref);
    if (!d) return null;
    ends = d;
    rest = rest.slice(0, until.index);
  }
  const starting = /\s(?:starting|from|starts)\s(.+)$/.exec(rest);
  if (starting) {
    const d = readTodoistDay(starting[1], ref);
    if (!d) return null;
    // A start already past means the next date from today, as in the app.
    first = d > ref ? d : '';
    rest = rest.slice(0, starting.index);
  }

  let afterCompletion = false;
  let body: string;
  const every = /^every\s*(!?)\s*(.*)$/.exec(rest);
  if (every) {
    afterCompletion = every[1] === '!';
    body = every[2];
  } else if (SHORTHAND[rest]) {
    body = SHORTHAND[rest];
  } else {
    return null;
  }
  const rule = readRule(body.replace(/^(a|an|1)\s/, '1 ').trim(), afterCompletion);
  if (!rule) return null;
  if (afterCompletion && ends) return null;
  return { ...rule, repeat_first: first, repeat_ends_on: ends };
}

/** A DATE cell: a repeat, a date, or null when it can't be read. */
export function readTodoistDate(text: string, ref: LocalDate): TodoistDate | null {
  const s = clean(text);
  if (!s) return null;
  if (/^(every|daily|weekly|monthly|yearly|annually)\b/.test(s)) {
    const repeat = readRepeat(s, ref);
    return repeat ? { repeat } : null;
  }
  const date = readTodoistDay(s, ref);
  return date ? { date } : null;
}
