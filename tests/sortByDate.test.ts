/**
 * Sort by date (FR-2.8, v1.1.12): a project (its tasks under no heading) and
 * each heading can list tasks by start date. Schema 8 adds `sortByDate` to
 * projects and headings; it syncs and isn't an undo step.
 */
import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { MyTasksDB, SCHEMA_VERSION, db } from '../src/lib/db/database';
import * as repo from '../src/lib/db/repo';
import { clearUndo, undo } from '../src/lib/db/history';
import { upgradeList } from '../src/lib/db/migrations';
import { byDate, projectSections } from '../src/lib/model/lists';
import { isValidRecord } from '../src/lib/sync/validate';
import type { Todo } from '../src/lib/model/types';
import { addDays, today } from '../src/lib/model/dates';
import { snap } from './helpers';

beforeEach(async () => {
  await db.delete();
  await db.open();
  clearUndo();
});

/** Today, and days after it, so the tests hold on any day. */
const REF = today();
const IN_3 = addDays(REF, 3);
const IN_6 = addDays(REF, 6);

/** Titles of the tasks under no heading, as the project page lists them today. */
async function loose(projectId: string): Promise<string[]> {
  return projectSections(await snap(), projectId, REF).loose.map((t) => t.title);
}

/** A project holding, in manual order: Active, In 6 a, Deferred, Today, In 3, In 6 b (start dates in days from today). */
async function sample(headingId: string | null = null, projectId?: string): Promise<string> {
  const p = projectId ?? (await repo.createProject({ title: 'Trip' }));
  const add = async (title: string, when?: repo.WhenChoice) => {
    const id = await repo.createTodo({ title, projectId: p, headingId });
    if (when) await repo.setWhen(id, when);
  };
  await add('Active');
  await add('In 6 a', { kind: 'date', date: IN_6 });
  await add('Deferred', { kind: 'deferred' });
  await add('Today', { kind: 'today' });
  await add('In 3', { kind: 'date', date: IN_3 });
  await add('In 6 b', { kind: 'date', date: IN_6 });
  return p;
}

const MANUAL = ['Active', 'In 6 a', 'Deferred', 'Today', 'In 3', 'In 6 b'];
const BY_DATE = ['Active', 'Today', 'In 3', 'In 6 a', 'In 6 b', 'Deferred'];

describe('sort by date (FR-2.8)', () => {
  it('is off by default, so manual order stays', async () => {
    const p = await sample();
    expect((await db.projects.get(p))?.sortByDate).toBe(false);
    expect(await loose(p)).toEqual(MANUAL);
  });

  it('lists active tasks in manual order, then later ones by start date, then deferred ones', async () => {
    const p = await sample();
    await repo.setProjectSortByDate(p, true);
    expect(await loose(p)).toEqual(BY_DATE);
    await repo.setProjectSortByDate(p, false);
    expect(await loose(p)).toEqual(MANUAL);
  });

  it('is chosen per heading, and tasks stay under their own heading', async () => {
    const p = await repo.createProject({ title: 'Trip' });
    const h = await repo.createHeading(p, 'Week 1');
    await sample(h, p);
    await sample(null, p);
    await repo.setHeadingSortByDate(h, true);
    const sec = projectSections(await snap(), p, REF);
    expect(sec.headings[0].todos.map((t) => t.title)).toEqual(BY_DATE);
    expect(sec.loose.map((t) => t.title)).toEqual(MANUAL);
  });

  it('sorts completed tasks waiting to move by their dates too', () => {
    const t = (title: string, start: Todo['start'], startDate: string | null, status: Todo['status'] = 'open') =>
      ({ title, start, startDate, status }) as Todo;
    const done = t('Done in 3', 'unscheduled', IN_3, 'completed');
    expect(byDate([t('Deferred', 'deferred', null), done, t('Active', 'unscheduled', null)], REF).map((x) => x.title)).toEqual([
      'Active',
      'Done in 3',
      'Deferred',
    ]);
  });

  it('keeps manual order where counts need it (no date given)', async () => {
    const p = await sample();
    await repo.setProjectSortByDate(p, true);
    expect(projectSections(await snap(), p).loose.map((t) => t.title)).toEqual(MANUAL);
  });

  it('saves as a synced change that undo leaves alone', async () => {
    const p = await sample();
    const h = await repo.createHeading(p, 'Week 1');
    const before = (await db.projects.get(p))!.modifiedAt;
    await new Promise((r) => setTimeout(r, 5));
    await repo.setProjectSortByDate(p, true);
    await repo.setHeadingSortByDate(h, true);
    expect((await db.projects.get(p))!.modifiedAt > before).toBe(true);
    await undo(); // undoes creating the heading, the last undo step
    expect((await db.projects.get(p))?.sortByDate).toBe(true);
  });

  it('is copied by Duplicate Project, and carried by Convert to Project', async () => {
    const p = await repo.createProject({ title: 'Trip' });
    await repo.setProjectSortByDate(p, true);
    const copy = (await repo.duplicateProject(p))!;
    expect((await db.projects.get(copy))?.sortByDate).toBe(true);
    const h = await repo.createHeading(p, 'Week 1');
    await repo.setHeadingSortByDate(h, true);
    const converted = (await repo.convertHeadingToProject(h))!;
    expect((await db.projects.get(converted))?.sortByDate).toBe(true);
  });
});

describe('schema 8', () => {
  const at = '2026-11-14T00:00:00.000Z';
  const base = { createdAt: at, modifiedAt: at, deletedAt: null, sortKey: 'a0' };
  const project = {
    id: 'p', ...base, title: 'Trip', notes: '', status: 'open', start: 'unscheduled', startDate: null, deadline: null,
    tagIds: [], areaId: null, completedAt: null, loggedAt: null, trashedAt: null,
  };
  const heading = { id: 'h', ...base, title: 'Week 1', projectId: 'p', archived: false, collapsed: true };

  it('upgrades a schema-7 list: projects and headings keep manual order, tombstones stay bare', () => {
    const gone = { id: 'g', deletedAt: at, modifiedAt: at };
    const old = {
      schema: 7,
      tables: { areas: [], projects: [project, gone], headings: [heading], todos: [], checklistItems: [], tags: [], contexts: [], savedSearches: [] },
    };
    // Through every later step too: schema 11 adds the repeat fields (FR-4.6).
    const list = upgradeList(old, SCHEMA_VERSION);
    expect(isValidRecord('projects', project)).toBe(false);
    expect(isValidRecord('headings', heading)).toBe(false);
    expect(list.tables.projects[0]).toEqual({ ...project, sortByDate: false, repeat: null, repeatOf: null, ft: {} });
    expect(list.tables.projects[1]).toEqual(gone);
    expect(list.tables.headings[0]).toEqual({ ...heading, sortByDate: false, ft: {} });
    expect(isValidRecord('projects', list.tables.projects[0])).toBe(true);
    expect(isValidRecord('headings', list.tables.headings[0])).toBe(true);
  });

  it('upgrades a version-7 database with data in it', async () => {
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(8);
    const name = 'upgrade-to-8';
    const old = new Dexie(name);
    old.version(7).stores({
      areas: 'id, sortKey',
      projects: 'id, areaId, status, sortKey',
      headings: 'id, projectId, sortKey',
      todos: 'id, projectId, areaId, headingId, status, startDate, deadline, sortKey, contextId',
      checklistItems: 'id, todoId, sortKey',
      tags: 'id, parentTagId, sortKey',
      savedSearches: 'id, sortKey',
      changeLog: '++seq, entity, entityId, at',
      settings: 'key',
      contexts: 'id, sortKey',
    });
    await old.open();
    await old.table('projects').add(project);
    await old.table('headings').add(heading);
    old.close();

    const upgraded = new MyTasksDB(name);
    await upgraded.open();
    expect(await upgraded.projects.get('p')).toEqual({ ...project, sortByDate: false, repeat: null, repeatOf: null, ft: {} });
    expect(await upgraded.headings.get('h')).toEqual({ ...heading, sortByDate: false, ft: {} });
    upgraded.close();
    await Dexie.delete(name);
  });
});
