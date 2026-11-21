/** The Move dialog's places and its filter (model/destinations.ts, review F10). */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/lib/db/database';
import * as repo from '../src/lib/db/repo';
import { destinations } from '../src/lib/model/destinations';
import { snap } from './helpers';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

const titles = (rows: { title: string; depth: number }[]) => rows.map((r) => `${'  '.repeat(r.depth)}${r.title}`);

describe('destinations', () => {
  async function setUp() {
    const home = await repo.createArea('Home');
    const kitchen = await repo.createProject({ title: 'Kitchen refresh', areaId: home });
    await repo.createHeading(kitchen, 'To order');
    await repo.createProject({ title: 'Garden', areaId: home });
    const loose = await repo.createProject({ title: 'Café ideas' });
    await repo.createHeading(loose, 'Menu');
  }

  it('lists the Inbox, areas with their projects and headings, then loose projects', async () => {
    await setUp();
    expect(titles(destinations(await snap()))).toEqual(['Inbox', 'Home', '  Kitchen refresh', '    To order', '  Garden', 'Café ideas', '  Menu']);
  });

  it('a filter keeps matches with the area and project above them, ignoring case and accents', async () => {
    await setUp();
    const s = await snap();
    expect(titles(destinations(s, 'ORDER'))).toEqual(['Home', '  Kitchen refresh', '    To order']);
    expect(titles(destinations(s, 'kit'))).toEqual(['Home', '  Kitchen refresh']);
    expect(titles(destinations(s, 'cafe'))).toEqual(['Café ideas']);
    expect(titles(destinations(s, 'menu'))).toEqual(['Café ideas', '  Menu']);
    expect(titles(destinations(s, 'inbox'))).toEqual(['Inbox']);
    expect(destinations(s, 'nothing here')).toEqual([]);
    // Only the matches count as matches; their area and project are there to show where they are.
    expect(destinations(s, 'order').map((d) => d.match)).toEqual([false, false, true]);
  });
});
