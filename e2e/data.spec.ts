/**
 * Changes to several records at once, and undo and redo, in a real
 * browser's IndexedDB. Dexie can commit a transaction too early there
 * (DEVELOPMENT.md, Data), which the unit tests' in-memory database never
 * shows: Duplicate Project failed this way before 0.4.2, and Empty Trash
 * with several items before 0.4.1.
 */
import { expect, test } from '@playwright/test';
import { addTask, connect, openList, restoreSample, watchErrors } from './app';
import { fakeGitHub } from './fakeGitHub';

test.beforeEach(async ({ page, context }) => {
  await fakeGitHub(context);
  await connect(page);
});

test('Duplicate Project copies the project and its tasks', async ({ page }) => {
  const errors = watchErrors(page);
  const lists = page.getByRole('navigation', { name: 'Lists' });
  await lists.getByRole('button', { name: 'New List' }).click();
  await page.getByRole('menuitem', { name: 'New Project' }).click();
  const title = page.getByPlaceholder('New Project');
  await title.fill('Garden');
  await title.press('Enter');
  // Tasks without checklists: the case that failed before 0.4.2.
  await addTask(page, 'Plant tulips');
  await addTask(page, 'Mulch the beds');

  await page.getByRole('button', { name: 'More project actions' }).click();
  await page.getByRole('menuitem', { name: 'Duplicate Project' }).click();

  await expect(lists.getByRole('link', { name: 'Garden' })).toHaveCount(2);
  await lists.getByRole('link', { name: 'Garden' }).nth(1).click();
  await expect(page.getByText('Plant tulips')).toBeVisible();
  await expect(page.getByText('Mulch the beds')).toBeVisible();
  expect(errors).toEqual([]);
});

test('Empty Trash with several items empties it', async ({ page }) => {
  const errors = watchErrors(page);
  await openList(page, 'Inbox');
  const titles = ['Old receipt', 'Expired coupon', 'Spare note'];
  for (const t of titles) await addTask(page, t);
  for (const t of titles) {
    await page.getByText(t).click();
    await page.keyboard.press('Delete');
    await expect(page.getByText(t)).toBeHidden();
  }

  await openList(page, 'Trash');
  for (const t of titles) await expect(page.getByText(t)).toBeVisible();
  await page.getByRole('button', { name: 'Empty Trash' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Empty Trash' }).click();
  await expect(page.getByText('Trash is empty.')).toBeVisible();
  for (const t of titles) await expect(page.getByText(t)).toBeHidden();
  expect(errors).toEqual([]);
});

test('Undo goes back several changes, and Redo forward again (FR-1.6)', async ({ page }) => {
  const errors = watchErrors(page);
  await openList(page, 'Inbox');
  const titles = ['First draft', 'Second draft'];
  for (const t of titles) await addTask(page, t);
  for (const t of titles) {
    await page.getByText(t).click();
    await page.keyboard.press('Delete');
    await expect(page.getByText(t)).toBeHidden();
  }

  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByText('Second draft')).toBeVisible();
  await expect(page.getByText('First draft')).toBeHidden();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByText('First draft')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(page.getByText('First draft')).toBeHidden();
  await expect(page.getByText('Second draft')).toBeVisible();
  expect(errors).toEqual([]);
});

test('Several selected tasks change together, and one Undo takes it back (FR-10.1, FR-14.5)', async ({ page }) => {
  const errors = watchErrors(page);
  await openList(page, 'Inbox');
  const titles = ['Book flights', 'Renew passport', 'Pack the camera', 'Water the plants'];
  for (const t of titles) await addTask(page, t);
  const row = (t: string) => page.locator('[data-row-id]').filter({ hasText: t });
  const selected = page.locator('[data-row-id].selected');

  // Click, Shift-click a range, Cmd/Ctrl-click to add one and take one out.
  await page.getByText('Book flights').click();
  await page.getByText('Pack the camera').click({ modifiers: ['Shift'] });
  await expect(selected).toHaveCount(3);
  await page.getByText('Water the plants').click({ modifiers: ['ControlOrMeta'] });
  await page.getByText('Renew passport').click({ modifiers: ['ControlOrMeta'] });
  await expect(selected).toHaveCount(3);
  await expect(row('Renew passport')).not.toHaveClass(/selected/);

  // The right-click menu acts on all three: a priority for each, one Undo for all.
  await page.getByText('Pack the camera').click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Delete 3 Tasks' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Priority' }).click();
  await page.getByRole('menuitemradio').first().click();
  for (const t of ['Book flights', 'Pack the camera', 'Water the plants']) await expect(row(t).locator('.prio')).toHaveText('P1');
  await expect(row('Renew passport').locator('.prio')).toHaveCount(0);
  await expect(selected).toHaveCount(3);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('[data-row-id] .prio')).toHaveCount(0);

  // Complete and Delete from the menu act on all three too (they run after the menu closes).
  await page.getByText('Pack the camera').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Complete', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Mark as Completed' }).click();
  for (const t of ['Book flights', 'Pack the camera', 'Water the plants']) await expect(row(t).locator('.check')).toHaveAttribute('aria-checked', 'true');
  await expect(row('Renew passport').locator('.check')).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('ControlOrMeta+z');
  await page.getByText('Pack the camera').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete 3 Tasks' }).click();
  await expect(page.locator('[data-row-id]')).toHaveCount(1);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('[data-row-id]')).toHaveCount(4);

  // Shift+Up from the last row, then Today (T in a tab) for both: they stay in the Inbox under one bar.
  await page.getByText('Water the plants').click();
  await page.keyboard.press('Shift+ArrowUp');
  await expect(selected).toHaveCount(2);
  await page.keyboard.press('t');
  const bar = page.getByRole('status').filter({ hasText: 'moved out of the Inbox' });
  await expect(bar).toHaveText(/2 tasks moved out of the Inbox/);
  expect(errors).toEqual([]);
});

test('Remove From Project on several selected tasks takes them all out (FR-10.1)', async ({ page }) => {
  const errors = watchErrors(page);
  const lists = page.getByRole('navigation', { name: 'Lists' });
  await lists.getByRole('button', { name: 'New List' }).click();
  await page.getByRole('menuitem', { name: 'New Project' }).click();
  const title = page.getByPlaceholder('New Project');
  await title.fill('Garden');
  await title.press('Enter');
  await addTask(page, 'Plant tulips');
  await addTask(page, 'Mulch the beds');

  await page.getByText('Plant tulips').click();
  await page.getByText('Mulch the beds').click({ modifiers: ['Shift'] });
  await page.getByText('Mulch the beds').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Remove From Project' }).click();
  await expect(page.locator('[data-row-id]')).toHaveCount(0);
  await openList(page, 'Inbox');
  await expect(page.getByText('Plant tulips')).toBeVisible();
  await expect(page.getByText('Mulch the beds')).toBeVisible();
  expect(errors).toEqual([]);
});

test('the Move dialog filters its places as you type; Return picks the first (review F10)', async ({ page }) => {
  await restoreSample(page);
  await openList(page, 'Today');
  await page.getByText('Pick up dry cleaning', { exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Move…' }).click();
  const filter = page.getByLabel('Filter places');
  await expect(filter).toBeFocused();
  await page.keyboard.type('kit');
  const dialog = page.getByRole('dialog', { name: 'Move to…' });
  await expect(dialog.getByRole('button')).toHaveText(['Home', 'Kitchen refresh', 'Cancel']);
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await openList(page, 'Kitchen refresh');
  await expect(page.getByText('Pick up dry cleaning', { exact: true })).toBeVisible();
});
