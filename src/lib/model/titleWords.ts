/**
 * Natural-language entry (FR-1.12): the dates and details typed in a task's
 * title. `readTitle` finds them and says which words they came from, so the
 * caller can take those words out of the title and set the task's fields
 * instead: Start Date, a deadline ("by fri", "due jan 12"), a reminder
 * ("at 9am", "tomorrow 9am", "in 30 minutes"), a repeat ("every mon"), a
 * priority (p1–p5), tags (#errand) and a context (@home).
 *
 * It reuses the pickers' readers (typed dates, typed reminders and times) and
 * the Todoist import's repeat phrases, and is stricter than the pickers,
 * since a title is ordinary text: short forms that are also words or names
 * ("tom", "sun", "may") aren't read, a relative date needs "in", a date in
 * numbers needs its year, and words in quotes are never read. Only existing
 * tags and contexts are read. English only, like the pickers.
 */
import { readTodoistDate } from '../import/todoistDates';
import { readDay } from '../import/rows';
import { firstDate } from './repeat';
import { parseTime, reminderAt, reminderTime, type ReminderAt, type ReminderTime } from './reminder';
import { parseTypedDate } from './typedDate';
import { formatShort, toLocalDate } from './dates';
import type { ID, LocalDate, Priority, RepeatDay, RepeatRule } from './types';

/** What a word or phrase sets. */
export type TitleWordKind = 'start' | 'deadline' | 'reminder' | 'repeat' | 'priority' | 'tag' | 'context';

/** One phrase found in the title, with its place (character offsets, `to` excluded). */
export interface TitleWord {
  kind: TitleWordKind;
  from: number;
  to: number;
  text: string;
}

/** The fields read from a title. Absent: not read. */
export interface TitleFields {
  startDate?: LocalDate;
  deadline?: LocalDate;
  /** A date and time, or a time only for a template's task. */
  reminder?: ReminderAt | ReminderTime;
  repeat?: { rule: RepeatRule; first: LocalDate | null };
  priority?: Priority;
  tagIds?: ID[];
  contextId?: ID;
}

export interface TitleReading {
  /** The words read, in title order; a phrase with a date and a time is two words. */
  words: TitleWord[];
  fields: TitleFields;
  /** The title with the words read taken out. */
  title: string;
  /** Phrases recognised but not used, with why ("After the deadline (Dec 4)"). */
  unused: { text: string; why: string }[];
}

/** What the reader needs to know about the task and the gist. */
export interface TitleContext {
  /** Today, and now (for "in 30 minutes"). */
  ref: LocalDate;
  now: Date;
  /** Each tag with its path ("home/garden"), for #tags. */
  tags: { id: ID; title: string; path: string }[];
  contexts: { id: ID; title: string }[];
  /** Reminders are read only while the helper writes them (FR-3.8). */
  remindersOn: boolean;
  /**
   * A template's task (a repeating task, or one in a repeating project's
   * template): no start date, deadline or repeat, and a reminder is a time.
   */
  template: boolean;
  /** The task's deadline now, which a start date may not pass (FR-3.6). */
  deadline: LocalDate | null;
  /** The task's start date now, for a reminder given as a time alone. */
  startDate: LocalDate | null;
}

export interface ReadOptions {
  /** Read only the words within this part of the title (the text just typed); default the whole title. */
  from?: number;
  to?: number;
  /** Start offsets of words the user chose to keep as text. */
  kept?: ReadonlySet<number>;
}

interface Token {
  text: string;
  /** Lower case, without trailing punctuation. */
  word: string;
  from: number;
  to: number;
  quoted: boolean;
}

/** Short forms the pickers take that are also words or names: not read in a title. */
const NOT_IN_TITLES = new Set(['tom', 'tod', 'sun', 'sat', 'wed', 'may', 'march', 'weekend']);
const TIME_WORD = /^(\d{1,2}([:.]\d{2})?(am|pm|a|p)|\d{1,2}[:.]\d{2}|noon|midnight)$/;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
/** The longest phrase tried, in words. */
const LONGEST = 8;

function tokens(title: string): Token[] {
  const quoted: [number, number][] = [];
  for (const m of title.matchAll(/"[^"]*"|“[^”]*”/g)) quoted.push([m.index!, m.index! + m[0].length]);
  const out: Token[] = [];
  for (const m of title.matchAll(/\S+/g)) {
    const from = m.index!;
    const to = from + m[0].length;
    out.push({
      text: m[0],
      word: m[0].toLowerCase().replace(/[,.;:!?)]+$/, ''),
      from,
      to,
      quoted: quoted.some(([a, b]) => from < b && to > a),
    });
  }
  return out;
}

/** A start date from `words`, by the title's stricter rules, or null. */
function titleDate(words: string[], ref: LocalDate): LocalDate | null {
  if (!words.length || NOT_IN_TITLES.has(words[0]) || NOT_IN_TITLES.has(words[words.length - 1])) return null;
  const text = words.join(' ');
  // A relative date needs "in" ("in 3 days", not "3 days"); numbers need a year ("1/12/27", "2027-01-12").
  if (/^(an?|\d+)\s/.test(text)) return null;
  if (/^\d{1,2}\/\d{1,2}$/.test(text)) return null;
  // A day number alone, or a month alone, isn't a date.
  if (/^\d+(st|nd|rd|th)?$/.test(text)) return null;
  return parseTypedDate(text, ref);
}

/** A time from one or two words ("9am", "9 am", "14:00"), or null. */
function titleTime(words: string[]): ReminderTime | null {
  const joined = words.join('');
  if (!TIME_WORD.test(joined)) return null;
  return parseTime(joined);
}

/** Normalised for matching a tag or context name: lower case, letters and digits only. */
const key = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}/]+/gu, '');

/** The repeat a phrase starting "every" describes, as a rule and its first date. */
function titleRepeat(text: string, ref: LocalDate): { rule: RepeatRule; first: LocalDate | null } | null {
  const read = readTodoistDate(text, ref);
  if (!read || !('repeat' in read)) return null;
  const c = read.repeat;
  const fixed = c.repeat === 'regularly';
  const weekdays = c.repeat_weekdays ? c.repeat_weekdays.split(';').map((d) => DAY_NAMES.indexOf(d.slice(0, 3))) : [];
  const bad = (): never => {
    throw new Error('not a day');
  };
  let days: RepeatDay[];
  try {
    days = c.repeat_month_day ? c.repeat_month_day.split(';').map((d) => readDay(d.trim(), bad)) : [];
  } catch {
    return null;
  }
  const rule: RepeatRule = {
    mode: fixed ? 'fixed' : 'afterCompletion',
    unit: c.repeat_unit,
    interval: Number(c.repeat_every) || 1,
    weekdays,
    days,
    month: c.repeat_month ? MONTHS.indexOf(c.repeat_month.slice(0, 3)) + 1 : null,
    endCount: null,
    endDate: c.repeat_ends_on || null,
    made: 0,
    deadlineDays: null,
    paused: false,
  };
  const first = c.repeat_first || (fixed ? firstDate(rule, ref) : ref);
  return { rule, first };
}

/**
 * Read the dates and details in a title (FR-1.12). Only the first phrase of
 * each kind is read; a later one stays as text. Nothing is read when taking
 * the words out would leave the title empty.
 */
export function readTitle(title: string, ctx: TitleContext, opts: ReadOptions = {}): TitleReading {
  const all = tokens(title);
  const from = opts.from ?? 0;
  const to = opts.to ?? title.length;
  const usable = (t: Token) => !t.quoted && t.from >= from && t.to <= to && !opts.kept?.has(t.from);
  const words: TitleWord[] = [];
  const fields: TitleFields = {};
  const unused: TitleReading['unused'] = [];
  let time: ReminderTime | null = null;
  let relative: ReminderAt | null = null;
  /** The date a time belongs to, when it came right after or before one. */
  let timeDate: LocalDate | null = null;

  const span = (i: number, n: number) => all.slice(i, i + n);
  const add = (kind: TitleWordKind, toks: Token[]) =>
    words.push({ kind, from: toks[0].from, to: toks[toks.length - 1].to, text: title.slice(toks[0].from, toks[toks.length - 1].to) });
  /** The longest run of usable words from i that `read` accepts, longest first. */
  const longest = <T>(i: number, max: number, read: (w: string[]) => T | null): { n: number; value: T } | null => {
    for (let n = Math.min(max, all.length - i); n >= 1; n--) {
      const toks = span(i, n);
      if (!toks.every(usable)) continue;
      const value = read(toks.map((t) => t.word));
      if (value !== null) return { n, value };
    }
    return null;
  };

  for (let i = 0; i < all.length; ) {
    const t = all[i];
    if (!usable(t)) {
      i++;
      continue;
    }
    const w = t.word;

    // p1–p5
    if (/^p[1-5]$/.test(w) && fields.priority === undefined) {
      fields.priority = Number(w[1]) as Priority;
      add('priority', [t]);
      i++;
      continue;
    }
    // #tag: an existing tag, by name or path
    if (w.startsWith('#') && w.length > 1) {
      const name = key(w.slice(1));
      const tag = ctx.tags.find((x) => key(x.path) === name) ?? ctx.tags.find((x) => key(x.title) === name);
      if (tag && !fields.tagIds?.includes(tag.id)) {
        fields.tagIds = [...(fields.tagIds ?? []), tag.id];
        add('tag', [t]);
      }
      i++;
      continue;
    }
    // @context: an existing context
    if (w.startsWith('@') && w.length > 1) {
      const name = key(w.slice(1));
      const context = ctx.contexts.find((x) => key(x.title) === name);
      if (context && fields.contextId === undefined) {
        fields.contextId = context.id;
        add('context', [t]);
      }
      i++;
      continue;
    }
    // every …: a repeat
    if (w === 'every' && !ctx.template) {
      // A time after it is the reminder's, not part of the repeat.
      const found = longest(i, LONGEST, (ws) => (fields.repeat || ws.some((x) => x === 'at' || TIME_WORD.test(x)) ? null : titleRepeat(ws.join(' '), ctx.ref)));
      if (found) {
        fields.repeat = found.value;
        add('repeat', span(i, found.n));
        i += found.n;
        continue;
      }
    }
    // by/due …: a deadline
    if ((w === 'by' || w === 'due') && !ctx.template && fields.deadline === undefined) {
      const found = longest(i + 1, 4, (ws) => titleDate(ws, ctx.ref));
      if (found) {
        fields.deadline = found.value;
        add('deadline', span(i, found.n + 1));
        i += found.n + 1;
        continue;
      }
    }
    // in N minutes/hours: a reminder from now
    if (w === 'in' && ctx.remindersOn && !ctx.template && relative === null && time === null) {
      const toks = span(i, 3);
      if (toks.length === 3 && toks.every(usable) && /^(an?|\d+)$/.test(toks[1].word) && /^(hours?|hrs?|minutes?|mins?)$/.test(toks[2].word)) {
        const n = toks[1].word.startsWith('a') ? 1 : Number(toks[1].word);
        const at = new Date(ctx.now.getTime() + n * (toks[2].word.startsWith('h') ? 3_600_000 : 60_000));
        at.setSeconds(0, 0);
        relative = reminderAt(toLocalDate(at), `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`);
        add('reminder', toks);
        i += 3;
        continue;
      }
    }
    // (at) a time: a reminder
    if (ctx.remindersOn && time === null && relative === null) {
      const at = w === 'at' ? 1 : 0;
      const found = longest(i + at, 2, (ws) => titleTime(ws));
      if (found) {
        time = found.value;
        add('reminder', span(i, found.n + at));
        // A date just before it is the reminder's day.
        const prev = words[words.length - 2];
        if (prev?.kind === 'start' && fields.startDate) timeDate = fields.startDate;
        i += found.n + at;
        continue;
      }
    }
    // A start date
    if (!ctx.template && fields.startDate === undefined && !fields.repeat) {
      const found = longest(i, 4, (ws) => titleDate(ws, ctx.ref));
      if (found) {
        const date = found.value;
        const deadline = fields.deadline ?? ctx.deadline;
        if (deadline && date > deadline && date > ctx.ref) {
          unused.push({ text: title.slice(t.from, all[i + found.n - 1].to), why: `After the deadline (${formatShort(deadline)})` });
        } else {
          fields.startDate = date;
          add('start', span(i, found.n));
          // A time just before it is on this day.
          if (time !== null && words.length >= 2 && words[words.length - 2].kind === 'reminder') timeDate = date;
        }
        i += found.n;
        continue;
      }
    }
    i++;
  }

  // A deadline read before a start date that turns out later: check again.
  if (fields.deadline && fields.startDate && fields.startDate > fields.deadline && fields.startDate > ctx.ref) {
    const w = words.find((x) => x.kind === 'start')!;
    unused.push({ text: w.text, why: `After the deadline (${formatShort(fields.deadline)})` });
    words.splice(words.indexOf(w), 1);
    delete fields.startDate;
  }
  // A repeat can't also have a start date or deadline of its own: they stay as text.
  if (fields.repeat) {
    for (const kind of ['start', 'deadline'] as const) {
      const w = words.find((x) => x.kind === kind);
      if (w) words.splice(words.indexOf(w), 1);
    }
    delete fields.startDate;
    delete fields.deadline;
  }

  if (relative) fields.reminder = ctx.template ? reminderTime(relative) : relative;
  else if (time !== null) {
    if (ctx.template || fields.repeat) fields.reminder = time;
    else {
      const day = timeDate ?? fields.startDate ?? (ctx.startDate && ctx.startDate > ctx.ref ? ctx.startDate : ctx.ref);
      fields.reminder = reminderAt(day, time);
    }
  }

  words.sort((a, b) => a.from - b.from);
  const rest = removeWords(title, words);
  if (!rest.trim()) return { words: [], fields: {}, title, unused: [] };
  return { words, fields, title: rest, unused };
}

/** The title without the given words, spaces tidied. */
export function removeWords(title: string, words: TitleWord[]): string {
  let out = '';
  let at = 0;
  for (const w of [...words].sort((a, b) => a.from - b.from)) {
    out += title.slice(at, w.from);
    at = w.to;
  }
  out += title.slice(at);
  return out.replace(/\s+([,.;:!?])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}

/**
 * The part of `now` that was typed since `before`: the text between the
 * common start and the common end. Only these words are read when a title
 * is changed (FR-1.12).
 */
export function typedPart(before: string, now: string): { from: number; to: number } {
  let start = 0;
  while (start < before.length && start < now.length && before[start] === now[start]) start++;
  let end = 0;
  while (end < before.length - start && end < now.length - start && before[before.length - 1 - end] === now[now.length - 1 - end]) end++;
  // Widen to whole words, so a word partly typed is read whole.
  let from = start;
  if (/\S/.test(now[from] ?? '')) while (from > 0 && /\S/.test(now[from - 1])) from--;
  let to = Math.max(from, now.length - end);
  if (/\S/.test(now[to - 1] ?? '')) while (to < now.length && /\S/.test(now[to])) to++;
  return { from, to };
}

/** Whether anything was read. */
export function hasFields(f: TitleFields): boolean {
  return Object.keys(f).length > 0;
}
