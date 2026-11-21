/** Printing (FR-12.5): Print… in the ⋯ menu, and on paper only the list, at full length, with its date. */
import { expect, test } from '@playwright/test';
import { addTask, connect, openList } from './app';
import { fakeGitHub } from './fakeGitHub';

test('a printed list leaves off the sidebar and toolbar, runs its full length and is dated', async ({ page, context }) => {
  await fakeGitHub(context);
  await page.setViewportSize({ width: 1100, height: 400 });
  await connect(page);
  await openList(page, 'Inbox');
  for (let i = 1; i <= 12; i++) await addTask(page, `Task ${i}`);

  await page.getByRole('button', { name: 'More Inbox actions' }).click();
  await expect(page.getByRole('menuitem', { name: 'Print…' })).toBeVisible();
  await page.keyboard.press('Escape');

  await expect(page.getByText(/^Printed /)).toBeHidden();
  await page.emulateMedia({ media: 'print', colorScheme: 'dark' });
  await expect(page.getByRole('navigation', { name: 'Lists' })).toBeHidden();
  await expect(page.getByRole('toolbar', { name: 'Actions' })).toBeHidden();
  await expect(page.getByText(/^Printed /)).toBeVisible();

  // The list no longer scrolls in its own box, so the last task is on the page.
  const lastTop = await page.getByText('Task 12', { exact: true }).evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
  expect(lastTop).toBeGreaterThan(400);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThan(lastTop);

  // Black on white even when the system is dark.
  const color = await page.getByText('Task 1', { exact: true }).evaluate((el) => getComputedStyle(el).color);
  const [r, g, b] = color.match(/\d+/g)!.map(Number);
  expect(r + g + b).toBeLessThan(200);
});

test('in the installed iPhone app, Print… explains that it can’t print there', async ({ browser }) => {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1',
    viewport: { width: 1100, height: 700 },
  });
  await context.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
  await fakeGitHub(context);
  const page = await context.newPage();
  await connect(page);
  await openList(page, 'Inbox');
  await page.getByRole('button', { name: 'More Inbox actions' }).click();
  await page.getByRole('menuitem', { name: 'Print…' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Print from My Tasks on a Mac, or in Safari.', { exact: false })).toBeVisible();
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await context.close();
});
