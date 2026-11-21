/**
 * Tag helpers and tag operations (FR-6), and splitting pasted checklist text.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/lib/db/database';
import * as repo from '../src/lib/db/repo';
import { activeTag, effectiveTagIds, filterByTag, nextTagFilter, splitLines, tagPills, tagTree, tagsInUse } from '../src/lib/model/tags';
import { tagShortcut } from '../src/lib/shortcuts';
import { project, snap, snapshotOf, todo } from './helpers';

describe('tag and checklist helpers', () => {
  it('inherits tags from project and area for filtering', () => {
    const area = { id: 'area1', tagIds: ['home'] } as never;
    const p = project({ id: 'p1', areaId: 'area1', tagIds: ['errand'] });
    const t = todo({ projectId: 'p1', tagIds: ['quick'] });
    const loose = todo({ tagIds: [] });
    const s = snapshotOf({
      areas: [area],
      projects: [p],
      todos: [t, loose],
      tags: ['quick', 'errand', 'home', 'unused'].map((id, i) => ({ id, title: id, sortKey: `a${i}` }) as never),
    });
    expect([...effectiveTagIds(t, s)].sort()).toEqual(['errand', 'home', 'quick']);
    expect(filterByTag(s.todos, 'home', s)).toEqual([t]);
    expect(filterByTag(s.todos, null, s)).toHaveLength(2);
    expect(tagsInUse(s.todos, s).map((x) => x.id)).toEqual(['quick', 'errand', 'home']);
  });

  it('nests tags: filtering by a parent includes its children, and the bar opens a parent (FR-6.1b)', () => {
    const tag = (id: string, parentTagId: string | null, i: number) => ({ id, title: id, sortKey: `a${i}`, parentTagId }) as never;
    // errand > shop > hardware; next stands alone; loopA and loopB are nested under each other.
    const tags = [tag('errand', null, 0), tag('shop', 'errand', 1), tag('hardware', 'shop', 2), tag('next', null, 3), tag('loopA', 'loopB', 4), tag('loopB', 'loopA', 5)];
    const a = todo({ tagIds: ['errand'] });
    const b = todo({ tagIds: ['hardware'] });
    const c = todo({ tagIds: ['next'] });
    const s = snapshotOf({ todos: [a, b, c], tags });
    expect(filterByTag(s.todos, 'errand', s)).toEqual([a, b]);
    expect(filterByTag(s.todos, 'shop', s)).toEqual([b]);
    expect(tagTree(s.tags).map((x) => `${x.tag.id}:${x.depth}`)).toEqual(['errand:0', 'shop:1', 'hardware:2', 'next:0', 'loopA:0', 'loopB:1']);

    const used = tagsInUse(s.todos, s);
    const bar = (active: string | null) => tagPills(used, active, s.tags).map((p) => `${p.tag.id}${p.on ? '*' : ''}${p.more ? '…' : ''}`);
    expect(bar(null)).toEqual(['errand…', 'next']);
    expect(bar('errand')).toEqual(['errand*', 'shop…', 'next']);
    expect(bar('hardware')).toEqual(['errand*', 'shop*', 'hardware*', 'next']);
    // A parent stays a valid filter while a tag nested under it is in use.
    expect(activeTag('shop', used, s.tags)).toBe('shop');
    expect(activeTag('loopA', used, s.tags)).toBeNull();
    // Choosing the selected tag again goes back to its parent, or to All at the top.
    expect(nextTagFilter(null, 'hardware', s.tags)).toBe('hardware');
    expect(nextTagFilter('hardware', 'hardware', s.tags)).toBe('shop');
    expect(nextTagFilter('errand', 'errand', s.tags)).toBeNull();
    expect(nextTagFilter('hardware', 'errand', s.tags)).toBe('errand');
  });

  it('reads tag shortcut keys: Control on Apple devices, Alt elsewhere, never while typing (FR-6.4)', () => {
    const key = (code: string, mods: Partial<Record<'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey', boolean>>) =>
      ({ key: '', code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods }) as never;
    expect(tagShortcut(key('KeyE', { ctrlKey: true }), true, 'row')).toEqual({ kind: 'apply', key: 'E' });
    expect(tagShortcut(key('KeyE', { ctrlKey: true, altKey: true }), true, 'none')).toEqual({ kind: 'filter', key: 'E' });
    expect(tagShortcut(key('Digit4', { altKey: true }), false, 'row')).toEqual({ kind: 'apply', key: '4' });
    expect(tagShortcut(key('KeyE', { altKey: true, shiftKey: true }), false, 'row')).toEqual({ kind: 'filter', key: 'E' });
    expect(tagShortcut(key('KeyE', { ctrlKey: true }), true, 'text')).toBeNull();
    expect(tagShortcut(key('KeyE', { ctrlKey: true }), false, 'row')).toBeNull();
    expect(tagShortcut(key('KeyE', { metaKey: true, ctrlKey: true }), true, 'row')).toBeNull();
  });

  it('splits pasted text into checklist lines', () => {
    expect(splitLines('- Milk\r\n\n* Eggs\n[ ] Bread\n  Butter  ')).toEqual(['Milk', 'Eggs', 'Bread', 'Butter']);
  });
});

describe('tag operations', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('creates, reorders, assigns and deletes tags', async () => {
    const a = await repo.createTag('Errand');
    const b = await repo.createTag(' Home ');
    await repo.moveTag(b, 'up');
    let s = await snap();
    expect([...s.tags].sort((x, y) => (x.sortKey < y.sortKey ? -1 : 1)).map((t) => t.title)).toEqual(['Home', 'Errand']);

    const t = await repo.createTodo({ title: 'x' });
    // Quick successive changes must not overwrite each other.
    await Promise.all([repo.toggleTag('todos', t, a, true), repo.toggleTag('todos', t, b, true)]);
    await repo.toggleTag('todos', t, a, true); // already on: no change
    expect((await db.todos.get(t))!.tagIds).toEqual([a, b]);

    await repo.deleteTag(a);
    s = await snap();
    expect(s.tags.map((x) => x.id)).toEqual([b]);
    expect((await db.todos.get(t))!.tagIds).toEqual([b]);
  });

  it('nests tags, refuses loops and taken shortcut keys, and deletes a parent with its nested tags', async () => {
    const errand = await repo.createTag('Errand');
    const shop = await repo.createTag('Shop');
    const hardware = await repo.createTag('Hardware');
    const other = await repo.createTag('Other');
    expect(await repo.nestTag(shop, errand)).toBe(true);
    expect(await repo.nestTag(hardware, shop)).toBe(true);
    // Under itself or under a tag nested under it: refused.
    expect(await repo.nestTag(errand, hardware)).toBe(false);
    expect(await repo.nestTag(errand, errand)).toBe(false);
    expect((await db.tags.get(errand))!.parentTagId).toBeNull();
    // Up and down move among the tags at the same level.
    await repo.moveTag(other, 'up');
    await repo.moveTag(shop, 'up');
    expect(tagTree((await snap()).tags).map((x) => x.tag.title)).toEqual(['Other', 'Errand', 'Shop', 'Hardware']);
    expect(await repo.nestTag(hardware, null)).toBe(true);
    expect((await db.tags.get(hardware))!.parentTagId).toBeNull();
    await repo.nestTag(hardware, shop);

    expect(await repo.setTagShortcut(errand, 'e')).toBeNull();
    expect((await db.tags.get(errand))!.shortcut).toBe('E');
    expect((await repo.setTagShortcut(shop, 'E'))?.id).toBe(errand);
    expect((await db.tags.get(shop))!.shortcut).toBeNull();
    await repo.setTagShortcut(errand, null);
    expect((await db.tags.get(errand))!.shortcut).toBeNull();

    const t = await repo.createTodo({ title: 'x', tagIds: [hardware, other] });
    await repo.deleteTag(errand);
    expect((await snap()).tags.map((x) => x.id)).toEqual([other]);
    expect((await db.todos.get(t))!.tagIds).toEqual([other]);
  });
});
