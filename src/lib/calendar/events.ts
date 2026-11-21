/**
 * Calendar events (FR-21.2 to FR-21.4, Milestone 13): what the Mac's
 * calendar helper (helper/calendar_sync.py) writes to calendar.json, checked,
 * and the rules for showing it. Pure: no storage, no clock of its own.
 *
 * Inside the encrypted envelope, calendar.json holds
 *
 *     {"format": 1, "from": "YYYY-MM-DD", "to": "YYYY-MM-DD",
 *      "calendars": [{"id", "title", "color"}],
 *      "events": [{"id", "calendar", "title", "allDay", "start", "end", ...}]}
 *
 * Timed events' start and end are UTC timestamps; all-day events' are local
 * dates, the last day included. Optional fields are left out when empty.
 * Events are only shown: nothing here ever changes a calendar.
 */
import { LOCALE, addDays, parseLocalDate, toLocalDate } from '../model/dates';
import type { LocalDate } from '../model/types';

/** One calendar the helper reads. */
export interface CalendarInfo {
  id: string;
  title: string;
  /** `#rrggbb`; anything else from the file becomes NO_COLOR. */
  color: string;
}

/** An attendee's answer, as the helper writes it (EventKit's participant status). */
export type AttendeeStatus = 'accepted' | 'declined' | 'tentative' | 'other';

export interface Attendee {
  name: string;
  status: AttendeeStatus;
}

/** An alert: minutes before the start (negative is after), or a fixed moment. */
export type Alert = { before: number } | { at: string };

export type Availability = 'busy' | 'free' | 'tentative' | 'unavailable';

export interface CalendarEvent {
  /** EventKit's id; the same for every occurrence of a repeating event. */
  id: string;
  /** The calendar's id (CalendarInfo.id). */
  calendar: string;
  title: string;
  allDay: boolean;
  /** Timed: a UTC timestamp. All-day: a local date. */
  start: string;
  /** Timed: a UTC timestamp. All-day: the last local date, included. */
  end: string;
  location?: string;
  notes?: string;
  url?: string;
  attendees?: Attendee[];
  organizer?: string;
  /** A line such as "Every 2 weeks on Tue, Thu". */
  repeat?: string;
  alerts?: Alert[];
  availability?: Availability;
  travelMinutes?: number;
}

/** calendar.json's contents, checked. */
export interface CalendarData {
  /** The first and last day the helper read. */
  from: LocalDate;
  to: LocalDate;
  calendars: CalendarInfo[];
  events: CalendarEvent[];
}

/** The colour used when a calendar's colour is missing or not `#rrggbb`. */
export const NO_COLOR = '#8e8e93';

// ---------------------------------------------------------------------------
// Checking the file. The file comes from the user's own Mac, but it is still
// checked: a wrong field must never break a view, and colours and links go
// into the page, so only `#rrggbb` colours and http(s) links are kept.
// Identical alerts are kept once.

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';
const isDate = (v: unknown): v is LocalDate => isString(v) && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isTimestamp = (v: unknown): v is string => isString(v) && !Number.isNaN(Date.parse(v));
const STATUSES = new Set(['accepted', 'declined', 'tentative']);
const AVAILABILITIES = new Set<string>(['busy', 'free', 'tentative', 'unavailable']);

/** A non-empty string field, or undefined. */
const text = (v: unknown) => (isString(v) && v.trim() ? v : undefined);

function cleanAttendees(v: unknown): Attendee[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const list = v
    .filter((a) => isObject(a) && text(a.name))
    .map((a) => ({ name: a.name as string, status: (STATUSES.has(a.status as string) ? a.status : 'other') as AttendeeStatus }));
  return list.length ? list : undefined;
}

/** The alerts, each once: an event can carry two identical ones. */
function cleanAlerts(v: unknown): Alert[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const list: Alert[] = [];
  const seen = new Set<string>();
  for (const a of v) {
    const alert: Alert | null =
      isObject(a) && typeof a.before === 'number' && Number.isFinite(a.before)
        ? { before: a.before }
        : isObject(a) && isTimestamp(a.at)
          ? { at: a.at }
          : null;
    if (!alert || seen.has(JSON.stringify(alert))) continue;
    seen.add(JSON.stringify(alert));
    list.push(alert);
  }
  return list.length ? list : undefined;
}

/** One event, or null when a field every event needs is missing or wrong. Wrong optional fields are dropped. */
function cleanEvent(e: unknown): CalendarEvent | null {
  if (!isObject(e) || !isString(e.id) || !isString(e.calendar) || !isString(e.title) || typeof e.allDay !== 'boolean') return null;
  const valid = e.allDay ? isDate(e.start) && isDate(e.end) : isTimestamp(e.start) && isTimestamp(e.end);
  if (!valid || (e.end as string) < (e.start as string)) return null;
  const event: CalendarEvent = {
    id: e.id,
    calendar: e.calendar,
    title: e.title,
    allDay: e.allDay,
    start: e.start as string,
    end: e.end as string,
  };
  const optional: Partial<CalendarEvent> = {
    location: text(e.location),
    notes: text(e.notes),
    // Only a web link: others (a Mail message:, say) mean nothing outside the Mac.
    url: safeLink(text(e.url)) ?? undefined,
    attendees: cleanAttendees(e.attendees),
    organizer: text(e.organizer),
    repeat: text(e.repeat),
    alerts: cleanAlerts(e.alerts),
    availability: AVAILABILITIES.has(e.availability as string) ? (e.availability as Availability) : undefined,
    travelMinutes: typeof e.travelMinutes === 'number' && e.travelMinutes > 0 ? Math.round(e.travelMinutes) : undefined,
  };
  for (const [k, v] of Object.entries(optional)) if (v !== undefined) (event as unknown as Record<string, unknown>)[k] = v;
  return event;
}

/**
 * Check decrypted calendar.json contents. Null when it isn't format 1 or
 * its outline is wrong; a single bad event is left out, not the file.
 */
export function readCalendar(x: unknown): CalendarData | null {
  if (!isObject(x) || x.format !== 1 || !isDate(x.from) || !isDate(x.to)) return null;
  if (!Array.isArray(x.calendars) || !Array.isArray(x.events)) return null;
  const calendars = x.calendars
    .filter((c) => isObject(c) && isString(c.id) && isString(c.title))
    .map((c) => ({
      id: c.id as string,
      title: c.title as string,
      color: isString(c.color) && /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : NO_COLOR,
    }));
  const events = x.events.map(cleanEvent).filter((e): e is CalendarEvent => e !== null);
  return { from: x.from, to: x.to, calendars, events };
}

// ---------------------------------------------------------------------------
// Which day an event is on.

/** The first moment of a local date, in milliseconds. */
const dayStart = (d: LocalDate) => parseLocalDate(d).getTime();

/**
 * Whether an event is on a local day. It is on every day it covers: each
 * day of an all-day event, and each day a timed event overlaps, so one
 * that runs past midnight is on both days. An event of no length counts on
 * the day it starts.
 */
export function isOnDay(e: CalendarEvent, day: LocalDate): boolean {
  if (e.allDay) return e.start <= day && day <= e.end;
  const from = dayStart(day);
  const to = dayStart(addDays(day, 1));
  const start = Date.parse(e.start);
  const end = Date.parse(e.end);
  return start < to && (end > from || (end === start && start >= from));
}

/** A day's events: all-day first, then by start time, then by title. */
export function eventsOn(data: CalendarData, day: LocalDate): CalendarEvent[] {
  return data.events
    .filter((e) => isOnDay(e, day))
    .sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      const byStart = a.allDay ? 0 : Date.parse(a.start) - Date.parse(b.start);
      return byStart || a.title.localeCompare(b.title, LOCALE);
    });
}

/** The first moment after a local date, in milliseconds. */
const dayAfter = (d: LocalDate) => dayStart(addDays(d, 1));

/** Whether an event is on any day from `from` to `to`, both included. */
function isInPeriod(e: CalendarEvent, from: LocalDate, to: LocalDate): boolean {
  if (e.allDay) return e.start <= to && e.end >= from;
  const start = Date.parse(e.start);
  const end = Date.parse(e.end);
  return start < dayAfter(to) && (end > dayStart(from) || (end === start && start >= dayStart(from)));
}

/** One line in Scheduled's later groups (FR-21.6): an event on its first day there, and how many times it occurs. */
export interface PeriodLine {
  event: CalendarEvent;
  /** The first day the event is on within the group. */
  day: LocalDate;
  /** Occurrences of a repeating event in the group; 1 otherwise. */
  count: number;
}

/**
 * The lines for one of Scheduled's later groups: each
 * event once, on its first day in the group (an event over several days too),
 * and a repeating event once, on its first occurrence there, with its count.
 * By day, then all-day first, then by start time, then by title.
 */
export function periodLines(data: CalendarData, from: LocalDate, to: LocalDate): PeriodLine[] {
  const firstDay = (e: CalendarEvent) => {
    const start = e.allDay ? e.start : toLocalDate(new Date(e.start));
    return start > from ? start : from;
  };
  const byId = new Map<string, PeriodLine>();
  for (const e of data.events) {
    if (!isInPeriod(e, from, to)) continue;
    const day = firstDay(e);
    const seen = byId.get(e.id);
    if (!seen) byId.set(e.id, { event: e, day, count: 1 });
    else {
      seen.count++;
      if (day < seen.day) Object.assign(seen, { event: e, day });
    }
  }
  return [...byId.values()].sort((a, b) => {
    if (a.day !== b.day) return a.day < b.day ? -1 : 1;
    if (a.event.allDay !== b.event.allDay) return a.event.allDay ? -1 : 1;
    const byStart = a.event.allDay ? 0 : Date.parse(a.event.start) - Date.parse(b.event.start);
    return byStart || a.event.title.localeCompare(b.event.title, LOCALE);
  });
}

/** Whether a group of Scheduled from `from` to `to` has any event. */
export const hasEventsIn = (data: CalendarData, from: LocalDate, to: LocalDate) =>
  data.events.some((e) => isInPeriod(e, from, to));

/**
 * A title as one line in a list: its first line with text (a flight's title
 * can start with a line break).
 */
export function firstLine(title: string): string {
  return title.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? '';
}

/** Ended (shown dimmed): a timed event whose end has passed, or an all-day one whose last day has. */
export function isEnded(e: CalendarEvent, now: Date): boolean {
  return e.allDay ? e.end < toLocalDate(now) : Date.parse(e.end) <= now.getTime();
}

/** The calendar an event belongs to, or a grey one with no name if it isn't listed. */
export function calendarOf(data: CalendarData, e: CalendarEvent): CalendarInfo {
  return data.calendars.find((c) => c.id === e.calendar) ?? { id: e.calendar, title: '', color: NO_COLOR };
}

/** A unique key for one occurrence: a repeating event's occurrences share an id. */
export const occurrenceKey = (e: CalendarEvent) => `${e.id}|${e.start}`;

// ---------------------------------------------------------------------------
// Wording, in US English like every date in the app (dates.ts, LOCALE).

const TIME = new Intl.DateTimeFormat(LOCALE, { hour: 'numeric', minute: '2-digit' });
const LONG_DATE = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
const SHORT_DATE = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', month: 'short', day: 'numeric' });
const MOMENT = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/**
 * Intl puts narrow or thin spaces in times and ranges ("3:30\u202fPM"), and
 * not the same ones in every browser: use plain spaces, as the rest of the app shows.
 */
const plain = (s: string) => s.replace(/[\u202f\u2009]/g, ' ');

/** A time as "8:30 AM". */
export const formatTime = (iso: string) => plain(TIME.format(new Date(iso)));

/**
 * What a line in the list shows before the title: null for an all-day
 * event (a bar instead), the start time on the day it starts, and "Ends
 * 2:00 AM" on a later day it runs into.
 */
export function listTime(e: CalendarEvent, day: LocalDate): string | null {
  if (e.allDay) return null;
  return toLocalDate(new Date(e.start)) === day ? formatTime(e.start) : `Ends ${formatTime(e.end)}`;
}

/** The details panel's date line: "Thursday, Nov 19, 2026", or a span for an event over several days. */
export function dateLine(e: CalendarEvent): string {
  if (e.allDay) {
    if (e.start === e.end) return LONG_DATE.format(parseLocalDate(e.start));
    return `${SHORT_DATE.format(parseLocalDate(e.start))} – ${SHORT_DATE.format(parseLocalDate(e.end))}`;
  }
  const start = new Date(e.start);
  const end = new Date(e.end);
  if (toLocalDate(start) === toLocalDate(end)) return LONG_DATE.format(start);
  return plain(`${MOMENT.format(start)} – ${MOMENT.format(end)}`);
}

/** The details panel's time line: "All day", "2:00 – 3:30 PM", or null when the date line already has the times. */
export function timeLine(e: CalendarEvent): string | null {
  if (e.allDay) return 'All day';
  const start = new Date(e.start);
  const end = new Date(e.end);
  if (toLocalDate(start) !== toLocalDate(end)) return null;
  return plain(start.getTime() === end.getTime() ? TIME.format(start) : TIME.formatRange(start, end));
}

/** "1 hour 30 minutes", "1 day", "15 minutes". */
function duration(minutes: number): string {
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  if (minutes % 1440 === 0) return unit(minutes / 1440, 'day');
  if (minutes % 60 === 0) return unit(minutes / 60, 'hour');
  if (minutes > 60) return `${unit(Math.floor(minutes / 60), 'hour')} ${unit(minutes % 60, 'minute')}`;
  return unit(minutes, 'minute');
}

/**
 * An alert in words. Timed events: "15 minutes before", "At time of event".
 * All-day events, whose alerts are times on or before the day: "On the day
 * at 9:00 AM", "1 day before at 9:00 AM". A fixed alert: its moment.
 */
export function alertLine(a: Alert, e: CalendarEvent): string {
  if ('at' in a) return plain(MOMENT.format(new Date(a.at)));
  if (e.allDay) {
    const moment = new Date(dayStart(e.start) - a.before * 60_000);
    const days = Math.round((dayStart(e.start) - dayStart(toLocalDate(moment))) / 86_400_000);
    const when = days <= 0 ? 'On the day' : `${duration(days * 1440)} before`;
    return `${when} at ${plain(TIME.format(moment))}`;
  }
  if (a.before === 0) return 'At time of event';
  return `${duration(Math.abs(a.before))} ${a.before > 0 ? 'before' : 'after'}`;
}

/** "30 min travel time", "1 hr 15 min travel time". */
export function travelLine(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${[h ? `${h} hr` : '', m ? `${m} min` : ''].filter(Boolean).join(' ')} travel time`;
}

/** "Busy", "Free", "Tentative", "Unavailable". */
export const availabilityLine = (a: Availability) => a[0].toUpperCase() + a.slice(1);

/** The link, when it is one the panel may open: http or https only. */
export function safeLink(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

/** A link as shown: without the scheme or a trailing slash. */
export const linkLabel = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');

/** One attendee row: the organizer is labelled and listed first. */
export interface AttendeeRow extends Attendee {
  organizer: boolean;
}

/**
 * The attendees, organizer first and labelled. An organizer not among the
 * attendees is added, with no answer shown.
 */
export function attendeeRows(e: CalendarEvent): AttendeeRow[] {
  const rows: AttendeeRow[] = (e.attendees ?? []).map((a) => ({ ...a, organizer: a.name === e.organizer }));
  if (e.organizer && !rows.some((r) => r.organizer)) rows.unshift({ name: e.organizer, status: 'other', organizer: true });
  return rows.sort((a, b) => Number(b.organizer) - Number(a.organizer));
}

/** "5 attendees · 2 accepted, 1 declined, 1 maybe": answers with none are left out. */
export function attendeeSummary(rows: AttendeeRow[]): string {
  const count = (s: AttendeeStatus) => rows.filter((r) => r.status === s).length;
  const answers = [
    [count('accepted'), 'accepted'],
    [count('declined'), 'declined'],
    [count('tentative'), 'maybe'],
  ]
    .filter(([n]) => n)
    .map(([n, word]) => `${n} ${word}`);
  const head = `${rows.length} ${rows.length === 1 ? 'attendee' : 'attendees'}`;
  return answers.length ? `${head} · ${answers.join(', ')}` : head;
}
