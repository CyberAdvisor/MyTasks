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
  await expect(page.getByText('Offline — changes saved on this device')).toBeVisible({ timeout: 15_000 });
});
