/**
 * When and deadlines (FR-3.6, FR-3.7): the When picker greys out days after
 * the deadline, an earlier deadline offers to move When, and a deadline of
 * today brings a deferred task into Today. Typed dates (FR-3.2) follow the
 * same rules.
 */
import { expect, test, type Page } from '@playwright/test';
import { addTask, connect, openList, watchErrors } from './app';
import { fakeGitHub } from './fakeGitHub';

/** Open a task's right-click menu and choose `item`. */
async function rowMenu(page: Page, title: string, item: string): Promise<void> {
  await page.getByText(title, { exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: item }).click();
}

/** The local `YYYY-MM-DD` date `days` from today. */
function day(days: number): { iso: string } {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return { iso: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` };
}

/** Pick a date in the open month calendar, moving to the next month if needed. */
async function pickDay(page: Page, iso: string): Promise<void> {
  const cell = page.locator(`[data-date="${iso}"]`);
  if (!(await cell.isVisible())) await page.getByRole('button', { name: 'Next month' }).click();
  await cell.click();
}

test('A start date stays on or before the deadline, and a deadline today brings a task into Today', async ({ context, page }) => {
  await fakeGitHub(context);
  const errors = watchErrors(page);
  await connect(page);
  await openList(page, 'Unscheduled');
  await addTask(page, 'Write report');
  await addTask(page, 'Renew passport');

  // Scheduled in 10 days; a deadline in 3 days warns and can move When.
  await rowMenu(page, 'Write report', 'Start Date…');
  await pickDay(page, day(10).iso);
  await openList(page, 'Scheduled');
  await rowMenu(page, 'Write report', 'Deadline…');
  await pickDay(page, day(3).iso);
  await expect(page.getByRole('alert')).toContainText("This deadline is before the task's start date");
  await page.getByRole('button', { name: 'Move Start Date to the deadline' }).click();
  const row = (t: string) => page.locator('li.row', { hasText: t });
  await expect(row('Write report')).toBeVisible();

  // When moved to the deadline; the picker greys out later days and says why.
  await rowMenu(page, 'Write report', 'Start Date…');
  await expect(page.locator(`[data-date="${day(3).iso}"]`)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText("A start date can't be later.")).toBeVisible();
  await expect(page.locator(`[data-date="${day(2).iso}"]`)).toBeEnabled();
  if (await page.locator(`[data-date="${day(4).iso}"]`).isVisible()) {
    await expect(page.locator(`[data-date="${day(4).iso}"]`)).toBeDisabled();
  }
  await page.keyboard.press('Escape');

  // A deferred task with a deadline of today moves into Today.
  await openList(page, 'Unscheduled');
  await rowMenu(page, 'Renew passport', 'Start Date…');
  await page.getByRole('button', { name: 'Deferred' }).click();
  await openList(page, 'Deferred');
  await rowMenu(page, 'Renew passport', 'Deadline…');
  await pickDay(page, day(0).iso);
  await openList(page, 'Today');
  await expect(row('Renew passport')).toBeVisible();
  await openList(page, 'Deferred');
  await expect(row('Renew passport')).toHaveCount(0);

  expect(errors).toEqual([]);
});

test('Typed dates set the start date and deadline, within the same rules', async ({ context, page }) => {
  await fakeGitHub(context);
  const errors = watchErrors(page);
  await connect(page);
  await openList(page, 'Unscheduled');
  await addTask(page, 'Book flights');
  const field = page.getByRole('textbox', { name: 'Type a date' });
  const result = page.locator('#typed-date-result');

  // The field has focus; the calendar shows the typed date; Return chooses it.
  // Its letters never run the one-key commands (T would be Today).
  await rowMenu(page, 'Book flights', 'Start Date…');
  await expect(field).toBeFocused();
  await page.keyboard.type('in 10 days');
  await expect(page.locator(`[data-date="${day(10).iso}"]`)).toHaveAttribute('aria-selected', 'true');
  await expect(result).toContainText('press Return');
  await page.keyboard.press('Enter');
  await openList(page, 'Scheduled');
  await expect(page.locator('li.row', { hasText: 'Book flights' })).toBeVisible();

  // A typed deadline before the start date gets the same warning.
  await rowMenu(page, 'Book flights', 'Deadline…');
  await page.keyboard.type('in 3 days');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toContainText("This deadline is before the task's start date");
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.keyboard.type('in 12 days');
  await page.keyboard.press('Enter');

  // A start date after the deadline isn't chosen; unknown text suggests examples.
  await rowMenu(page, 'Book flights', 'Start Date…');
  await page.keyboard.type('in 15 days');
  await expect(result).toContainText('After the deadline');
  await page.keyboard.press('Enter');
  await expect(field).toBeVisible();
  await field.fill('fryday');
  await expect(result).toContainText('Try “fri”');
  await page.keyboard.press('Escape');
  await expect(field).toHaveCount(0);

  expect(errors).toEqual([]);
});
