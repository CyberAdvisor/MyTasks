/**
 * `npm run screenshots`: retake the README and website screenshots from the
 * current code, with Marcus Reyes's sample from the book (e2e/marcusPage.ts,
 * never real tasks), against a faked GitHub: Today grouped by his priorities,
 * with the day's calendar events, as in the book, and one task checked off so
 * Today shows its Hide button. Not part of
 * `npm run test:ui`: it runs through playwright.screenshots.config.ts, and
 * writes:
 *
 * - docs/images/today.png (README) and site/assets/shots/desktop-light.png:
 *   Today on a Mac, 1440 × 900 at 2×, light
 * - site/assets/shots/desktop-dark.png: the same, dark
 * - site/assets/shots/phone-light.png: Today on an iPhone, 390 × 844 at 3×, light
 *
 * Run on a Mac, so the text is in the Mac's own font.
 */
import { expect, test, type Page } from '@playwright/test';
import { go, groupToday, marcus, settle } from './marcusPage';

const SHOTS = 'site/assets/shots';

/** Check off one of Today's tasks, so it shows struck through and Today shows Hide. */
async function checkOffOne(page: Page): Promise<void> {
  await page.getByRole('checkbox', { name: 'Complete: Call the bank about the business card limit' }).click();
  // The task stays in Today, struck through; Hide appears after its 2 seconds.
  await expect(page.getByRole('button', { name: 'Hide' })).toBeVisible({ timeout: 5000 });
  await settle(page);
}

test('Mac screenshots, light and dark', async ({ browser }) => {
  const page = await marcus(browser);
  await go(page, '#/today', 'Invoice Brightline');
  await groupToday(page, 'Priorities');
  await checkOffOne(page);
  await page.screenshot({ path: `${SHOTS}/desktop-light.png` });
  await page.screenshot({ path: 'docs/images/today.png' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/desktop-dark.png` });
});

test('iPhone screenshot, light', async ({ browser }) => {
  const page = await marcus(browser, true);
  await go(page, '#/today', 'Invoice Brightline');
  await groupToday(page, 'Priorities');
  await checkOffOne(page);
  await page.screenshot({ path: `${SHOTS}/phone-light.png` });
});
