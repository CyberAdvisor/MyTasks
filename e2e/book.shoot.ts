/**
 * `npm run screenshots:book`: the book's screenshots, from Marcus Reyes's
 * sample (e2e/marcusData.ts: his tasks restored as a backup, his calendar
 * sealed into the faked gist), never real tasks. Not part of
 * `npm run test:ui`: it runs through playwright.screenshots.config.ts and
 * writes to book/shots/ (kept out of git), one PNG per picture, named for
 * its chapter. Light appearance; the Mac at 1440 × 900 at 2×, the iPhone at
 * 390 × 844 at 3×, set up by e2e/marcusPage.ts. Run on a Mac, so the text is
 * in the Mac's font.
 */
import { expect, test, type Page } from '@playwright/test';
import { go, groupToday, marcus, settle } from './marcusPage';

const SHOTS = 'book/shots';
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png` });

test('Mac', async ({ browser }) => {
  // Seventeen pictures take longer than one test's usual 30 seconds.
  test.setTimeout(120_000);
  const page = await marcus(browser);

  // Chapter 2: the Inbox on a Monday morning.
  await go(page, '#/inbox', 'Sign Leo');
  await shot(page, 'ch02-inbox');

  // Chapter 3: his areas in the sidebar, and a project with headings and a checklist.
  await go(page, '#/project/ces', 'Book flights to Las Vegas');
  await shot(page, 'ch03-ces-trip');
  // Chapter 3: a formatted note, with a link, in a task's card.
  await page.getByText('Book hotel near the convention center', { exact: true }).dblclick();
  await expect(page.getByRole('link', { name: 'CES hotel list' })).toBeVisible();
  await settle(page);
  await shot(page, 'ch03-hotel-note');
  await page.keyboard.press('Escape');

  // Chapter 4: what's coming.
  await go(page, '#/scheduled', 'Scheduled');
  await shot(page, 'ch04-scheduled');

  // Chapter 5 and 6: Today by his priorities, then by his contexts.
  await go(page, '#/today', 'Invoice Brightline');
  await groupToday(page, 'Priorities');
  await shot(page, 'ch05-today-priorities');
  await groupToday(page, 'Contexts');
  await shot(page, 'ch06-today-contexts');
  await groupToday(page, 'All');

  // Chapter 7: waiting on the team, and a focus on the show.
  await go(page, '#/saved/waiting', 'Waiting on team');
  await shot(page, 'ch07-waiting-on-team');
  await go(page, '#/area/show', 'The Gadget Ledger');
  await page.getByRole('button', { name: 'More area actions' }).click();
  await page.getByRole('menuitem', { name: 'Focus on this Area' }).click();
  await go(page, '#/today', 'Today');
  await shot(page, 'ch07-focus-show');
  await page.getByRole('button', { name: /leave focus/i }).first().click();

  // Chapter 8: a sequential project.
  await go(page, '#/project/aurora', 'Use it as my only phone');
  await shot(page, 'ch08-aurora-review');

  // Chapter 9: the episode's template, Create Copy Now?, and this week's copy.
  await go(page, '#/project/episode', 'Pick the main review');
  await shot(page, 'ch09-episode-template');
  // Chapter 9: a checklist item with a link, in a task's card.
  await page.getByText('Schedule the episode for Friday 6 a.m.', { exact: true }).dblclick();
  await expect(page.getByRole('link', { name: 'the podcast host' })).toBeVisible();
  // The card opens near the bottom of the window: bring all of it into view.
  await page.getByRole('group', { name: 'Edit task' }).evaluate((card) => card.scrollIntoView({ block: 'center' }));
  await settle(page);
  await shot(page, 'ch09-upload-checklist');
  await page.keyboard.press('Escape');
  await page.locator('main li').filter({ hasText: 'Pick the main review' }).getByRole('checkbox').click();
  await expect(page.getByRole('dialog', { name: 'Create Copy Now?' })).toBeVisible();
  await settle(page);
  await shot(page, 'ch09-create-copy-now');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Template actions' }).click();
  await page.getByRole('menuitem', { name: 'Show Previous Copy' }).click();
  await expect(page.getByText('This is a copy of a repeating project')).toBeVisible();
  await settle(page);
  await shot(page, 'ch09-episode-copy');

  // Chapter 10: the day with his calendar, and one event's details.
  await go(page, '#/today', 'Invoice Brightline');
  await shot(page, 'ch10-today-calendar');
  const events = page.getByRole('region', { name: "Today's calendar events" }).getByRole('button');
  await events.last().click();
  await settle(page);
  await shot(page, 'ch10-event-details');
  await page.keyboard.press('Escape');

  // Chapter 11: the Friday Review's checklist.
  await go(page, '#/project/review', 'Empty the Inbox');
  await shot(page, 'ch11-friday-review');
});

test('iPhone', async ({ browser }) => {
  const page = await marcus(browser, true);
  // Chapter 12: Today on his phone, grouped by his priorities.
  await go(page, '#/today', 'Invoice Brightline');
  await groupToday(page, 'Priorities');
  await shot(page, 'ch12-iphone-today');
});
