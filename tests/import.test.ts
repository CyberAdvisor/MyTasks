/**
 * Import (FR-12.6, FR-12.9; v1.4.0): the CSV reader, the row checks, the
 * plan's matching and placing, repeats, the website's template and sample
 * files, the task limit and undo. Repeating projects (FR-4.6; v1.6.2).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/lib/db/database';
import * as repo from '../src/lib/db/repo';
import { clearUndo, undo } from '../src/lib/db/history';
import { today } from '../src/lib/model/dates';
import { inToday, inDeferred, inInbox } from '../src/lib/model/lists';
import { bySortKey } from '../src/lib/model/order';
import { MAX_TASKS, TaskLimitError } from '../src/lib/model/limits';
import { isValidRecord } from '../src/lib/sync/validate';
import { CsvError, parseCsv } from '../src/lib/import/csv';
import { ImportError, readRows } from '../src/lib/import/rows';
import { planCounts, planMatches, prepareImport } from '../src/lib/import';
import { todo } from './helpers';
import type { EntityName } from '../src/lib/model/types';
import SAMPLE from '../site/assets/import/mytasks-import-sample.csv?raw';
import TEMPLATE from '../site/assets/import/mytasks-import-template.csv?raw';
import IMPORT_PAGE from '../site/import/index.html?raw';

const read = (csv: string) => readRows(parseCsv(csv));
const problem = (csv: string) => {
  try {
    read(csv);
  } catch (e) {
    return (e as Error).message;
  }
  return 'no problem';
};
const live = async <T extends { deletedAt: string | null }>(rows: Promise<T[]>) => (await rows).filter((r) => r.deletedAt === null);
const todos = () => live(db.todos.toArray());
const byTitle = async (title: string) => (await todos()).find((t) => t.title === title)!;
const importCsv = (csv: string) => repo.importRows(read(csv));

beforeEach(async () => {
  await db.delete();
  await db.open();
  clearUndo();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the CSV reader', () => {
  it('reads quotes, commas and line breaks inside quotes, CRLF and the byte-order mark', () => {
    const text = '﻿type,title,notes\r\ntask,"Buy milk, eggs","Line one\nLine ""two"""\r\n\r\ntask,Plain,\r\n';
    expect(parseCsv(text)).toEqual([
      ['type', 'title', 'notes'],
      ['task', 'Buy milk, eggs', 'Line one\nLine "two"'],
      ['task', 'Plain', ''],
    ]);
  });

  it('refuses a quote that is never closed', () => {
    expect(() => parseCsv('type,title\ntask,"open')).toThrow(CsvError);
  });
});

describe('the row checks', () => {
  it('names the row and the problem', () => {
    expect(problem('type,title,deadine\ntask,A,')).toMatch(/^Row 1: “deadine” isn’t a column/);
    expect(problem('type,title\nnote,A')).toBe('Row 2: “note” isn’t a type: use area, project, heading, task or checklist.');
    expect(problem('type,title\ntask,')).toBe('Row 2: The title is empty.');
    expect(problem('type,title,deadline\ntask,A,2026-02-30')).toMatch(/^Row 2: deadline “2026-02-30” isn’t a date/);
    expect(problem('type,title,priority\ntask,A,6')).toMatch(/^Row 2: priority should be/);
    expect(problem('type,title,priority\nproject,A,1')).toBe('Row 2: priority isn’t used on a project row.');
    expect(problem('type,title,start\ntask,A,date')).toBe('Row 2: start is date, but start_date is empty.');
    expect(problem('type,title\nchecklist,A')).toMatch(/^Row 2: A checklist row needs a task row above it/);
    expect(problem('type,id,title\ntask,x,A\ntask,x,B')).toBe('Row 3: The id “x” is used on an earlier row.');
    expect(problem('type,title')).toBe('The file has a header but no rows.');
    expect(problem('')).toBe('The file is empty.');
  });

  it('checks the repeat columns', () => {
    expect(problem('type,title,repeat,repeat_unit\ntask,A,regularly,fortnight')).toMatch(/repeat_unit should be/);
    expect(problem('type,title,repeat_unit\ntask,A,week')).toMatch(/repeat_unit is used only on a repeating task/);
    expect(problem('type,title,repeat,repeat_unit,repeat_weekdays\ntask,A,regularly,month,mon')).toMatch(/only on a regular weekly/);
    expect(problem('type,title,repeat,repeat_unit,repeat_ends_after\ntask,A,after_completion,week,3')).toMatch(/can’t have an end/);
    expect(problem('type,title,repeat,repeat_unit,deadline\ntask,A,regularly,week,2026-12-01')).toMatch(/takes its dates from its rule/);
    expect(problem('type,title,repeat,repeat_unit,repeat_month_day\ntask,A,regularly,month,2nd')).toMatch(/needs a day/);
    // A project repeats with the same columns and checks (FR-4.6).
    expect(read('type,title,repeat,repeat_unit\nproject,P,regularly,week')[0].repeat).toMatchObject({ unit: 'week' });
    expect(problem('type,title,repeat,repeat_unit,start_date\nproject,P,regularly,week,2026-12-01')).toMatch(/A repeating project takes its dates from its rule/);
    expect(problem('type,title,repeat,repeat_unit,status\nproject,P,regularly,week,completed')).toMatch(/A repeating project must be open/);
  });

  it('reads days of the month, weekdays and a start date given alone', () => {
    const [r] = read('type,title,repeat,repeat_unit,repeat_month_day\ntask,A,regularly,month,2nd tue;last;15;last fri');
    expect(r.repeat!.days).toEqual([
      { ordinal: 2, weekday: 2 },
      { ordinal: -1, weekday: null },
      { ordinal: 15, weekday: null },
      { ordinal: -1, weekday: 5 },
    ]);
    const [w] = read('type,title,repeat,repeat_unit,repeat_weekdays\ntask,A,regularly,week,Monday;thu');
    expect(w.repeat!.weekdays).toEqual([1, 4]);
    const [d] = read('type,title,start_date\ntask,A,2026-12-03');
    expect(d.start).toBe('date');
  });
});

describe('importing', () => {
  it('imports the website’s sample: a project with headings in order, a checklist, four repeats and a repeating project', async () => {
    const plan = await importCsv(SAMPLE);
    expect(planCounts(plan)).toBe('11 tasks, 2 projects, 2 headings, 2 areas and 3 checklist items');

    const project = (await live(db.projects.toArray())).find((p) => p.title === 'Kitchen refresh')!;
    expect(project.title).toBe('Kitchen refresh');
    expect(project.deadline).toBe('2026-12-20');
    const areas = await live(db.areas.toArray());
    expect(project.areaId).toBe(areas.find((a) => a.title === 'Home')!.id);
    const headings = bySortKey(await live(db.headings.toArray()));
    expect(headings.map((h) => h.title)).toEqual(['Choose', 'Do']);
    const inChoose = bySortKey((await todos()).filter((t) => t.headingId === headings[0].id && !t.repeatOf));
    expect(inChoose.map((t) => t.title)).toEqual(['Pick a cabinet colour', 'Order handles']);

    const colour = await byTitle('Pick a cabinet colour');
    expect(inToday(colour, today())).toBe(true);
    expect(colour.priority).toBe(2);
    const items = bySortKey((await live(db.checklistItems.toArray())).filter((c) => c.todoId === colour.id));
    expect(items.map((c) => [c.title, c.completed])).toEqual([
      ['Get sample pots', true],
      ['Paint test patches', false],
      ['Decide in daylight', false],
    ]);
    expect(inDeferred(await byTitle('Paint the cabinets'))).toBe(true);
    expect(inInbox(await byTitle('Idea: a newsletter for launch day'))).toBe(true);
    expect((await live(db.contexts.toArray())).map((c) => c.title)).toEqual(['Phone']);

    const plants = await byTitle('Water the plants');
    expect(plants.repeat).toMatchObject({ mode: 'fixed', unit: 'week', weekdays: [1, 4] });
    const meeting = await byTitle('Team planning meeting notes');
    expect(meeting.repeat).toMatchObject({ unit: 'month', days: [{ ordinal: 2, weekday: 2 }], endCount: 12 });
    expect(meeting.startDate).toBe('2026-12-08');
    const filter = await byTitle('Replace the furnace filter');
    expect(filter.repeat).toMatchObject({ mode: 'afterCompletion', unit: 'month', interval: 3, deadlineDays: 7 });
    const car = await byTitle('Renew car registration');
    expect(car.repeat).toMatchObject({ unit: 'year', month: 3, days: [{ ordinal: 15, weekday: null }] });
    expect(car.startDate).toBe('2027-03-15');

    // The repeating project is the template, on its first date; its tasks keep no dates, and no copy is due yet.
    const review = (await live(db.projects.toArray())).find((p) => p.title === 'Weekly review')!;
    expect(review.repeat).toMatchObject({ mode: 'fixed', unit: 'week', weekdays: [5] });
    expect(review.startDate).toBe('2026-12-04');
    const reviewTasks = bySortKey((await todos()).filter((t) => t.projectId === review.id));
    expect(reviewTasks.map((t) => [t.title, t.startDate])).toEqual([['Clear the inbox', null], ['Plan next week', null]]);
    expect((await live(db.projects.toArray())).some((p) => p.repeatOf === review.id)).toBe(false);

    // Every record passes the gist's checks, so it syncs.
    for (const name of ['areas', 'projects', 'headings', 'todos', 'checklistItems', 'tags', 'contexts'] as EntityName[]) {
      for (const r of await db.table(name).toArray()) expect(isValidRecord(name, r), `${name} ${r.title}`).toBe(true);
    }
  });

  it('refuses the empty template, which has only its header', () => {
    expect(problem(TEMPLATE)).toBe('The file has a header but no rows.');
  });

  it('adds to areas, projects, headings, tags and contexts with the same name, ignoring capitals', async () => {
    const areaId = await repo.createArea('Home');
    const projectId = await repo.createProject({ title: 'Garden', areaId });
    await repo.createHeading(projectId, 'Spring');
    await repo.createTag('Errand');
    await repo.createContext('Phone');
    const { plan } = await prepareImport(
      'type,title,area,project,heading,tags,context\ntask,Plant bulbs,,garden,spring,errand,phone\ntask,Sweep,HOME,,,,',
    );
    expect(planMatches(plan)).toBe('1 area, 1 project, 1 heading, 1 tag and 1 context you already have');
    await importCsv('type,title,area,project,heading,tags,context\ntask,Plant bulbs,,garden,spring,errand,phone\ntask,Sweep,HOME,,,,');
    expect((await live(db.areas.toArray())).length).toBe(1);
    expect((await live(db.headings.toArray())).length).toBe(1);
    const bulbs = await byTitle('Plant bulbs');
    expect(bulbs.projectId).toBe(projectId);
    expect((await byTitle('Sweep')).areaId).toBe(areaId);
  });

  it('makes a new one when two existing ones share the name', async () => {
    await repo.createArea('Home');
    await repo.createArea('home');
    await importCsv('type,title,area\ntask,A,Home');
    expect((await live(db.areas.toArray())).length).toBe(3);
  });

  it('nests tags written as a path, reusing the ones that exist', async () => {
    const errand = await repo.createTag('Errand');
    await importCsv('type,title,tags\ntask,A,Errand/Shop; Errand/Shop/Hardware');
    const tags = await live(db.tags.toArray());
    const shop = tags.find((t) => t.title === 'Shop')!;
    const hardware = tags.find((t) => t.title === 'Hardware')!;
    expect(shop.parentTagId).toBe(errand);
    expect(hardware.parentTagId).toBe(shop.id);
    expect((await byTitle('A')).tagIds).toEqual([shop.id, hardware.id]);
  });

  it('links rows by id, pointing forward too, and puts checklist rows under the task above', async () => {
    await importCsv(
      [
        'type,id,parent_id,title',
        'task,t1,p1,Write the brief',
        'checklist,,,Outline',
        'checklist,c2,t1,Draft',
        'heading,h1,p1,Later',
        'task,t2,h1,Send it',
        'project,p1,a1,Launch',
        'area,a1,,Work',
      ].join('\n'),
    );
    const area = (await live(db.areas.toArray()))[0];
    const project = (await live(db.projects.toArray()))[0];
    expect(project.areaId).toBe(area.id);
    const brief = await byTitle('Write the brief');
    expect(brief.projectId).toBe(project.id);
    expect((await live(db.checklistItems.toArray())).filter((c) => c.todoId === brief.id).length).toBe(2);
    expect((await byTitle('Send it')).headingId).toBe((await live(db.headings.toArray()))[0].id);
  });

  it('refuses a parent_id of the wrong kind or that no row has', async () => {
    await expect(importCsv('type,id,parent_id,title\narea,a1,,Work\nheading,,a1,Later')).rejects.toThrow(/is a area; a heading goes in a project/);
    await expect(importCsv('type,parent_id,title\ntask,nope,A')).rejects.toThrow(/isn’t the id of any row/);
  });

  it('places tasks by start: a past date is Today; the Inbox with an area is Unscheduled', async () => {
    await importCsv('type,title,area,start,start_date\ntask,Past,,date,2020-01-01\ntask,Filed,Home,inbox,\ntask,Later,,date,2099-01-01');
    expect(inToday(await byTitle('Past'), today())).toBe(true);
    expect((await byTitle('Filed')).start).toBe('unscheduled');
    expect(inToday(await byTitle('Later'), today())).toBe(false);
  });

  it('imports a deferred row with a start date as scheduled on that date', async () => {
    await importCsv('type,title,start,start_date\ntask,Book a table,deferred,2099-12-18\ntask,Someday,deferred,');
    const dated = await byTitle('Book a table');
    expect([dated.start, dated.startDate]).toEqual(['unscheduled', '2099-12-18']);
    expect(inDeferred(dated)).toBe(false);
    expect(inDeferred(await byTitle('Someday'))).toBe(true);
  });

  it('sends completed rows straight to Completed, on their date', async () => {
    await importCsv('type,title,status,completed_date\ntask,Done,completed,2026-10-01');
    const done = await byTitle('Done');
    expect(done.status).toBe('completed');
    expect(done.loggedAt).toBe(done.completedAt);
    expect(new Date(done.completedAt!).getDate()).toBe(1);
  });

  it('is one undo step', async () => {
    await importCsv('type,title,project,tags\ntask,A,P,T\ntask,B,P,');
    expect((await todos()).length).toBe(2);
    await undo();
    expect((await todos()).length).toBe(0);
    expect((await live(db.projects.toArray())).length).toBe(0);
    expect((await live(db.tags.toArray())).length).toBe(0);
  });

  it('is refused past the task limit, changing nothing', async () => {
    await db.todos.bulkAdd(Array.from({ length: MAX_TASKS - 1 }, (_, i) => todo({ id: `t${i}`, sortKey: `a${i}` })));
    await expect(importCsv('type,title,area\ntask,A,Work\ntask,B,Work')).rejects.toThrow(TaskLimitError);
    expect((await live(db.areas.toArray())).length).toBe(0);
  });

  it('makes a repeating task’s copy when it has come due, as the Repeat dialog does', async () => {
    await importCsv('type,title,repeat,repeat_unit\ntask,Daily,regularly,day');
    const all = await todos();
    const template = all.find((t) => t.repeat)!;
    expect(all.filter((t) => t.repeatOf === template.id).length).toBe(1);
  });

  it('gives a repeating task’s copy the priority it was imported with, not Default P2', async () => {
    await importCsv('type,title,repeat,repeat_unit,priority\ntask,Daily,regularly,day,1');
    const all = await todos();
    const template = all.find((t) => t.repeat)!;
    expect(template.priority).toBe(1);
    expect(all.find((t) => t.repeatOf === template.id)!.priority).toBe(1);
  });

  it('makes one copy for a first date already past, as for an open copy exported from Things', async () => {
    const d = new Date(); d.setDate(d.getDate() - 3);
    const past = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    await importCsv(`type,title,repeat,repeat_unit,repeat_first\ntask,Daily,regularly,day,${past}`);
    const all = await todos();
    const template = all.find((t) => t.repeat)!;
    const copies = all.filter((t) => t.repeatOf === template.id);
    expect(copies.length).toBe(1);
    expect(inToday(copies[0], today())).toBe(true);
  });
});

describe('importing repeating projects (FR-4.6, v1.6.2)', () => {
  it('makes the first copy when it is due, its tasks with it; the template keeps its own', async () => {
    await importCsv('type,title,project,repeat,repeat_unit\nproject,Daily review,,regularly,day\ntask,Check mail,Daily review,,');
    const projects = await live(db.projects.toArray());
    const template = projects.find((p) => p.repeat)!;
    const copy = projects.find((p) => p.repeatOf === template.id)!;
    expect(copy.startDate).toBe(today());
    expect((await todos()).filter((t) => t.title === 'Check mail').map((t) => t.projectId).sort()).toEqual([copy.id, template.id].sort());
  });

  it('refuses a dated or repeating task in a repeating project, naming the row', async () => {
    const head = 'type,title,project,repeat,repeat_unit,start,start_date,deadline\nproject,R,,regularly,week,,,\n';
    await expect(importCsv(`${head}task,Dated,R,,,date,2026-12-01,`)).rejects.toThrow(/Row 3: A task in a repeating project takes no start date/);
    await expect(importCsv(`${head}task,Due,R,,,,,2026-12-01`)).rejects.toThrow(/takes no start date, deadline or repeat/);
    await expect(importCsv(`${head}task,Again,R,regularly,day,,,`)).rejects.toThrow(/takes no start date, deadline or repeat/);
    expect(await live(db.projects.toArray())).toHaveLength(0);
  });

  it('puts a task naming the file’s own repeating project in it, even when older projects share the name', async () => {
    await repo.createProject({ title: 'Review' });
    await repo.createProject({ title: 'Review' });
    const file = 'type,title,project,repeat,repeat_unit,repeat_first,deadline\nproject,Review,,regularly,week,2030-01-04,\n';
    await expect(importCsv(`${file}task,Dated,Review,,,,2026-12-01`)).rejects.toThrow(/Row 3: A task in a repeating project/);
    await importCsv(`${file}task,Plain,Review,,,,`);
    const template = (await live(db.projects.toArray())).find((p) => p.repeat)!;
    expect((await byTitle('Plain')).projectId).toBe(template.id);
  });

  it('makes a new project for a repeating row, even when one has the same name', async () => {
    await repo.createProject({ title: 'Weekly review' });
    await importCsv('type,title,repeat,repeat_unit,repeat_first\nproject,Weekly review,regularly,week,2030-01-04');
    const projects = await live(db.projects.toArray());
    expect(projects.filter((p) => p.title === 'Weekly review').map((p) => !!p.repeat).sort()).toEqual([false, true]);
  });
});

describe('the website’s template', () => {
  it('has every column the reader knows, in the order the Import page lists them', () => {
    const header = TEMPLATE.trim().split(',');
    const listed = [...IMPORT_PAGE.matchAll(/<tr><td><code>([a-z_]+)<\/code>/g)].map((m) => m[1]);
    expect(new Set(listed)).toEqual(new Set(header));
    // Every listed column is one the reader accepts.
    expect(() => read(`${header.join(',')}\n${['task', ...Array(header.length - 1).fill('')].join(',').replace('task,', 'task,,,X,')}`)).not.toThrow(
      ImportError,
    );
  });
});
