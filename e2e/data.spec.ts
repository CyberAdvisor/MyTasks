/**
 * Changes to several records at once, in a real browser's IndexedDB. Dexie
 * can commit a transaction too early there (DEVELOPMENT.md, Data), which the
 * unit tests' in-memory database never shows: Duplicate Project failed this
 * way before 0.4.2, and Empty Trash with several items before 0.4.1.
 */
import { expect, test } from '@playwright/test';
import { addTask, connect, openList, watchErrors } from './app';
import { fakeGitHub } from './fakeGitHub';

test.beforeEach(async ({ page, context }) => {
  await fakeGitHub(context);
  await connect(page);
});

test('Duplicate Project copies the project and its tasks', async ({ page }) => {
  const errors = watchErrors(page);
  const lists = page.getByRole('navigation', { name: 'Lists' });
  await lists.getByRole('button', { name: 'New List' }).click();
  await page.getByRole('menuitem', { name: 'New Project' }).click();
  const title = page.getByPlaceholder('New Project');
  await title.fill('Garden');
  await title.press('Enter');
  // Tasks without checklists: the case that failed before 0.4.2.
  await addTask(page, 'Plant tulips');
  await addTask(page, 'Mulch the beds');

  await page.getByRole('button', { name: 'More project actions' }).click();
  await page.getByRole('menuitem', { name: 'Duplicate Project' }).click();

  await expect(lists.getByRole('link', { name: 'Garden' })).toHaveCount(2);
  await lists.getByRole('link', { name: 'Garden' }).nth(1).click();
  await expect(page.getByText('Plant tulips')).toBeVisible();
  await expect(page.getByText('Mulch the beds')).toBeVisible();
  expect(errors).toEqual([]);
});

test('Empty Trash with several items empties it', async ({ page }) => {
  const errors = watchErrors(page);
  await openList(page, 'Inbox');
  const titles = ['Old receipt', 'Expired coupon', 'Spare note'];
  for (const t of titles) await addTask(page, t);
  for (const t of titles) {
    await page.getByText(t).click();
    await page.keyboard.press('Delete');
    await expect(page.getByText(t)).toBeHidden();
  }

  await openList(page, 'Trash');
  for (const t of titles) await expect(page.getByText(t)).toBeVisible();
  await page.getByRole('button', { name: 'Empty Trash' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Empty Trash' }).click();
  await expect(page.getByText('Trash is empty.')).toBeVisible();
  for (const t of titles) await expect(page.getByText(t)).toBeHidden();
  expect(errors).toEqual([]);
});
