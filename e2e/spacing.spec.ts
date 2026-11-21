/**
 * The first task starts 26 px below the title, or below the tag row when there
 * is one, on every device (Michael, 2026-11-18). This file runs at desktop
 * size; e2e/phone.spec.ts runs the same check on a phone.
 */
import { expect, test } from '@playwright/test';
import { connect, restoreSample, titleGaps } from './app';
import { fakeGitHub } from './fakeGitHub';

test('the first task starts 26 px below the title or the tag row', async ({ page, context }) => {
  await fakeGitHub(context);
  await connect(page);
  await restoreSample(page);
  await page.evaluate(() => (location.hash = '#/today'));
  await expect(page.locator('main li.row').first()).toBeVisible();
  expect(await titleGaps(page)).toEqual({ bar: 12, first: 26 });
  await page.evaluate(() => (location.hash = '#/inbox'));
  await expect(page.getByText('Idea: a newsletter for launch day')).toBeVisible();
  expect(await titleGaps(page)).toEqual({ bar: null, first: 26 });
});
