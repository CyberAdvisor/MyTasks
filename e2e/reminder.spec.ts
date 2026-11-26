/**
 * Reminders (FR-3.8): the Reminder field, and Settings' "Reminders: on" line,
 * show only once the Mac helper's calendar file says it writes reminders
 * (FR-21.10); then a reminder is set from the
 * task menu by typing, shows on the row and as the card's chip, is cleared
 * from the chip, and is set again with the keyboard command and a preset.
 * Quick Entry has the field too, saved with the new task (FR-8.1).
 * A reminder ticked in Reminders completes its task, with Undo (FR-21.11).
 */
import { expect, test, type Page } from '@playwright/test';
import { addCalendar, addTask, addTicks, connect, gistTaskId, openList, synced, watchErrors } from './app';
import { fakeGitHub } from './fakeGitHub';
import { toLocalDate } from '../src/lib/model/dates';

const card = (page: Page) => page.locator('.card');

test('A reminder is set, shown, cleared and set again once the helper writes reminders', async ({ context, page }) => {
  const gh = await fakeGitHub(context);
  const errors = watchErrors(page);
  await connect(page);
  await openList(page, 'Unscheduled');
  await addTask(page, 'Call the dentist');

  // Without the helper's mark there is no Reminder field and no menu item.
  await page.getByText('Call the dentist', { exact: true }).dblclick();
  await expect(card(page).getByRole('button', { name: 'Deadline' })).toBeVisible();
  await expect(card(page).getByRole('button', { name: 'Reminder' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByText('Call the dentist', { exact: true }).click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Deadline…' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Reminder…' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  const remindersLine = page.getByText('Reminders: on.');
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Calendar Events' })).toBeVisible();
  await expect(remindersLine).toHaveCount(0);

  // The helper's calendar file says it writes this gist's reminders, and Settings says so.
  await synced(page);
  const today = toLocalDate(new Date());
  await addCalendar(gh, { format: 1, from: today, to: today, calendars: [], events: [], reminders: true });
  await page.reload();
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(remindersLine).toBeVisible();
  await openList(page, 'Unscheduled');

  // Typed in the menu's picker.
  await page.getByText('Call the dentist', { exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Reminder…' }).click();
  await page.getByLabel('Type a date and time').fill('tomorrow 9am');
  await expect(page.getByText('Tomorrow, 9:00 AM · press Return')).toBeVisible();
  await page.getByLabel('Type a date and time').press('Enter');
  await expect(page.locator('li.row', { hasText: 'Call the dentist' }).getByLabel('Reminder: Tomorrow, 9:00 AM')).toBeVisible();

  // The card's chip, which clears it; the bell button comes back.
  await page.getByText('Call the dentist', { exact: true }).dblclick();
  await card(page).getByRole('button', { name: 'Tomorrow, 9:00 AM' }).click();
  await page.getByRole('button', { name: 'Clear Reminder' }).click();
  await expect(card(page).getByRole('button', { name: 'Reminder' })).toBeVisible();
  await page.keyboard.press('Escape');

  // The keyboard command (R in a browser tab) opens the picker; a preset sets it.
  await page.getByText('Call the dentist', { exact: true }).click();
  await page.keyboard.press('r');
  await page.getByRole('button', { name: /^Tomorrow/ }).click();
  await expect(card(page).getByRole('button', { name: 'Tomorrow, 9:00 AM' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('Quick Entry sets a reminder once the helper writes reminders, saved with the new task', async ({ context, page }) => {
  const gh = await fakeGitHub(context);
  const errors = watchErrors(page);
  await connect(page);
  await openList(page, 'Unscheduled');
  const quick = page.getByRole('dialog', { name: 'Quick Entry' });
  const newTask = page.getByRole('toolbar', { name: 'Actions' }).getByRole('button', { name: 'New Task' });

  // Without the helper's mark, Quick Entry has no Reminder field.
  await newTask.click();
  await expect(quick.getByRole('button', { name: 'Deadline' })).toBeVisible();
  await expect(quick.getByRole('button', { name: 'Reminder' })).toHaveCount(0);
  await quick.getByRole('button', { name: 'Cancel' }).click();

  await synced(page);
  const today = toLocalDate(new Date());
  await addCalendar(gh, { format: 1, from: today, to: today, calendars: [], events: [], reminders: true });
  await page.reload();
  await synced(page);

  // Tab reaches its Reminder after Deadline (Notes, Start Date, Tags, Checklist, Deadline, Reminder)
  // and opens the picker; the choice is a chip, then saved with the task.
  await newTask.click();
  await page.keyboard.type('Water the plants');
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(50); // a picker focuses its field on the next frame
  }
  await expect(page.getByLabel('Type a date and time')).toBeFocused();
  await page.getByLabel('Type a date and time').fill('tomorrow 9am');
  await page.getByLabel('Type a date and time').press('Enter');
  await expect(quick.getByRole('button', { name: 'Tomorrow, 9:00 AM' })).toBeVisible();
  await quick.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('li.row', { hasText: 'Water the plants' }).getByLabel('Reminder: Tomorrow, 9:00 AM')).toBeVisible();
  expect(errors).toEqual([]);
});

test('A reminder ticked in Reminders completes its task, and Undo keeps it open', async ({ context, page }) => {
  const gh = await fakeGitHub(context);
  const errors = watchErrors(page);
  await connect(page);
  await openList(page, 'Unscheduled');
  await addTask(page, 'Call the dentist');
  const row = page.locator('main li.row', { hasText: 'Call the dentist' });

  // The helper read the tick and wrote it to the gist; the next sync completes the task.
  const id = await gistTaskId(gh, 'Call the dentist');
  await addTicks(gh, [{ task: id, at: new Date(Date.now() - 60_000).toISOString() }]);
  await page.getByText(/^Synced /).click();
  await expect(page.getByText('Completed in Reminders: Call the dentist')).toBeVisible();
  await expect(row.getByRole('checkbox')).toBeChecked();

  // Undo, here with a mouse too, reopens it; the tick, read again at the next sync, doesn't complete it again.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(row.getByRole('checkbox')).not.toBeChecked();
  await page.reload();
  await synced(page);
  await expect(row.getByRole('checkbox')).not.toBeChecked();
  await expect(page.getByText('Completed in Reminders: Call the dentist')).toHaveCount(0);
  expect(errors).toEqual([]);
});
