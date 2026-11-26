/**
 * Calendar events (FR-21.2 to FR-21.4) in real browsers: calendar.json,
 * sealed with the gist's key as the Mac helper seals it, shows in Today
 * above the tag bar and atop Scheduled's days; an event opens its read-only
 * details (a pop-over, or a sheet at phone size); Settings hides them; and
 * the device keeps them for the next launch, offline included. The clock is
 * fixed at noon, so the day's events are the same whenever the test runs.
 */
import { expect, test, type Page } from '@playwright/test';
import { addCalendar, addTicks, connect, openList, restoreSample, synced, titleGaps, watchErrors } from './app';
import { fakeGitHub, type FakeGitHub } from './fakeGitHub';
import { addDays, addMonths, formatShort, toLocalDate } from '../src/lib/model/dates';
import { whenSynced } from '../src/lib/sync/messages';

/** Noon today, local time: the test's fixed "now". */
const NOON = new Date();
NOON.setHours(12, 0, 0, 0);
const TODAY = toLocalDate(NOON);

/** Two days of the month after next, always one of Scheduled's month groups (FR-21.6). */
const MONTH_LATER = addMonths(TODAY, 2);
const CLUB_DAYS = [addDays(MONTH_LATER, 1), addDays(MONTH_LATER, 8)];

/** A local time today (or `days` later) as the UTC timestamp the helper writes. */
function at(hours: number, minutes = 0, days = 0): string {
  const d = new Date(NOON);
  d.setDate(d.getDate() + days);
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
}

const CALENDAR = {
  format: 1,
  from: TODAY,
  to: addDays(TODAY, 13),
  calendars: [
    { id: 'work', title: 'Work', color: '#1badf8' },
    { id: 'home', title: 'Home', color: '#ff2968' },
  ],
  events: [
    { id: 'bday', calendar: 'home', title: "Mom's birthday", allDay: true, start: TODAY, end: TODAY },
    { id: 'gym', calendar: 'home', title: 'Gym', allDay: false, start: at(8, 30), end: at(9, 30) },
    {
      id: 'review',
      calendar: 'work',
      title: 'Design review',
      allDay: false,
      start: at(14),
      end: at(15, 30),
      location: 'Room 4',
      notes: 'Bring the mockups.',
      url: 'https://example.com/meet/design-review',
      attendees: [
        { name: 'Ana Ruiz', status: 'accepted' },
        { name: 'Ben Okafor', status: 'declined' },
        { name: 'Dev Patel', status: 'pending' },
      ],
      organizer: 'Ana Ruiz',
      repeat: 'Every 2 weeks on Tue, Thu',
      alerts: [{ before: 15 }],
      availability: 'busy',
    },
    { id: 'dentist', calendar: 'home', title: 'Dentist', allDay: false, start: at(17, 30, 2), end: at(18, 30, 2) },
    // A repeating event: both occurrences share an id.
    ...CLUB_DAYS.map((d) => ({ id: 'club', calendar: 'home', title: 'Book club', allDay: true, start: d, end: d })),
  ],
};


/** Connect a device, add the calendar to its gist, and reload so the launch sync reads it. */
async function connectWithCalendar(page: Page, gh: FakeGitHub): Promise<void> {
  await page.clock.setFixedTime(NOON);
  await connect(page);
  await synced(page);
  await addCalendar(gh, CALENDAR);
  await page.reload();
  await showToday(page);
}

/** Open Today (by address, so it works at phone size too). */
async function showToday(page: Page): Promise<void> {
  await page.evaluate(() => (location.hash = '#/today'));
}

const todayEvents = (page: Page) => page.getByRole('region', { name: "Today's calendar events" });

test('Today and Scheduled show the events; an event opens its details; Settings hides them', async ({ page, context }) => {
  const gh = await fakeGitHub(context);
  const errors = watchErrors(page);
  await connectWithCalendar(page, gh);

  // Today: all-day first, then by time; the ended one dimmed; above the tag bar.
  const lines = todayEvents(page).getByRole('button');
  await expect(lines).toHaveCount(3);
  await expect(lines.nth(0)).toHaveAccessibleName("Mom's birthday, All day, Home");
  await expect(lines.nth(1)).toHaveAccessibleName('Gym, 8:30 AM, Home');
  await expect(lines.nth(2)).toHaveAccessibleName('Design review, 2:00 PM, Work');
  await expect(lines.nth(1)).toHaveCSS('opacity', '0.45');
  await expect(lines.nth(2)).toHaveCSS('opacity', '1');
  await expect(lines.nth(2).getByText('2:00 PM')).toHaveCSS('color', 'rgb(27, 173, 248)');

  // The details, read-only: only the link is a link.
  await lines.nth(2).click();
  const details = page.getByRole('dialog', { name: 'Design review' });
  await expect(details).toBeVisible();
  for (const text of ['2:00 – 3:30 PM', 'Room 4', 'Every 2 weeks on Tue, Thu', 'Busy', '15 minutes before', 'Bring the mockups.']) {
    await expect(details.getByText(text, { exact: true })).toBeVisible();
  }
  await expect(details.getByText('3 attendees · 1 accepted, 1 declined')).toBeVisible();
  await expect(details.getByRole('listitem').first()).toHaveText(/Ana Ruiz\s*Organizer/);
  await expect(details.getByRole('link')).toHaveCount(1);
  const link = details.getByRole('link', { name: 'example.com/meet/design-review' });
  await expect(link).toHaveAttribute('href', 'https://example.com/meet/design-review');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(details.getByText(/^From your Mac's calendar, updated .+\. Read-only\.$/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(details).toBeHidden();

  // Scheduled (FR-21.6): a day with only an event gets
  // its day, its events plain lines; a month lists a repeating event once, with its day and count.
  await openList(page, 'Scheduled');
  const day = page.getByRole('group', { name: /^Calendar events, / }).first();
  await expect(day.getByRole('button', { name: 'Dentist, 5:30 PM' })).toBeVisible();
  await expect(day.getByText('Home')).toHaveCount(0);
  const club = page.getByRole('button', { name: `Book club (2×), ${formatShort(CLUB_DAYS[0])}` });
  await expect(club).toBeVisible();
  await expect(club).toContainText(CLUB_DAYS[0].slice(8));
  await club.click();
  await expect(page.getByRole('dialog', { name: 'Book club' })).toBeVisible();
  await page.keyboard.press('Escape');

  // Settings: when the helper wrote them; hiding them hides them in Today.
  await page.evaluate(() => (location.hash = '#/settings'));
  await expect(page.getByText(/Last updated Today at .+ · 6\s+events from 2\s+calendars/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Set up the calendar helper' })).toHaveAttribute('href', 'https://mytasks.fyi/guide/#calendar');
  await page.getByRole('switch', { name: 'Show calendar events in Today and Scheduled' }).uncheck();
  await showToday(page);
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await expect(todayEvents(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a gist the helper has no passphrase for says to run its setup again (FR-21.8)', async ({ page, context }) => {
  const gh = await fakeGitHub(context);
  await connect(page);
  await synced(page);
  const id = [...gh.gists.keys()][0];
  gh.gists.get(id)!.files['calendar.json'] = { content: JSON.stringify({ app: 'mytasks-calendar', format: 1, setupNeeded: true, updatedAt: new Date().toISOString() }) };
  await page.reload();
  await synced(page);
  await page.evaluate(() => (location.hash = '#/settings'));
  await expect(page.getByRole('alert').filter({ hasText: /Calendar events aren.t set up for this gist/ })).toBeVisible();
  // Only that message: no options, no pointer to the setup, no time in Sync.
  await expect(page.getByRole('switch', { name: 'Show calendar events in Today and Scheduled' })).toHaveCount(0);
  await expect(page.getByText('Calendar events and reminders need the My Tasks helper on a Mac.')).toHaveCount(0);
  await expect(page.getByText(/Calendar helper last updated/)).toHaveCount(0);
});

test('Settings shows how to set up the helper until it writes this gist, then the options and when it last wrote', async ({ page, context }) => {
  const gh = await fakeGitHub(context);
  const errors = watchErrors(page);
  await connect(page);
  await synced(page);
  const show = page.getByRole('switch', { name: 'Show calendar events in Today and Scheduled' });
  const lastWrite = page.getByText(/Calendar helper last updated/);

  // No calendar file: only the pointer to the helper's setup.
  await page.evaluate(() => (location.hash = '#/settings'));
  await expect(page.getByText('Calendar events and reminders need the My Tasks helper on a Mac.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'How to set it up' })).toHaveAttribute('href', 'https://mytasks.fyi/guide/#calendar');
  await expect(show).toHaveCount(0);
  await expect(lastWrite).toHaveCount(0);

  // The helper wrote its calendar file, then a tick later: the options show, and Sync gives the later time.
  const today = toLocalDate(new Date());
  const calendarAt = new Date(2026, 0, 15, 9, 30);
  const ticksAt = new Date(2026, 0, 16, 14, 5);
  await addCalendar(gh, { format: 1, from: today, to: today, calendars: [], events: [] }, calendarAt);
  await page.reload();
  await synced(page);
  await expect(show).toBeVisible();
  await expect(page.getByText('Calendar events and reminders need the My Tasks helper on a Mac.')).toHaveCount(0);
  await expect(lastWrite).toContainText(`Calendar helper last updated ${whenSynced(calendarAt.toISOString())}`);
  await addTicks(gh, [], ticksAt);
  await page.getByText(/^Synced /).click();
  await expect(lastWrite).toContainText(`Calendar helper last updated ${whenSynced(ticksAt.toISOString())}`);
  expect(errors).toEqual([]);
});

test('the events stay on the device for the next launch, offline included', async ({ page, context }) => {
  const gh = await fakeGitHub(context);
  await connectWithCalendar(page, gh);
  await expect(todayEvents(page).getByRole('button')).toHaveCount(3);
  gh.offline = true;
  await page.reload();
  await showToday(page);
  await expect(todayEvents(page).getByRole('button')).toHaveCount(3);
});

test('on a phone, the details are a sheet that ✕ closes', async ({ page, context }) => {
  const gh = await fakeGitHub(context);
  await page.setViewportSize({ width: 390, height: 844 });
  await connectWithCalendar(page, gh);
  await todayEvents(page).getByRole('button', { name: /^Design review/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Design review' });
  await expect(sheet).toHaveCSS('position', 'fixed');
  const box = (await sheet.boundingBox())!;
  expect(Math.round(box.width)).toBe(390);
  expect(Math.round(box.y + box.height)).toBe(844);
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toBeHidden();
});

test('the tag bar sits 12 px below the events, never over them, on the Mac and on a phone', async ({ page, context }) => {
  const gh = await fakeGitHub(context);
  await page.clock.setFixedTime(NOON);
  await connect(page);
  await restoreSample(page);
  await synced(page);
  await addCalendar(gh, CALENDAR);
  await page.reload();
  await showToday(page);
  await expect(todayEvents(page)).toBeVisible();
  await expect(page.locator('main li.row').first()).toBeVisible();
  expect((await titleGaps(page)).events).toBe(12);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('main li.row').first()).toBeVisible();
  expect((await titleGaps(page)).events).toBe(12);
});
