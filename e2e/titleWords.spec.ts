/**
 * Natural-language entry (FR-1.12): with Settings › Task Titles off, a title
 * is kept as typed; switched on, Quick Entry's title sets the task's fields
 * with a message and one Undo, and a changed title in the card reads only
 * the words just typed.
 */
import { expect, test, type Page } from '@playwright/test';
import { addTask, connect, openList, watchErrors } from './app';
import { fakeGitHub } from './fakeGitHub';

const row = (page: Page, title: string) => page.locator('li.row', { hasText: title });

async function readTitlesSwitch(page: Page, on: boolean): Promise<void> {
  await page.getByRole('link', { name: 'Settings' }).click();
  const toggle = page.getByRole('switch', { name: 'Read dates and details from task titles' });
  await expect(toggle).toBeChecked({ checked: !on });
  await toggle.setChecked(on);
}

test('Task titles are read only when switched on, with a message and one Undo', async ({ context, page }) => {
  await fakeGitHub(context);
  const errors = watchErrors(page);
  await connect(page);

  // Off by default: the title is kept as typed.
  await openList(page, 'Today');
  await addTask(page, 'Call Sam today p1');
  await expect(row(page, 'Call Sam today p1')).toBeVisible();

  // Switched on, Quick Entry's words become the task's fields.
  await readTitlesSwitch(page, true);
  await openList(page, 'Today');
  await addTask(page, 'Call the dentist today p2');
  const dentist = row(page, 'Call the dentist');
  await expect(dentist).toBeVisible();
  await expect(dentist).not.toContainText('today');
  await expect(dentist.getByText('P2', { exact: true })).toBeVisible();
  const toast = page.getByRole('status').filter({ hasText: 'From the title: Today · P2' });
  await expect(toast).toBeVisible();

  // One Undo takes the new task back.
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(dentist).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('A changed title reads only the words just typed', async ({ context, page }) => {
  await fakeGitHub(context);
  const errors = watchErrors(page);
  await connect(page);
  await openList(page, 'Unscheduled');
  await addTask(page, 'Review friday notes');
  await readTitlesSwitch(page, true);
  await openList(page, 'Unscheduled');

  await row(page, 'Review friday notes').dblclick();
  const title = page.locator('.card textarea.title');
  await title.press('End');
  await title.pressSequentially(' p3');
  await title.press('Enter');

  // "friday" was already there, so it stays text; "p3" sets the priority and leaves the title.
  const review = row(page, 'Review friday notes');
  await expect(review.locator('.title')).toHaveText('Review friday notes');
  await expect(review.getByText('P3', { exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'From the title: P3' })).toBeVisible();
  // It stays so: closing the card mustn't save the typed title over the shorter one.
  await page.waitForTimeout(1000);
  await expect(review.locator('.title')).toHaveText('Review friday notes');
  expect(errors).toEqual([]);
});
