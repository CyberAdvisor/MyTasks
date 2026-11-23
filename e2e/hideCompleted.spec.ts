/**
 * Today's Hide / Show button for completed tasks: after the ⋯, only when
 * there is something to hide, and shown again whenever the app opens.
 */
import { expect, test } from '@playwright/test';
import { addTask, connect, openList } from './app';
import { fakeGitHub } from './fakeGitHub';

test('Today hides and shows its completed tasks, and shows them again after a reload', async ({ page, context }) => {
  await fakeGitHub(context);
  await connect(page);
  await openList(page, 'Today');
  await addTask(page, 'Water the plants');
  await addTask(page, 'Feed the cat');
  const button = page.getByRole('button', { name: /^(Hide|Show)$/ });
  // Nothing completed yet: no button.
  await expect(button).toHaveCount(0);

  await page.getByRole('checkbox', { name: 'Complete: Feed the cat' }).click();
  // The task stays, struck through, for its 2 seconds; then Hide appears.
  await expect(page.getByRole('button', { name: 'Hide' })).toBeVisible({ timeout: 5000 });
  await page.getByRole('button', { name: 'Hide' }).click();
  await expect(page.getByText('Feed the cat')).toHaveCount(0);
  await expect(page.getByText('Water the plants')).toBeVisible();

  await page.getByRole('button', { name: 'Show' }).click();
  await expect(page.getByText('Feed the cat')).toBeVisible();

  // Hidden, then the app opens again: completed tasks show.
  await page.getByRole('button', { name: 'Hide' }).click();
  await expect(page.getByText('Feed the cat')).toHaveCount(0);
  await page.reload();
  await openList(page, 'Today');
  await expect(page.getByText('Feed the cat')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Hide' })).toBeVisible();
});
