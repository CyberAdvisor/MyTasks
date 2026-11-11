import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/lib/db/database';
import * as repo from '../src/lib/db/repo';
import { today } from '../src/lib/model/dates';
import {
  areaProjects,
  inboxTodos,
  logbookGroups,
  projectSections,
  todayTodos,
  trashTodos,
  unscheduledGroups,
} from '../src/lib/model/lists';
import { snap } from './helpers';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('to-dos', () => {
  it('creates new to-dos in the Inbox, in order', async () => {
    await repo.createTodo({ title: 'first' });
    await repo.createTodo({ title: 'second' });
    expect(inboxTodos(await snap()).map((t) => t.title)).toEqual(['first', 'second']);
  });

  it('moves between Inbox, Today, Deferred and back with When', async () => {
    const id = await repo.createTodo({ title: 'x' });
    await repo.setWhen(id, { kind: 'today' });
    let s = await snap();
    expect(todayTodos(s, today()).map((t) => t.id)).toEqual([id]);
    expect(inboxTodos(s)).toHaveLength(0);

    await repo.setWhen(id, { kind: 'deferred' });
    s = await snap();
    expect(s.todos[0].start).toBe('deferred');
    expect(todayTodos(s, today())).toHaveLength(0);

    await repo.setWhen(id, { kind: 'clear' });
    expect((await snap()).todos[0].start).toBe('inbox');
  });

  it('creates unfiled Unscheduled to-dos when asked', async () => {
    const id = await repo.createTodo({ start: 'unscheduled' });
    const s = await snap();
    expect(inboxTodos(s)).toHaveLength(0);
    expect(unscheduledGroups(s, today())[0].todos[0].id).toBe(id);
  });

  it('moves a to-do back to the Inbox', async () => {
    const projectId = await repo.createProject({ title: 'P' });
    const id = await repo.createTodo({ projectId });
    await repo.moveTodo(id, {});
    expect(inboxTodos(await snap()).map((t) => t.id)).toEqual([id]);
  });

  it('leaves the Inbox when moved into a project', async () => {
    const projectId = await repo.createProject({ title: 'P' });
    const id = await repo.createTodo({ title: 'x' });
    await repo.moveTodo(id, { projectId });
    const s = await snap();
    expect(inboxTodos(s)).toHaveLength(0);
    expect(unscheduledGroups(s, today())[0].title).toBe('P');
  });

  it('logs completed to-dos and restores them on uncheck', async () => {
    const id = await repo.createTodo({ title: 'x' });
    await repo.setTodoStatus(id, 'completed');
    let s = await snap();
    expect(logbookGroups(s, today())[0].todos[0].id).toBe(id);
    expect(inboxTodos(s)).toHaveLength(0);
    await repo.setTodoStatus(id, 'open');
    s = await snap();
    expect(inboxTodos(s)).toHaveLength(1);
    expect(s.todos[0].completedAt).toBeNull();
  });

  it('trashes, restores and permanently empties', async () => {
    const id = await repo.createTodo({ title: 'x' });
    await repo.setTodoTrashed(id, true);
    expect(trashTodos(await snap())).toHaveLength(1);
    await repo.setTodoTrashed(id, false);
    expect(inboxTodos(await snap())).toHaveLength(1);
    await repo.setTodoTrashed(id, true);
    await repo.emptyTrash();
    const row = await db.todos.get(id);
    expect(row?.deletedAt).not.toBeNull(); // tombstone kept for future sync
  });

  it('duplicates a to-do right after the original', async () => {
    const a = await repo.createTodo({ title: 'a' });
    await repo.createTodo({ title: 'b' });
    await repo.duplicateTodo(a);
    expect(inboxTodos(await snap()).map((t) => t.title)).toEqual(['a', 'a', 'b']);
  });

  it('records every change in the change log', async () => {
    const id = await repo.createTodo({ title: 'x' });
    await repo.updateTodoText(id, { title: 'y' });
    const log = await db.changeLog.toArray();
    expect(log.map((l) => l.fields)).toEqual([['*'], ['title']]);
  });
});

describe('projects, headings and areas', () => {
  it('completes a project and its open to-dos', async () => {
    const p = await repo.createProject({ title: 'P' });
    const t = await repo.createTodo({ projectId: p });
    await repo.closeProject(p, 'completed', 'canceled');
    expect((await db.todos.get(t))?.status).toBe('canceled');
    expect((await db.projects.get(p))?.status).toBe('completed');
  });

  it('groups project to-dos under headings and converts a heading to a project', async () => {
    const p = await repo.createProject({ title: 'P' });
    const h = await repo.createHeading(p, 'Phase 1');
    await repo.createTodo({ projectId: p, title: 'loose' });
    const t = await repo.createTodo({ projectId: p, headingId: h, title: 'under' });
    let sections = projectSections(await snap(), p);
    expect(sections.loose.map((x) => x.title)).toEqual(['loose']);
    expect(sections.headings[0].todos.map((x) => x.title)).toEqual(['under']);

    const newProject = await repo.convertHeadingToProject(h);
    expect((await db.todos.get(t))?.projectId).toBe(newProject);
    sections = projectSections(await snap(), p);
    expect(sections.headings).toHaveLength(0);
  });

  it('deleting an area can keep its contents', async () => {
    const a = await repo.createArea('Home');
    const t = await repo.createTodo({ areaId: a, title: 'x' });
    await repo.deleteArea(a, 'keep');
    const row = await db.todos.get(t);
    expect(row?.areaId).toBeNull();
    expect(row?.start).toBe('unscheduled'); // stays available, now unfiled
  });

  it('deleting an area can trash its contents', async () => {
    const a = await repo.createArea('Work');
    const p = await repo.createProject({ areaId: a });
    await repo.deleteArea(a, 'trash');
    expect((await db.projects.get(p))?.trashedAt).not.toBeNull();
  });

  it('area ⋯ menu: New Project goes last in the area; tags toggle on the area (FR-2.5)', async () => {
    const a = await repo.createArea('Home');
    const first = await repo.createProject({ areaId: a, title: 'First' });
    const added = await repo.createProject({ areaId: a });
    const s = await snap();
    expect(areaProjects(s, a).map((p) => p.id)).toEqual([first, added]);

    const tag = await repo.createTag('Errands');
    await repo.toggleTag('areas', a, tag, true);
    expect((await db.areas.get(a))?.tagIds).toEqual([tag]);
    await repo.toggleTag('areas', a, tag, false);
    expect((await db.areas.get(a))?.tagIds).toEqual([]);
  });
});
