/**
 * Offline (NFR-1): once loaded, the service worker serves the whole app, so
 * it opens with no connection, and changes are kept on the device.
 */
import { expect, test } from '@playwright/test';
import { addTask, connect, openList } from './app';
import { fakeGitHub } from './fakeGitHub';

test.use({ serviceWorkers: 'allow' });

test('the app opens and keeps working with no connection', async ({ page, context }) => {
  const gh = await fakeGitHub(context);
  await connect(page);
  // Wait until the service worker controls the page, so the app is precached.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  gh.offline = true;
  await context.setOffline(true);
  await page.reload();
  await openList(page, 'Inbox');
  await addTask(page, 'Water the plants');
  await expect(page.getByText('Water the plants')).toBeVisible();
  // The sidebar counts the changes waiting to sync (FR-19.13).
  await expect(page.getByText('Offline · 1 change not synced')).toBeVisible({ timeout: 15_000 });
  await addTask(page, 'Feed the cat');
  await expect(page.getByText('Offline · 2 changes not synced')).toBeVisible();
});
