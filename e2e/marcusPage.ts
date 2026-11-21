/**
 * Marcus Reyes's sample, opened in a page for screenshots: the book's
 * (e2e/book.shoot.ts) and the README's and Home page's (e2e/screenshots.shoot.ts).
 * His tasks are restored as a backup and his calendar sealed into the faked
 * gist (e2e/marcusData.ts), never real tasks. The clock is fixed at 8:45 a.m.,
 * so the day's events read the same whenever it runs.
 */
import { expect, type Browser, type Page } from '@playwright/test';
import { addCalendar, connect, restoreSample, synced } from './app';
import { fakeGitHub } from './fakeGitHub';
import { marcusBackup, marcusCalendar } from './marcusData';

/** 8:45 this morning, local time: the run's fixed "now". */
export const NOW = new Date();
NOW.setHours(8, 45, 0, 0);

/** A connected page holding Marcus's tasks and calendar, its copies made and its first sync done. */
export async function marcus(browser: Browser, phone = false): Promise<Page> {
  const context = await browser.newContext(
    phone
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: 'light' }
      : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'light' },
  );
  const gh = await fakeGitHub(context);
  const page = await context.newPage();
  await page.clock.setFixedTime(NOW);
  await connect(page);
  await synced(page);
  await restoreSample(page, marcusBackup(NOW));
  // The sync line is on the lists' screen (on an iPhone, not beside Settings).
  await page.evaluate(() => (location.hash = '#/'));
  await synced(page);
  // Written by the helper half an hour before the run's fixed "now".
  await addCalendar(gh, marcusCalendar(NOW), new Date(NOW.getTime() - 30 * 60_000));
  // A reload is a launch: repeat copies are made and the calendar is read.
  await page.reload();
  await synced(page);
  return page;
}

/** Open a page by its address and let it settle, with nothing hovered. */
export async function go(page: Page, hash: string, waitFor: string): Promise<void> {
  await page.evaluate((h) => (location.hash = h), hash);
  await expect(page.getByText(waitFor).first()).toBeVisible();
  await settle(page);
}

export async function settle(page: Page): Promise<void> {
  await page.mouse.move(0, 0);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
}


/** Group Today by `label` (Projects, Priorities, Contexts or All) from its ⋯ menu. */
export async function groupToday(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: 'More Today actions' }).click();
  await page.getByRole('menuitemradio', { name: label }).click();
  await settle(page);
}

