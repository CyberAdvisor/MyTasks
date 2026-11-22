/**
 * Unscheduled shows a few tasks per group (FR-23.1): three by default, set in
 * Settings, with a grey Show All under a group that has more. Show All opens
 * that group, and its Show 3 closes it again; it closes too when the view changes.
 */
import { test, expect, type Page } from '@playwright/test';
import { addTask, connect, watchErrors } from './app';
import { fakeGitHub } from './fakeGitHub';

/** A project in the sidebar with `count` tasks, numbered from 1. */
async function projectWith(page: Page, title: string, count: number): Promise<void> {
  await page.getByRole('navigation', { name: 'Lists' }).getByRole('button', { name: 'New List' }).click();
  await page.getByRole('menuitem', { name: 'New Project' }).click();
  const field = page.getByPlaceholder('New Project');
  await field.fill(title);
  await field.press('Enter');
  for (let n = 1; n <= count; n++) await addTask(page, `${title} ${n}`);
}

const group = (page: Page, title: string) => page.locator('main section.group').filter({ has: page.getByRole('heading', { name: title }) });

test('three tasks per group until Show All; the setting changes it', async ({ page, context }) => {
  await fakeGitHub(context);
  const errors = watchErrors(page);
  await connect(page);
  await projectWith(page, 'Garden', 5);
  await projectWith(page, 'Garage', 2);

  await page.evaluate(() => (location.hash = '#/unscheduled'));
  const garden = group(page, 'Garden');
  const garage = group(page, 'Garage');
  await expect(garden.locator('.row')).toHaveCount(3);
  await expect(garden.locator('.row').last()).toContainText('Garden 3');
  await expect(garage.locator('.row')).toHaveCount(2);
  await expect(garage.getByRole('button', { name: 'Show All' })).toHaveCount(0);

  // Show All opens that group; Show 3 closes it again.
  await garden.getByRole('button', { name: 'Show All' }).click();
  await expect(garden.locator('.row')).toHaveCount(5);
  await expect(garden.getByRole('button', { name: 'Show All' })).toHaveCount(0);
  await garden.getByRole('button', { name: 'Show 3' }).click();
  await expect(garden.locator('.row')).toHaveCount(3);
  await expect(garden.getByRole('button', { name: 'Show All' })).toBeVisible();

  // Open, it stays open until the view changes.
  await garden.getByRole('button', { name: 'Show All' }).click();
  await expect(garden.locator('.row')).toHaveCount(5);
  await page.evaluate(() => (location.hash = '#/today'));
  await page.evaluate(() => (location.hash = '#/unscheduled'));
  await expect(garden.locator('.row')).toHaveCount(3);

  // Settings › Unscheduled: All shows every task, and the choice is kept.
  await page.evaluate(() => (location.hash = '#/settings'));
  const setting = page.getByLabel('Tasks shown per project');
  await expect(setting).toHaveValue('3');
  await setting.selectOption('All');
  await page.evaluate(() => (location.hash = '#/unscheduled'));
  await expect(garden.locator('.row')).toHaveCount(5);
  await page.reload();
  await expect(garden.locator('.row')).toHaveCount(5);
  // With All, no group has a button.
  await expect(page.locator('main .show-all')).toHaveCount(0);

  // 1 shows one per group.
  await page.evaluate(() => (location.hash = '#/settings'));
  await page.getByLabel('Tasks shown per project').selectOption('1');
  await page.evaluate(() => (location.hash = '#/unscheduled'));
  await expect(garden.locator('.row')).toHaveCount(1);
  await expect(garage.locator('.row')).toHaveCount(1);
  await expect(garage.getByRole('button', { name: 'Show All' })).toBeVisible();

  expect(errors).toEqual([]);
});
