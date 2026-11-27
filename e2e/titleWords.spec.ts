/**
 * Natural-language entry (FR-1.12): with Settings › Task Titles off, a title
 * is kept as typed; switched on, Quick Entry's title sets the task's fields
 * with a message and one Undo, and a changed title in the card reads only
 * the words just typed. While typing, the words to be read are highlighted
 * with what they set underneath, and a click keeps one as text. Return on a
 * field's button saves Quick Entry and closes the card; Space opens the picker.
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

test('Words to be read are highlighted while typing, and a click keeps one as text', async ({ context, page }) => {
  await fakeGitHub(context);
  const errors = watchErrors(page);
  await connect(page);
  await readTitlesSwitch(page, true);
  await openList(page, 'Inbox');

  await page.getByRole('toolbar', { name: 'Actions' }).getByRole('button', { name: 'New Task' }).click();
  const entry = page.getByRole('dialog', { name: 'Quick Entry' });
  const field = entry.getByPlaceholder('New Task');
  await field.pressSequentially('Call Sam tomorrow p1');
  const marks = entry.locator('.layer .read');
  await expect(marks).toHaveText(['tomorrow', 'p1']);
  await expect(entry.locator('.hint')).toHaveText('Tomorrow · P1 — set on Return');

  // The highlight lies over its word in the field.
  const word = (await marks.first().boundingBox())!;
  const box = (await field.boundingBox())!;
  expect(word.y).toBeGreaterThanOrEqual(box.y - 1);
  expect(word.y + word.height).toBeLessThanOrEqual(box.y + box.height + 1);

  // A click keeps "tomorrow" as text, without leaving the title.
  await marks.first().click();
  await expect(entry.locator('.layer .kept')).toHaveText('tomorrow');
  await expect(marks).toHaveText(['p1']);
  await expect(entry.locator('.hint')).toHaveText('P1 — set on Return');
  await expect(field).toBeFocused();

  // Typed before it, the kept word moves with the text.
  await field.press('Home');
  await field.pressSequentially('Please ');
  await expect(entry.locator('.layer .kept')).toHaveText('tomorrow');

  await field.press('Enter');
  await expect(entry).toBeHidden();
  const task = row(page, 'Please Call Sam tomorrow');
  await expect(task.locator('.title')).toHaveText('Please Call Sam tomorrow');
  await expect(task.getByText('P1', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('A tag that isn’t one of yours is said under the title', async ({ context, page }) => {
  await fakeGitHub(context);
  await connect(page);
  await readTitlesSwitch(page, true);
  await openList(page, 'Inbox');
  await page.getByRole('toolbar', { name: 'Actions' }).getByRole('button', { name: 'New Task' }).click();
  const entry = page.getByRole('dialog', { name: 'Quick Entry' });
  await entry.getByPlaceholder('New Task').pressSequentially('Pay bill #utilities');
  await expect(entry.locator('.hint')).toHaveText('#utilities isn’t one of your tags');
  await expect(entry.locator('.layer .read')).toHaveCount(0);
});

test('Return on a field button finishes; Space opens its picker', async ({ context, page }) => {
  await fakeGitHub(context);
  const errors = watchErrors(page);
  await connect(page);
  await openList(page, 'Inbox');

  // Quick Entry: Space opens a picker, Return saves.
  await page.getByRole('toolbar', { name: 'Actions' }).getByRole('button', { name: 'New Task' }).click();
  const entry = page.getByRole('dialog', { name: 'Quick Entry' });
  await entry.getByPlaceholder('New Task').fill('Buy milk');
  const priority = entry.getByRole('button', { name: 'Priority', exact: true });
  await priority.focus();
  await priority.press('Space');
  await expect(entry.getByRole('dialog', { name: 'Priority' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(entry.getByRole('dialog', { name: 'Priority' })).toBeHidden();
  await expect(entry).toBeVisible();
  await priority.focus();
  await priority.press('Enter');
  await expect(entry).toBeHidden();
  await expect(row(page, 'Buy milk')).toBeVisible();

  // The card: Return on a field button closes it.
  await row(page, 'Buy milk').dblclick();
  const card = page.getByRole('group', { name: 'Edit task' });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Deadline', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(card).toBeHidden();
  expect(errors).toEqual([]);
});
