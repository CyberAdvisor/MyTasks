/**
 * Quick Find (FR-9.1): it searches when Return is pressed, not as you type
 * (NFR-7); a second Return opens the highlighted result, and typing again
 * clears the results.
 */
import { test, expect } from '@playwright/test';
import { addTask, connect, watchErrors } from './app';
import { fakeGitHub } from './fakeGitHub';

test('searches on Return, opens on the next Return, and clears when the text changes', async ({ browser }) => {
  const context = await browser.newContext();
  await fakeGitHub(context);
  const page = await context.newPage();
  const errors = watchErrors(page);
  await connect(page);
  await addTask(page, 'Buy milk');
  await addTask(page, 'Buy bread');

  await page.keyboard.press('/');
  const find = page.getByRole('dialog', { name: 'Quick Find' });
  const field = find.getByRole('combobox', { name: 'Quick Find' });
  const results = find.getByRole('listbox', { name: 'Results' });
  await expect(field).toBeFocused();

  // Typing doesn't search.
  await field.pressSequentially('buy');
  await expect(find.getByText('Press Return to search.')).toBeVisible();
  await expect(results).toHaveCount(0);

  // Return searches.
  await field.press('Enter');
  await expect(results.getByRole('option', { name: /Buy milk/ })).toBeVisible();
  await expect(results.getByRole('option', { name: /Buy bread/ })).toBeVisible();

  // Typing again clears the results until the next Return.
  await field.pressSequentially(' m');
  await expect(results).toHaveCount(0);
  await expect(find.getByText('Press Return to search.')).toBeVisible();
  await field.press('Enter');
  await expect(results.getByRole('option')).toHaveCount(2); // Buy milk, and the full-results row
  await expect(results.getByRole('option', { name: /Buy bread/ })).toHaveCount(0);

  // With results showing, Return opens the highlighted one (shown in its list with its card open).
  await field.press('Enter');
  await expect(find).toBeHidden();
  await expect(page.locator('main .card input.title')).toHaveValue('Buy milk');

  expect(errors).toEqual([]);
  await context.close();
});
