/**
 * Nested tags and tag shortcuts (FR-6.1b, FR-6.4): nesting in Settings ›
 * Tags, filtering by a parent and by the tag nested under it, the shortcut
 * box, and the keys that add a tag and filter by it.
 */
import { expect, test } from '@playwright/test';
import { addTask, connect, openList, restoreSample, watchErrors } from './app';
import { fakeGitHub } from './fakeGitHub';

test('nests a tag, filters by parent and child, and uses tag shortcuts', async ({ context, page }) => {
  await fakeGitHub(context);
  const errors = watchErrors(page);
  await connect(page);
  // The app's own test for Apple devices: Control there, Alt elsewhere.
  const mac = await page.evaluate(() => /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent));
  const addKey = (k: string) => (mac ? `Control+${k}` : `Alt+${k}`);
  const filterKey = (k: string) => (mac ? `Control+Alt+${k}` : `Alt+Shift+${k}`);

  // Settings › Tags: three tags, Groceries nested under Errand from its ⋯ menu.
  await page.getByRole('link', { name: 'Settings' }).click();
  const tags = page.locator('section[aria-labelledby="tags-heading"]');
  for (const name of ['Errand', 'Groceries', 'Next Up']) {
    await tags.getByLabel('New tag name').fill(name);
    await tags.getByRole('button', { name: 'Add Tag' }).click();
  }
  await tags.getByRole('button', { name: 'Nest Groceries' }).click();
  await page.getByRole('menu', { name: 'Nest Groceries' }).getByRole('menuitem', { name: 'Errand' }).click();
  await expect(tags.getByRole('button', { name: 'Hide tags in Errand' })).toBeVisible();
  // Next Up can't be nested under itself: its menu offers only the others.
  await tags.getByRole('button', { name: 'Nest Next Up' }).click();
  await expect(page.getByRole('menu', { name: 'Nest Next Up' }).getByRole('menuitem')).toHaveText(['Errand', 'Groceries']);
  await page.keyboard.press('Escape');
  // On desktop, dragging a tag's icon onto another nests it.
  const errandRow = tags.locator('li').filter({ has: page.getByRole('button', { name: 'Hide tags in Errand' }) });
  await tags.getByRole('button', { name: 'Drag Next Up onto another tag to nest it' }).dragTo(errandRow);
  // Back to the top level from its ⋯ menu. (Dragging onto "Top level" is checked by hand:
  // Playwright's WebKit can't start an HTML5 drag from separate mouse steps.)
  await tags.getByRole('button', { name: 'Nest Next Up' }).click();
  await page.getByRole('menuitem', { name: 'Move to Top Level' }).click();
  await tags.getByRole('button', { name: 'Nest Next Up' }).click();
  await expect(page.getByRole('menuitem', { name: 'Move to Top Level' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Shortcuts. Boxes are clicked as Safari does, without taking focus, and keys go to the page.
  const clickBox = (name: string) =>
    page.evaluate((n) => {
      document.querySelector<HTMLButtonElement>(`button[aria-label="${n}"]`)!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      (document.activeElement as HTMLElement | null)?.blur();
    }, name);
  await clickBox('Set a shortcut for Groceries');
  await page.keyboard.press('g');
  await expect(tags.getByRole('button', { name: 'Shortcut for Groceries: G' })).toBeVisible();
  // The next box opened before a key is saved: that save must not close it. The key and the click
  // are sent together, as a person can be quicker than Playwright's click.
  await clickBox('Set a shortcut for Errand');
  await page.evaluate(() => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', code: 'KeyE', bubbles: true }));
    document.querySelector<HTMLButtonElement>('button[aria-label="Set a shortcut for Next Up"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.keyboard.press('n');
  await expect(tags.getByRole('button', { name: 'Shortcut for Errand: E' })).toBeVisible();
  await expect(tags.getByRole('button', { name: 'Shortcut for Next Up: N' })).toBeVisible();
  // G again, for Next Up, is refused, naming Groceries; Esc keeps N.
  await clickBox('Shortcut for Next Up: N');
  await page.keyboard.press('g');
  await expect(tags).toContainText('“G” is already used by Groceries.');
  await page.keyboard.press('Escape');
  await expect(tags.getByRole('button', { name: 'Shortcut for Next Up: N' })).toBeVisible();
  await expect(tags).not.toContainText('already used');

  // Three tasks in the Inbox: one tagged Errand, one Groceries by its shortcut, one Next Up.
  await openList(page, 'Inbox');
  for (const t of ['Buy batteries', 'Milk and eggs', 'Call the plumber']) await addTask(page, t);
  const row = (t: string) => page.locator('li.row', { hasText: t });
  const tagWith = async (task: string, tag: string) => {
    await row(task).getByText(task).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Tags' }).click();
    await page.getByRole('menuitemcheckbox', { name: tag }).click();
  };
  await tagWith('Buy batteries', 'Errand');
  await tagWith('Call the plumber', 'Next Up');
  // No task here has Groceries yet: its filter key does nothing, pressed once or twice.
  await page.keyboard.press(filterKey('g'));
  await page.keyboard.press(filterKey('g'));
  await expect(page.locator('li.row')).toHaveCount(3);
  await row('Milk and eggs').getByText('Milk and eggs').click();
  await page.keyboard.press(addKey('g'));
  await expect(row('Milk and eggs')).toContainText('Groceries');

  // The bar shows the parent for its family; filtering by it includes Groceries' task.
  const bar = page.getByRole('toolbar', { name: 'Filter' });
  await expect(bar.getByRole('button')).toHaveText(['All', 'Errand…', 'Next Up']);
  await bar.getByRole('button', { name: 'Errand…' }).click();
  await expect(bar.getByRole('button')).toHaveText(['All', 'Errand', 'Groceries', 'Next Up']);
  await expect(page.locator('li.row')).toHaveCount(2);
  // The child's filter key narrows to its task, with the parent still lit; again, it goes back to
  // the parent; the parent's key again clears the filter.
  await page.keyboard.press(filterKey('g'));
  await expect(page.locator('li.row')).toHaveCount(1);
  await expect(bar.getByRole('button', { name: 'Errand' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press(filterKey('g'));
  await expect(page.locator('li.row')).toHaveCount(2);
  await expect(bar.getByRole('button', { name: 'Groceries' })).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press(filterKey('e'));
  await expect(page.locator('li.row')).toHaveCount(3);

  // The shortcut again removes the tag.
  await row('Milk and eggs').getByText('Milk and eggs').click();
  await page.keyboard.press(addKey('g'));
  await expect(row('Milk and eggs')).not.toContainText('Groceries');

  // Deleting the parent deletes the nested tag too, after saying so.
  await page.getByRole('link', { name: 'Settings' }).click();
  await tags.getByRole('button', { name: 'Delete Errand' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('The tag nested under it is deleted too.');
  await dialog.getByRole('button', { name: 'Delete Tags' }).click();
  await expect(tags.getByLabel('Tag name', { exact: true })).toHaveCount(1);

  expect(errors).toEqual([]);
});

test('the filter bar shows tags only: no contexts on Today, a project or the Search page (since 1.3.5)', async ({ page, context }) => {
  await fakeGitHub(context);
  const errors = watchErrors(page);
  await connect(page);
  await restoreSample(page);
  const bar = page.getByRole('toolbar', { name: 'Filter' });
  const pills = () => bar.getByRole('button').allInnerTexts();
  await openList(page, 'Today');
  await expect(bar.getByRole('button', { name: 'Waiting' })).toBeVisible();
  // The sample's tasks use the Computer, Phone and Errands contexts; none is offered.
  expect(await pills()).toEqual(['All', 'Waiting']);
  await openList(page, 'Website launch');
  expect(await pills()).toEqual(['All', 'Waiting']);
  await page.evaluate(() => (location.hash = '#/search?q=a'));
  await expect(bar.getByRole('button', { name: 'Waiting' })).toBeVisible();
  expect(await pills()).toEqual(['All', 'Waiting']);
  // Context names still find tasks.
  await page.evaluate(() => (location.hash = '#/search?q=phone'));
  await expect(page.getByText('Call the plumber about the sink', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
