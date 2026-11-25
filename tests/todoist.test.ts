/**
 * Importing Todoist exports (FR-12.13): recognising the file, its rows
 * becoming Import's own (a project per file, sections as headings, labels as
 * tags, priorities, comments in the notes, sub-tasks as tasks), the English
 * date and repeat phrases, what can't be read, and several files at once.
 * The fixture is a real export, with its author’s name and id replaced.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/lib/db/database';
import * as repo from '../src/lib/db/repo';
import { clearUndo, undo } from '../src/lib/db/history';
import { parseCsv } from '../src/lib/import/csv';
import { readRows, type ImportRow } from '../src/lib/import/rows';
import { prepareImport } from '../src/lib/import';
import { convertTodoist, isTodoistExport, projectName, splitLabels } from '../src/lib/import/todoist';
import { readTodoistDate } from '../src/lib/import/todoistDates';
import TEMPLATE from '../site/assets/import/mytasks-import-template.csv?raw';
import { TODOIST_EXPORT as EXPORT } from './fixtures/todoistExport';

const REF = '2026-11-25'; // a Wednesday
const FILE = 'Claude test – delete me.csv';

/** The fixture's rows, read through Import's own checks. */
const rowsOf = (text = EXPORT, name = FILE) => readRows(convertTodoist([{ name, table: parseCsv(text) }], REF).table);
const row = (rows: ImportRow[], title: string) => rows.find((r) => r.title === title)!;

/** A one-task Todoist export with these DATE and DATE_LANG cells. */
const oneTask = (date: string, lang = 'en', content = 'A task') =>
  `TYPE,CONTENT,DESCRIPTION,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DATE,DATE_LANG,TIMEZONE\ntask,${content},,4,1,,,"${date}",${lang},`;

beforeEach(async () => {
  await db.delete();
  await db.open();
  clearUndo();
});

describe('recognising an export', () => {
  it('knows a Todoist export by its header, and not My Tasks’ own format', () => {
    expect(isTodoistExport(parseCsv(EXPORT))).toBe(true);
    expect(isTodoistExport(parseCsv(TEMPLATE))).toBe(false);
  });

  it('names the project after the file', () => {
    expect(projectName('Work.csv')).toBe('Work');
    expect(projectName('Home Reno.CSV')).toBe('Home Reno');
    expect(projectName('.csv')).toBe('Imported project');
  });

  it('takes labels out of the name as tags', () => {
    expect(splitLabels('Call Sam @phone @errands')).toEqual({ title: 'Call Sam', tags: 'phone; errands' });
    expect(splitLabels('Email me@example.com')).toEqual({ title: 'Email me@example.com', tags: '' });
    expect(splitLabels('@only')).toEqual({ title: '@only', tags: 'only' });
  });
});

describe('the export’s rows', () => {
  it('makes one project, with the description, and the section as a heading', () => {
    const rows = rowsOf();
    const project = rows.find((r) => r.type === 'project')!;
    expect(project.title).toBe('Claude test – delete me');
    expect(project.notes).toBe('Project description for the export test.');
    expect(project.area).toBeNull();
    const heading = rows.find((r) => r.type === 'heading')!;
    expect(heading.title).toBe('Section A');
    expect(row(rows, 'Pay rent').parentId).toBe(heading.id);
    expect(row(rows, 'Pay invoice').parentId).toBe(project.id);
    expect(rows.filter((r) => r.type === 'task')).toHaveLength(5);
  });

  it('reads the repeat, priority, label, description and comment', () => {
    const weekly = row(rowsOf(), 'Weekly review');
    expect(weekly.tags).toEqual([['claudetest']]);
    expect(weekly.priority).toBe(2);
    expect(weekly.repeat).toMatchObject({ mode: 'fixed', unit: 'week', interval: 1, weekdays: [5] });
    expect(weekly.notes).toBe('Task description line one\n\nComment (2026-11-25): A comment on the task');
  });

  it('makes a sub-task a task of its own, naming its parent', () => {
    const sub = row(rowsOf(), 'Sub-task one');
    expect(sub.type).toBe('task');
    expect(sub.notes).toBe('Sub-task of: Weekly review');
  });

  it('reads dates and maps priorities, Todoist’s 4 being none', () => {
    const rows = rowsOf();
    expect(row(rows, 'Pay invoice')).toMatchObject({ start: 'date', startDate: '2026-11-26', priority: 1 });
    expect(row(rows, 'Plain task with')).toMatchObject({ priority: null, startDate: null, repeat: null });
    expect(row(rows, 'Pay rent').repeat).toMatchObject({ unit: 'month', days: [{ ordinal: 1, weekday: null }] });
    expect(row(rows, 'Pay rent').priority).toBe(3);
  });

  it('keeps a date it can’t read, or one in another language, as text in the notes', () => {
    const files = [
      { name: 'a.csv', table: parseCsv(oneTask('every other workday')) },
      { name: 'b.csv', table: parseCsv(oneTask('jeden Freitag', 'de')) },
    ];
    const done = convertTodoist(files, REF);
    expect(done.unreadable).toBe(2);
    const rows = readRows(done.table).filter((r) => r.type === 'task');
    expect(rows.map((r) => [r.startDate, r.repeat, r.notes])).toEqual([
      [null, null, 'Todoist date: every other workday'],
      [null, null, 'Todoist date: jeden Freitag'],
    ]);
  });
});

describe('Todoist’s date phrases', () => {
  it.each([
    ['Nov 26', '2026-11-26'],
    ['Nov 20', '2026-11-20'], // overdue: this year, not next
    ['Jan 3', '2027-01-03'],
    ['26 Nov 2027', '2027-11-26'],
    ['Nov 26 at 4:30pm', '2026-11-26'],
    ['2026-12-01T09:00:00', '2026-12-01'],
    ['today', '2026-11-25'],
    ['tomorrow', '2026-11-26'],
    ['fri', '2026-11-27'],
  ])('“%s” is %s', (text, date) => {
    expect(readTodoistDate(text, REF)).toEqual({ date });
  });

  it.each([
    ['every day', { repeat: 'regularly', repeat_unit: 'day', repeat_every: '1' }],
    ['daily', { repeat_unit: 'day' }],
    ['every 3 days', { repeat_unit: 'day', repeat_every: '3' }],
    ['every other week', { repeat_unit: 'week', repeat_every: '2' }],
    ['every friday at 4pm', { repeat_unit: 'week', repeat_weekdays: 'fri' }],
    ['every mon, wed and fri', { repeat_unit: 'week', repeat_weekdays: 'mon;wed;fri' }],
    ['every weekday', { repeat_unit: 'week', repeat_weekdays: 'mon;tue;wed;thu;fri' }],
    ['every 1st', { repeat_unit: 'month', repeat_month_day: '1' }],
    ['every last day', { repeat_unit: 'month', repeat_month_day: 'last' }],
    ['every 2nd tue', { repeat_unit: 'month', repeat_month_day: '2nd tue' }],
    ['every jan 15', { repeat_unit: 'year', repeat_month: 'jan', repeat_month_day: '15' }],
    ['every year', { repeat_unit: 'year' }],
    ['every! 2 weeks', { repeat: 'after_completion', repeat_unit: 'week', repeat_every: '2' }],
    ['every monday starting dec 7', { repeat_weekdays: 'mon', repeat_first: '2026-12-07' }],
    ['every day ending dec 31', { repeat_unit: 'day', repeat_ends_on: '2026-12-31' }],
  ])('“%s” is a repeat', (text, expected) => {
    const read = readTodoistDate(text, REF);
    expect(read && 'repeat' in read ? read.repeat : null).toMatchObject(expected);
  });

  it.each(['every other workday', 'every! friday', 'someday', 'every 3rd sunday of the quarter'])('“%s” isn’t understood', (text) => {
    expect(readTodoistDate(text, REF)).toBeNull();
  });
});

describe('importing', () => {
  it('previews and imports a Todoist export, and one Undo takes it back', async () => {
    const prepared = await prepareImport([{ name: FILE, text: EXPORT }]);
    expect(prepared.todoist).toEqual({ projects: ['Claude test – delete me'], unreadable: 0 });
    expect(prepared.name).toBe(FILE);
    await repo.importRows(prepared.rows);
    const projects = (await db.projects.toArray()).filter((p) => !p.deletedAt);
    expect(projects.map((p) => [p.title, p.areaId])).toEqual([['Claude test – delete me', null]]);
    const tags = (await db.tags.toArray()).map((t) => t.title);
    expect(tags).toEqual(['claudetest']);
    const weekly = (await db.todos.toArray()).find((t) => t.title === 'Weekly review' && !t.repeatOf)!;
    expect(weekly.repeat?.weekdays).toEqual([5]);
    await undo();
    expect((await db.todos.toArray()).filter((t) => !t.deletedAt)).toHaveLength(0);
  });

  it('imports several Todoist exports together, a project from each', async () => {
    const prepared = await prepareImport([
      { name: 'Work.csv', text: oneTask('tomorrow', 'en', 'Write report') },
      { name: 'Home.csv', text: oneTask('every sat', 'en', 'Mow lawn') },
    ]);
    expect(prepared.name).toBe('2 files');
    expect(prepared.todoist?.projects).toEqual(['Work', 'Home']);
    await repo.importRows(prepared.rows);
    const projects = (await db.projects.toArray()).map((p) => p.title).sort();
    expect(projects).toEqual(['Home', 'Work']);
  });

  it('refuses several files when they aren’t all Todoist exports', async () => {
    await expect(
      prepareImport([
        { name: 'a.csv', text: oneTask('today') },
        { name: 'b.csv', text: 'type,title\ntask,Plain' },
      ]),
    ).rejects.toThrow(/only when they’re all Todoist exports/);
  });
});

describe('deadlines and reminders', () => {
  const header = 'TYPE,CONTENT,DESCRIPTION,PRIORITY,INDENT,DATE,DATE_LANG,DEADLINE,DEADLINE_LANG,REMINDER_TYPE,REMINDER_OFFSET,REMINDER_DATE,REMINDER_DATE_LANG';
  const convert = (line: string) =>
    readRows(convertTodoist([{ name: 'x.csv', table: parseCsv(`${header}\n${line}`) }], REF).table).find((r) => r.type === 'task')!;

  it('reads a deadline, and keeps one it can’t read, or one on a repeat, as text', () => {
    expect(convert('task,File taxes,,1,1,,,Dec 15,en,,,,').deadline).toBe('2026-12-15');
    expect(convert('task,File taxes,,1,1,,,soonish,en,,,,').notes).toBe('Todoist deadline: soonish');
    const repeating = convert('task,Pay bills,,1,1,every 1st,en,Dec 15,en,,,,');
    expect([repeating.deadline, repeating.notes]).toEqual([null, 'Todoist deadline: Dec 15']);
  });

  it('keeps a reminder as text, as tasks have no reminders yet', () => {
    expect(convert('task,Call Sam,,4,1,Nov 26,en,,,absolute,,Nov 26 9am,en').notes).toBe('Todoist reminder: Nov 26 9am');
  });
});
