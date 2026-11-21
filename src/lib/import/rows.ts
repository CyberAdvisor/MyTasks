/**
 * Import's row checks (FR-12.6, FR-12.9; repeating projects FR-4.6): turn
 * the CSV's rows into typed rows, checking every column against the
 * template on the website's Import page. The first problem stops the
 * import, naming the row as a spreadsheet numbers it (the header is row 1),
 * so the file can be fixed.
 */
import type { LocalDate, Priority, RepeatDay, RepeatRule, RepeatUnit, Status } from '../model/types';

export type RowType = 'area' | 'project' | 'heading' | 'task' | 'checklist';
export type RowStart = 'inbox' | 'today' | 'date' | 'unscheduled' | 'deferred';

/** One checked row of the file. Blank columns are null (or the column's default). */
export interface ImportRow {
  /** Its row number in a spreadsheet (the header is 1). */
  line: number;
  type: RowType;
  id: string | null;
  parentId: string | null;
  title: string;
  notes: string;
  area: string | null;
  project: string | null;
  heading: string | null;
  /** Tag paths: ["Errand", "Shop"] for `Errand/Shop`. */
  tags: string[][];
  start: RowStart | null;
  startDate: LocalDate | null;
  deadline: LocalDate | null;
  priority: Priority | null;
  context: string | null;
  checked: boolean;
  status: Status;
  completedDate: LocalDate | null;
  createdDate: LocalDate | null;
  /** A repeating task's or project's rule; its first date is `repeatFirst`. */
  repeat: RepeatRule | null;
  repeatFirst: LocalDate | null;
  /** A checklist row with no parent_id: the row number of the task above it. */
  taskAbove: number | null;
}

/** A row the import can't use; nothing is imported. */
export class ImportError extends Error {
  constructor(
    readonly line: number | null,
    problem: string,
  ) {
    super(line === null ? problem : `Row ${line}: ${problem}`);
  }
}

/** Every column, and the row types it may be filled in on. */
const COLUMNS: Record<string, readonly RowType[]> = {
  type: ['area', 'project', 'heading', 'task', 'checklist'],
  id: ['area', 'project', 'heading', 'task', 'checklist'],
  parent_id: ['project', 'heading', 'task', 'checklist'],
  title: ['area', 'project', 'heading', 'task', 'checklist'],
  notes: ['project', 'task'],
  area: ['project', 'task'],
  project: ['heading', 'task'],
  heading: ['task'],
  tags: ['area', 'project', 'task'],
  start: ['project', 'task'],
  start_date: ['project', 'task'],
  deadline: ['project', 'task'],
  priority: ['task'],
  context: ['task'],
  checked: ['checklist'],
  status: ['project', 'task'],
  completed_date: ['project', 'task'],
  created_date: ['area', 'project', 'heading', 'task', 'checklist'],
  repeat: ['task', 'project'],
  repeat_every: ['task', 'project'],
  repeat_unit: ['task', 'project'],
  repeat_weekdays: ['task', 'project'],
  repeat_month_day: ['task', 'project'],
  repeat_month: ['task', 'project'],
  repeat_first: ['task', 'project'],
  repeat_ends_after: ['task', 'project'],
  repeat_ends_on: ['task', 'project'],
  repeat_deadline: ['task', 'project'],
  repeat_start_early: ['task', 'project'],
  repeat_paused: ['task', 'project'],
};

/** The template's columns, in its order (the website's template file). */
export const COLUMN_NAMES = Object.keys(COLUMNS);

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const ORDINALS: Record<string, number> = { '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5, last: -1 };

/** Check the header and every row; throws ImportError at the first problem. */
export function readRows(table: string[][]): ImportRow[] {
  if (!table.length) throw new ImportError(null, 'The file is empty.');
  const header = table[0].map((h) => h.trim().toLowerCase());
  for (const h of header) {
    if (!(h in COLUMNS)) throw new ImportError(1, `“${h}” isn’t a column My Tasks knows. Check its spelling against the Import page.`);
  }
  if (!header.includes('type') || !header.includes('title')) throw new ImportError(1, 'The header needs a type and a title column.');
  if (new Set(header).size !== header.length) throw new ImportError(1, 'A column appears twice.');

  const rows: ImportRow[] = [];
  const ids = new Set<string>();
  let lastTask: number | null = null;
  table.slice(1).forEach((cells, i) => {
    const line = i + 2;
    if (cells.length > header.length && cells.slice(header.length).some((c) => c.trim()))
      throw new ImportError(line, 'It has more values than the header has columns.');
    const cell = (name: string): string => {
      const at = header.indexOf(name);
      return at < 0 ? '' : (cells[at] ?? '').trim();
    };
    const row = readRow(line, cell);
    for (const name of header) {
      if (cell(name) && !COLUMNS[name].includes(row.type)) throw new ImportError(line, `${name} isn’t used on a ${row.type} row.`);
    }
    if (row.id !== null) {
      if (ids.has(row.id)) throw new ImportError(line, `The id “${row.id}” is used on an earlier row.`);
      ids.add(row.id);
    }
    if (row.type === 'task') lastTask = line;
    if (row.type === 'checklist' && row.parentId === null) {
      if (lastTask === null) throw new ImportError(line, 'A checklist row needs a task row above it, or a parent_id.');
      row.taskAbove = lastTask;
    }
    rows.push(row);
  });
  if (!rows.length) throw new ImportError(null, 'The file has a header but no rows.');
  return rows;
}

/** One row, read through `cell`. */
function readRow(line: number, cell: (name: string) => string): ImportRow {
  const fail = (problem: string): never => {
    throw new ImportError(line, problem);
  };
  const type = cell('type').toLowerCase();
  if (!(['area', 'project', 'heading', 'task', 'checklist'] as string[]).includes(type))
    fail(type ? `“${type}” isn’t a type: use area, project, heading, task or checklist.` : 'The type is empty.');
  const title = cell('title');
  if (!title) fail('The title is empty.');

  const date = (name: string): LocalDate | null => {
    const v = cell(name);
    if (!v) return null;
    return isDate(v) ? v : fail(`${name} “${v}” isn’t a date written as YYYY-MM-DD.`);
  };
  const yesNo = (name: string): boolean => {
    const v = cell(name).toLowerCase();
    if (!v || ['no', 'false', '0'].includes(v)) return false;
    return ['yes', 'true', '1'].includes(v) ? true : fail(`${name} should be yes or no.`);
  };
  const count = (name: string, min: number): number | null => {
    const v = cell(name);
    if (!v) return null;
    return /^\d+$/.test(v) && Number(v) >= min ? Number(v) : fail(`${name} should be a whole number${min ? ` from ${min}` : ''}.`);
  };
  const name = (n: string): string | null => cell(n) || null;

  let start = (cell('start').toLowerCase() || null) as RowStart | null;
  if (start && !['inbox', 'today', 'date', 'unscheduled', 'deferred'].includes(start))
    fail('start should be inbox, today, date, unscheduled or deferred.');
  const startDate = date('start_date');
  // A date makes a task scheduled: so does one given with start deferred,
  // as a date moves a task out of Deferred in the app.
  if (startDate && (start === null || start === 'deferred')) start = 'date';
  if (start === 'date' && !startDate) fail('start is date, but start_date is empty.');
  if (startDate && start !== 'date') fail(`start_date is used only with start set to date.`);

  const p = cell('priority');
  if (p && !/^[1-5]$/.test(p)) fail('priority should be 1, 2, 3, 4 or 5.');

  const status = (cell('status').toLowerCase() || 'open') as Status;
  if (!['open', 'completed', 'canceled'].includes(status)) fail('status should be open, completed or canceled.');
  const completedDate = date('completed_date');
  if (completedDate && status === 'open') fail('completed_date is used only on a completed or canceled row.');

  const repeat = readRepeat(cell, fail, date, yesNo, count);
  if (repeat && status !== 'open') fail(`A repeating ${type} must be open.`);
  if (repeat && (cell('deadline') || startDate)) fail(`A repeating ${type} takes its dates from its rule: use repeat_first and repeat_deadline, not start_date or deadline.`);

  return {
    line,
    type: type as RowType,
    id: name('id'),
    parentId: name('parent_id'),
    title,
    notes: cell('notes'),
    area: name('area'),
    project: name('project'),
    heading: name('heading'),
    tags: readTags(cell('tags'), fail),
    start,
    startDate,
    deadline: date('deadline'),
    priority: p ? (Number(p) as Priority) : null,
    context: name('context'),
    checked: yesNo('checked'),
    status,
    completedDate,
    createdDate: date('created_date'),
    repeat: repeat?.rule ?? null,
    repeatFirst: repeat?.first ?? null,
    taskAbove: null,
  };
}

/** `Errand; Errand/Shop` → [["Errand"], ["Errand", "Shop"]]. */
function readTags(v: string, fail: (p: string) => never): string[][] {
  if (!v) return [];
  return v
    .split(';')
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => {
      const path = t.split('/').map((s) => s.trim());
      if (path.some((s) => !s)) fail(`The tag “${t}” has an empty name in it.`);
      return path;
    });
}

/** The repeat columns, or null when `repeat` is blank. */
function readRepeat(
  cell: (name: string) => string,
  fail: (p: string) => never,
  date: (name: string) => LocalDate | null,
  yesNo: (name: string) => boolean,
  count: (name: string, min: number) => number | null,
): { rule: RepeatRule; first: LocalDate | null } | null {
  const mode = cell('repeat').toLowerCase();
  const others = Object.keys(COLUMNS).filter((c) => c.startsWith('repeat_') && cell(c));
  if (!mode) {
    if (others.length) fail(`${others[0]} is used only on a repeating task or project: set repeat.`);
    return null;
  }
  if (mode !== 'regularly' && mode !== 'after_completion') fail('repeat should be regularly or after_completion.');
  const unit = cell('repeat_unit').toLowerCase() as RepeatUnit;
  if (!['day', 'week', 'month', 'year'].includes(unit)) fail('repeat_unit should be day, week, month or year.');
  const fixed = mode === 'regularly';

  const weekdays = cell('repeat_weekdays')
    ? cell('repeat_weekdays')
        .toLowerCase()
        .split(';')
        .map((d) => d.trim().slice(0, 3))
        .filter(Boolean)
        .map((d) => {
          const i = DAY_NAMES.indexOf(d);
          return i >= 0 ? i : fail(`repeat_weekdays: “${d}” isn’t a day (use mon, tue, wed…).`);
        })
    : [];
  if (weekdays.length && (!fixed || unit !== 'week')) fail('repeat_weekdays is used only on a regular weekly repeat.');

  const days = cell('repeat_month_day')
    ? cell('repeat_month_day')
        .toLowerCase()
        .split(';')
        .map((d) => d.trim())
        .filter(Boolean)
        .map((d) => readDay(d, fail))
    : [];
  if (days.length && (!fixed || (unit !== 'month' && unit !== 'year')))
    fail('repeat_month_day is used only on a regular monthly or yearly repeat.');

  let month: number | null = null;
  if (cell('repeat_month')) {
    const m = MONTH_NAMES.indexOf(cell('repeat_month').toLowerCase().slice(0, 3));
    if (m < 0) fail('repeat_month should be a month: jan, feb, mar…');
    if (!fixed || unit !== 'year') fail('repeat_month is used only on a regular yearly repeat.');
    month = m + 1;
  }

  const endCount = count('repeat_ends_after', 1);
  const endDate = date('repeat_ends_on');
  if ((endCount !== null || endDate) && !fixed) fail('An after_completion repeat can’t have an end.');
  if (endCount !== null && endDate) fail('Use repeat_ends_after or repeat_ends_on, not both.');
  const hasDeadline = yesNo('repeat_deadline');
  const early = count('repeat_start_early', 0);
  if (early !== null && !hasDeadline) fail('repeat_start_early is used only with repeat_deadline set to yes.');

  const rule: RepeatRule = {
    mode: fixed ? 'fixed' : 'afterCompletion',
    unit,
    interval: count('repeat_every', 1) ?? 1,
    weekdays,
    days,
    month,
    endCount,
    endDate,
    made: 0,
    deadlineDays: hasDeadline ? (early ?? 0) : null,
    paused: yesNo('repeat_paused'),
  };
  return { rule, first: date('repeat_first') };
}

/** `15`, `last`, `2nd tue`, `last fri`. */
function readDay(d: string, fail: (p: string) => never): RepeatDay {
  if (/^\d{1,2}$/.test(d) && Number(d) >= 1 && Number(d) <= 31) return { ordinal: Number(d), weekday: null };
  const [o, w] = d.split(/\s+/);
  const ordinal = ORDINALS[o];
  if (ordinal === undefined) fail(`repeat_month_day: “${d}” should be like 15, last, 2nd tue or last fri.`);
  if (w === undefined) return ordinal === -1 ? { ordinal: -1, weekday: null } : fail(`repeat_month_day: “${d}” needs a day, as in ${o} tue.`);
  const weekday = DAY_NAMES.indexOf(w.slice(0, 3));
  if (weekday < 0) fail(`repeat_month_day: “${w}” isn’t a day.`);
  return { ordinal, weekday };
}

/** A real date written YYYY-MM-DD. */
function isDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const t = new Date(y, m - 1, d);
  return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d;
}
