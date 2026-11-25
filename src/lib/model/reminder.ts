/**
 * A task's reminder (FR-3.8), as stored in `Todo.reminder`:
 *
 * - on an ordinary task or a repeat's copy, a local date and time,
 *   "2026-11-26T09:00" (`ReminderAt`), so 9 AM stays 9 AM across time zones,
 *   like the start date;
 * - on a repeating task's template, a time only, "10:00" (`ReminderTime`):
 *   each copy reminds at that time on its own day (`copyReminder`).
 *
 * The app only stores it. The calendar helper on the Mac turns it into a
 * reminder in Apple Reminders, which rings on the user's devices.
 *
 * Typed reminders (`parseTypedReminder`) take a typed date (FR-3.2) with an
 * optional time: "tomorrow 9am", "fri 2:30pm", "jan 12 14:00", "9pm" (today),
 * and "in 2 hours" / "in 30 minutes". A date with no time takes 9:00 AM.
 */
import { formatWeekdayDate, toLocalDate, addDays } from './dates';
import { parseTypedDate } from './typedDate';
import type { LocalDate } from './types';

/** "HH:MM", 24-hour. */
export type ReminderTime = string;
/** "YYYY-MM-DDTHH:MM", local. */
export type ReminderAt = string;

/** The time a date takes when none is given, and the presets' morning time. */
export const DEFAULT_TIME: ReminderTime = '09:00';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const AT_RE = /^(\d{4}-\d{2}-\d{2})T(([01]\d|2[0-3]):[0-5]\d)$/;

/** Whether `s` is a time only ("10:00"), as on a repeating task's template. */
export function isReminderTime(s: unknown): s is ReminderTime {
  return typeof s === 'string' && TIME_RE.test(s);
}

/** Whether `s` is a date and time ("2026-11-26T09:00") on a real date. */
export function isReminderAt(s: unknown): s is ReminderAt {
  if (typeof s !== 'string') return false;
  const m = AT_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = m[1].split('-').map(Number);
  const date = new Date(y, mo - 1, d);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d;
}

/** A reminder at `time` on `date`. */
export function reminderAt(date: LocalDate, time: ReminderTime): ReminderAt {
  return `${date}T${time}`;
}

/** The date of a dated reminder, or null for a time only. */
export function reminderDate(r: string): LocalDate | null {
  return isReminderAt(r) ? r.slice(0, 10) : null;
}

/** The time of either kind of reminder. */
export function reminderTime(r: string): ReminderTime {
  return isReminderAt(r) ? r.slice(11) : r;
}

/** A template's reminder: the time only of `r` (FR-3.8), or null without one. */
export function templateReminder(r: string | null): ReminderTime | null {
  return r ? reminderTime(r) : null;
}

/** The reminder a repeat's copy dated `date` gets from its template's reminder: that time on that day. */
export function copyReminderOf(r: string | null, date: LocalDate | null): ReminderAt | null {
  return r && date ? reminderAt(date, reminderTime(r)) : null;
}

/** "9:00 AM", "2:30 PM". */
export function formatTime(t: ReminderTime): string {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/**
 * The reminder as shown on the card's chip and in the picker: "Today, 2:00 PM",
 * "Tomorrow, 9:00 AM", "Thu, Nov 26, 9:00 AM", or for a template "10:00 AM on
 * each copy's day".
 */
export function reminderLabel(r: string, ref: LocalDate): string {
  const date = reminderDate(r);
  const time = formatTime(reminderTime(r));
  if (!date) return `${time} on each copy's day`;
  if (date === ref) return `Today, ${time}`;
  if (date === addDays(ref, 1)) return `Tomorrow, ${time}`;
  return `${formatWeekdayDate(date)}, ${time}`;
}

/** The time in `now`, rounded up to the next whole hour plus `hours` (Later Today), or null past 11 PM. */
function laterToday(now: Date, hours: number): ReminderAt | null {
  const t = new Date(now);
  t.setMinutes(0, 0, 0);
  t.setHours(t.getHours() + hours + (now.getMinutes() > 0 || now.getSeconds() > 0 ? 1 : 0));
  if (toLocalDate(t) !== toLocalDate(now)) return null;
  return reminderAt(toLocalDate(t), hhmm(t));
}

function hhmm(d: Date): ReminderTime {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export interface ReminderPreset {
  label: string;
  value: ReminderAt;
}

/**
 * The picker's presets: Later Today (about three hours on, on the hour, while
 * that's still today), Tomorrow at 9 AM, and On the start date at 9 AM when the
 * task has a start date of today or later.
 */
export function reminderPresets(now: Date, startDate: LocalDate | null): ReminderPreset[] {
  const today = toLocalDate(now);
  const out: ReminderPreset[] = [];
  const later = laterToday(now, 2);
  if (later) out.push({ label: 'Later Today', value: later });
  out.push({ label: 'Tomorrow', value: reminderAt(addDays(today, 1), DEFAULT_TIME) });
  if (startDate && startDate >= today) out.push({ label: 'On the start date', value: reminderAt(startDate, DEFAULT_TIME) });
  return out;
}

/** A typed time: "9", "9am", "9:30", "9.30pm", "14:00", "noon", "midnight"; null if not one. */
export function parseTime(input: string): ReminderTime | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, '');
  if (s === 'noon') return '12:00';
  if (s === 'midnight') return '00:00';
  const m = /^(\d{1,2})(?:[:.](\d{2}))?(am|pm|a|p)?$/.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] === undefined ? 0 : Number(m[2]);
  if (min > 59) return null;
  const half = m[3]?.[0];
  if (half) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (half === 'p' ? 12 : 0);
  } else if (h > 23 || (m[2] === undefined && m[1].length > 2)) {
    return null;
  }
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/**
 * What the user typed in the Reminder picker, as a dated reminder, or null.
 * Tries "in N hours/minutes", then a date with an optional time at its end
 * ("tomorrow 9am", "jan 12 at 2pm"), then a time alone (today).
 */
export function parseTypedReminder(input: string, now: Date): ReminderAt | null {
  const s = input.trim().toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ');
  if (!s) return null;
  const today = toLocalDate(now);
  const rel = /^(?:in )?(an?|\d+) (hours?|hrs?|minutes?|mins?)$/.exec(s);
  if (rel) {
    const n = rel[1].startsWith('a') ? 1 : Number(rel[1]);
    const t = new Date(now.getTime() + n * (rel[2].startsWith('h') ? 3_600_000 : 60_000));
    t.setSeconds(0, 0);
    return reminderAt(toLocalDate(t), hhmm(t));
  }
  const words = s.split(' ');
  // A time alone means today.
  if (words.length === 1 || (words.length === 2 && /^(am|pm)$/.test(words[1]))) {
    const time = parseTime(words.join(''));
    if (time) return reminderAt(today, time);
  }
  // A date, then optionally "at" and a time (the time's "pm" may be its own word).
  for (const take of [2, 1]) {
    if (words.length <= take) continue;
    const timeWords = words.slice(-take);
    const time = parseTime(timeWords.join(''));
    if (!time) continue;
    let rest = words.slice(0, -take);
    if (rest[rest.length - 1] === 'at') rest = rest.slice(0, -1);
    const date = parseTypedDate(rest.join(' '), today);
    if (date) return reminderAt(date, time);
  }
  const date = parseTypedDate(s, today);
  return date ? reminderAt(date, DEFAULT_TIME) : null;
}
