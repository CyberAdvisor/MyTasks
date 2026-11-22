/**
 * When marks on task rows (Section 6, Row): a star for Today, a grey date
 * label for a later date and a dashed checkbox for Deferred, left off where
 * the list already says it. An Inbox task given a start date stays in the
 * Inbox, with its new mark, under "1 task moved out of the Inbox" until OK;
 * adding one with a start date from the new-task box says
 * where it went, with Show (FR-1.10). On wider screens rows keep the
 * context's name, the priority chip and the deadline in full.
 */
import { expect, test, type Page } from '@playwright/test';
import { addTask, connect, openList, restoreSample, watchErrors } from './app';
import { fakeGitHub } from './fakeGitHub';

/** Set a task's When from its right-click menu. */
async function setWhen(page: Page, title: string, choice: string): Promise<void> {
  await page.getByText(title, { exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Start Date…' }).click();
  await page.getByRole('button', { name: choice }).click();
}

test('rows show a star, a date label or a dashed checkbox for their When', async ({ context, page }) => {
  await fakeGitHub(context);
  const errors = watchErrors(page);
  await connect(page);
  const nav = page.getByRole('navigation', { name: 'Lists' });

  await nav.getByRole('button', { name: 'New List' }).click();
  await page.getByRole('menuitem', { name: 'New Project' }).click();
  const title = page.getByLabel('Project title');
  await title.fill('Garden');
  await title.blur();
  for (const t of ['Buy compost', 'Plant bulbs', 'Build a greenhouse', 'Fix the fence']) await addTask(page, t);
  // With a mouse, rows are 34 px high (Section 6, Row; since 1.8.3).
  const fence = page.locator('li.row').filter({ hasText: 'Fix the fence' });
  expect(Math.round((await fence.boundingBox())!.height)).toBe(34);
  // The column starts near the sidebar, not centred: the checkbox 76 px from its edge (since 1.1.17).
  const sidebarEdge = (await nav.boundingBox())!.width;
  const box = (await fence.getByRole('checkbox').boundingBox())!;
  expect(Math.round(box.x - sidebarEdge)).toBe(76);
  await setWhen(page, 'Buy compost', 'Today');
  await setWhen(page, 'Plant bulbs', 'Tomorrow');
  await setWhen(page, 'Build a greenhouse', 'Deferred');

  const row = (t: string) => page.locator('li.row', { hasText: t });
  await expect(row('Buy compost').getByRole('img', { name: 'Today' })).toBeVisible();
  await expect(row('Plant bulbs').locator('.when')).toHaveText(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/);
  await expect(row('Build a greenhouse').getByRole('checkbox')).toHaveClass(/deferred/);
  // Unscheduled: no mark.
  await expect(row('Fix the fence').getByRole('img', { name: 'Today' })).toHaveCount(0);
  await expect(row('Fix the fence').locator('.when')).toHaveCount(0);
  await expect(row('Fix the fence').getByRole('checkbox')).not.toHaveClass(/deferred/);
  // A project's tasks weren't in the Inbox: no "where it went" message.
  await expect(page.locator('.toast')).toHaveCount(0);

  // Today doesn't star its own tasks, and they aren't in Unscheduled.
  await openList(page, 'Today');
  await expect(row('Buy compost')).toBeVisible();
  await expect(row('Buy compost').getByRole('img', { name: 'Today' })).toHaveCount(0);
  await openList(page, 'Unscheduled');
  await expect(row('Fix the fence')).toBeVisible();
  await expect(row('Buy compost')).toHaveCount(0);

  // An Inbox task given a later date stays, marked, under the bar, until OK;
  // the sidebar's count drops at once.
  await openList(page, 'Inbox');
  await addTask(page, 'Call Sam');
  await setWhen(page, 'Call Sam', 'Tomorrow');
  const bar = page.getByRole('status').filter({ hasText: 'moved out of the Inbox' });
  await expect(bar).toHaveText(/1 task moved out of the Inbox/);
  await expect(row('Call Sam').locator('.when')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Inbox', exact: true })).toBeVisible();
  const toast = page.locator('.toast');
  await expect(toast).toHaveCount(0);
  await bar.getByRole('button', { name: 'OK' }).click();
  await expect(row('Call Sam')).toHaveCount(0);
  await expect(bar).toHaveCount(0);
  // Another list lets them go too.
  await addTask(page, 'Call Ann');
  await setWhen(page, 'Call Ann', 'Tomorrow');
  await expect(bar).toBeVisible();
  await openList(page, 'Scheduled');
  await openList(page, 'Inbox');
  await expect(row('Call Ann')).toHaveCount(0);

  // The new-task box, with Start Date Today, from the Inbox: "Added to Today", on one line.
  await openList(page, 'Inbox');
  await page.getByRole('toolbar', { name: 'Actions' }).getByRole('button', { name: 'New Task' }).click();
  const entry = page.getByRole('dialog', { name: 'Quick Entry' });
  await entry.getByPlaceholder('New Task').fill('Water plants');
  await entry.getByRole('button', { name: 'Start Date', exact: true }).click();
  await page.getByRole('dialog', { name: 'Start Date', exact: true }).getByRole('button', { name: 'Today' }).click();
  await entry.getByRole('button', { name: 'Save' }).click();
  await expect(toast).toContainText('Added to Today');
  expect(Math.round((await toast.boundingBox())!.height)).toBeLessThan(50);
  await toast.getByRole('button', { name: 'Show' }).click();
  await expect(row('Water plants')).toBeVisible();

  expect(errors).toEqual([]);
});

test("on wider screens rows keep the context's name, the priority chip and the deadline in full (since 1.3.1)", async ({ page, context }) => {
  // Phone rows show these as icons and a short deadline (phone.spec.ts); a Mac or iPad has the room.
  await fakeGitHub(context);
  await connect(page);
  await restoreSample(page);
  await page.evaluate(() => (location.hash = '#/today'));
  const review = page.locator('li.row').filter({ hasText: 'Review homepage copy' });
  await expect(review.locator('.aside .context')).toHaveText('Computer');
  await expect(review.locator('.aside .prio')).toHaveText('P1');
  await expect(review.getByLabel('Context: Computer')).toBeHidden();
  await expect(review.getByText('2/3')).toBeVisible();
  const flights = page.locator('li.row').filter({ hasText: 'Book flights to Lisbon' });
  await expect(flights.getByText('2 days left')).toBeVisible();
  await expect(flights.getByText('2d left')).toBeHidden();
});
