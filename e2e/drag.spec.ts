/**
 * Dragging tasks onto the sidebar's lists and between Today's groups
 * (FR-10.3b, FR-16.7): Today, Unscheduled and Deferred
 * set the start, Scheduled opens the Start Date picker beside it, Inbox
 * takes a task out of its project, Logbook takes no drop, and dragging one
 * of several selected tasks carries them all, with their count.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { addTask, connect, openList, watchErrors } from './app';
import { fakeGitHub } from './fakeGitHub';

/** Drag `from` and drop it on `to` with the mouse, in small steps. */
async function drag(page: Page, from: Locator, to: Locator): Promise<void> {
  await from.waitFor();
  await to.waitFor();
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 5, { steps: 3 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
}

/** Make a project with these tasks, and stay on it. */
async function project(page: Page, name: string, tasks: string[]): Promise<void> {
  await page.getByRole('navigation', { name: 'Lists' }).getByRole('button', { name: 'New List' }).click();
  await page.getByRole('menuitem', { name: 'New Project' }).click();
  const title = page.getByLabel('Project title');
  await expect(title).toHaveValue(''); // the new project's page, not the last one's
  await title.fill(name);
  await title.blur();
  for (const t of tasks) await addTask(page, t);
}

test('tasks dropped on the sidebar lists change their start, or move to the Inbox', async ({ context, page }) => {
  await fakeGitHub(context);
  const errors = watchErrors(page);
  await connect(page);
  const nav = page.getByRole('navigation', { name: 'Lists' });
  const list = (name: string) => nav.locator(`[data-list="${name}"]`);
  const row = (t: string) => page.locator('li.row', { hasText: t });
  await project(page, 'Garden', ['Buy compost', 'Plant bulbs', 'Fix the fence', 'Paint the shed', 'Rake leaves']);

  // Today: a star, and it stays in the project.
  await drag(page, row('Buy compost'), list('today'));
  await expect(row('Buy compost').getByRole('img', { name: 'Today' })).toBeVisible();

  // Scheduled: the Start Date picker opens beside the list; Escape changes nothing.
  await drag(page, row('Plant bulbs'), list('scheduled'));
  const picker = page.getByRole('dialog', { name: 'Start Date' });
  await expect(picker).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  await expect(row('Plant bulbs').locator('.when')).toHaveCount(0);
  await drag(page, row('Plant bulbs'), list('scheduled'));
  await picker.getByRole('button', { name: 'Tomorrow' }).click();
  await expect(row('Plant bulbs').locator('.when')).toHaveText(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/);

  // Deferred: a dashed checkbox.
  await drag(page, row('Fix the fence'), list('deferred'));
  await expect(row('Fix the fence').getByRole('checkbox')).toHaveClass(/deferred/);

  // Logbook takes no drop: nothing changes.
  await drag(page, row('Rake leaves'), list('logbook'));
  await expect(row('Rake leaves').getByRole('checkbox')).toHaveAttribute('aria-checked', 'false');

  // Inbox: out of the project.
  await drag(page, row('Paint the shed'), list('inbox'));
  await expect(row('Paint the shed')).toHaveCount(0);
  await openList(page, 'Inbox');
  await expect(row('Paint the shed')).toBeVisible();

  // Two selected tasks dragged together, with their count, then one Undo for both.
  await nav.getByRole('link', { name: 'Garden' }).click();
  await page.getByText('Rake leaves').click();
  await page.getByText('Plant bulbs').click({ modifiers: ['ControlOrMeta'] });
  const a = (await row('Rake leaves').boundingBox())!;
  const b = (await list('today').boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await expect(page.locator('.drag-ghost .drag-count')).toHaveText('2');
  await expect(list('today')).toHaveClass(/drop-target/);
  await page.mouse.up();
  for (const t of ['Rake leaves', 'Plant bulbs']) await expect(row(t).getByRole('img', { name: 'Today' })).toBeVisible();
  await expect(page.locator('li.row.selected')).toHaveCount(2);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(row('Rake leaves').getByRole('img', { name: 'Today' })).toHaveCount(0);
  await expect(row('Plant bulbs').locator('.when')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("a task dragged into another of Today's groups takes on its priority or project", async ({ context, page }) => {
  await fakeGitHub(context);
  const errors = watchErrors(page);
  await connect(page);
  const nav = page.getByRole('navigation', { name: 'Lists' });
  const row = (t: string) => page.locator('li.row', { hasText: t });
  await project(page, 'Garden', ['Buy compost']);
  await project(page, 'House', ['Fix the tap', 'Clean windows']);
  // All three in Today; Fix the tap is P1.
  await page.getByText('Fix the tap').click();
  await page.getByText('Clean windows').click({ modifiers: ['ControlOrMeta'] });
  await drag(page, row('Clean windows'), nav.locator('[data-list="today"]'));
  await nav.getByRole('link', { name: 'Garden' }).click();
  await drag(page, row('Buy compost'), nav.locator('[data-list="today"]'));
  await openList(page, 'Today');
  await page.getByText('Fix the tap').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Priority' }).click();
  await page.getByRole('menuitemradio').first().click();

  const groupBy = async (label: string) => {
    await page.getByRole('button', { name: 'More Today actions' }).click();
    await page.getByRole('menuitemradio', { name: label }).click();
  };
  const group = (title: string) => page.locator('section.group').filter({ has: page.getByRole('heading', { name: title }) });

  // By priority: into P1 sets P1.
  await groupBy('Priorities');
  await drag(page, row('Buy compost'), group('P1').locator('li.row').first());
  await expect(group('P1').locator('li.row')).toHaveCount(2);
  await expect(group('P1')).toContainText('Buy compost');

  // By project: into House moves it there.
  await groupBy('Projects');
  await drag(page, row('Buy compost'), group('House').locator('li.row').last());
  await expect(group('House')).toContainText('Buy compost');
  await expect(group('Garden')).toHaveCount(0);
  await nav.getByRole('link', { name: 'House' }).click();
  await expect(row('Buy compost')).toBeVisible();
  expect(errors).toEqual([]);
});

/** Press a sidebar item with an Apple Pencil (pen pointer events), move it by `dy` over `ms`, and lift. */
async function penDrag(page: Page, name: string, dy: number, holdMs: number): Promise<void> {
  const item = page.getByRole('navigation', { name: 'Lists' }).getByRole('link', { name, exact: true });
  const b = (await item.boundingBox())!;
  const x = b.x + b.width / 2;
  const y0 = b.y + b.height / 2;
  const send = (type: string, y: number) =>
    item.evaluate(
      (el, { type, x, y }) => {
        const target = type === 'pointerdown' ? el : document;
        target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: 'pen', isPrimary: true, pointerId: 3, clientX: x, clientY: y, buttons: type === 'pointerup' ? 0 : 1 }));
      },
      { type, x, y },
    );
  await send('pointerdown', y0);
  if (holdMs) await page.waitForTimeout(holdMs);
  for (let i = 1; i <= 6; i++) await send('pointermove', y0 + (dy * i) / 6);
  await send('pointerup', y0 + dy);
}

test('an Apple Pencil moves a sidebar project only after a long press', async ({ page, context }) => {
  await fakeGitHub(context);
  await connect(page);
  const projects = async () =>
    page.getByRole('navigation', { name: 'Lists' }).locator('li').filter({ has: page.getByRole('link') }).allTextContents();
  const nav = page.getByRole('navigation', { name: 'Lists' });
  for (const name of ['Alpha', 'Beta']) {
    await nav.getByRole('button', { name: 'New List' }).click();
    await page.getByRole('menuitem', { name: 'New Project' }).click();
    // The new project's page, not the last one's, before typing its name.
    await expect(page.getByLabel('Project title')).toHaveValue('');
    await page.getByLabel('Project title').fill(name);
    await page.getByLabel('Project title').blur();
    await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
  }
  await expect(nav.getByRole('link', { name: 'Beta', exact: true })).toBeVisible();
  const order = (await projects()).filter((t) => /Alpha|Beta/.test(t)).map((t) => t.trim());
  expect(order).toEqual(['Alpha', 'Beta']);

  // A quick stroke down over Beta doesn't reorder anything.
  await penDrag(page, 'Alpha', 40, 0);
  await page.waitForTimeout(300);
  expect((await projects()).filter((t) => /Alpha|Beta/.test(t)).map((t) => t.trim())).toEqual(['Alpha', 'Beta']);

  // Held first, it drags.
  await penDrag(page, 'Alpha', 40, 600);
  await expect.poll(async () => (await projects()).filter((t) => /Alpha|Beta/.test(t)).map((t) => t.trim())).toEqual(['Beta', 'Alpha']);
});
