/**
 * Sort by date (FR-2.8): from the project's ⋯ menu, its tasks list active
 * ones first, then later ones by start date, then deferred ones; the sidebar's
 * menu shows it checked; turning it off restores manual order. A heading's
 * ⋯ menu has its own Sort by Date.
 */
import { expect, test, type Page } from '@playwright/test';
import { addTask, connect, watchErrors } from './app';
import { fakeGitHub } from './fakeGitHub';

/** The local `YYYY-MM-DD` date `days` from today. */
function day(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Set a task's start date from its right-click menu: a day from today, or Deferred. */
async function startDate(page: Page, title: string, when: number | 'Deferred'): Promise<void> {
  await page.getByText(title, { exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Start Date…' }).click();
  if (when === 'Deferred') return page.getByRole('button', { name: 'Deferred' }).click();
  const cell = page.locator(`[data-date="${day(when)}"]`);
  if (!(await cell.isVisible())) await page.getByRole('button', { name: 'Next month' }).click();
  await cell.click();
}

/** The project page's task titles, top to bottom. */
const titles = (page: Page) => page.locator('main li.row .title').allInnerTexts();

test('Sort by Date orders a project’s tasks by start date, and turns off again', async ({ context, page }) => {
  await fakeGitHub(context);
  const errors = watchErrors(page);
  await connect(page);
  const nav = page.getByRole('navigation', { name: 'Lists' });

  await nav.getByRole('button', { name: 'New List' }).click();
  await page.getByRole('menuitem', { name: 'New Project' }).click();
  const title = page.getByLabel('Project title');
  await title.fill('Move house');
  await title.blur();
  for (const t of ['Book van', 'Pack books', 'Paint hall', 'Call bank']) await addTask(page, t);
  await startDate(page, 'Book van', 6);
  await startDate(page, 'Pack books', 'Deferred');
  await startDate(page, 'Paint hall', 3);
  const manual = ['Book van', 'Pack books', 'Paint hall', 'Call bank'];
  await expect.poll(() => titles(page)).toEqual(manual);

  // On: active first, then later ones by date, then deferred.
  await page.getByRole('button', { name: 'More project actions' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Sort by Date' }).click();
  await expect.poll(() => titles(page)).toEqual(['Call bank', 'Paint hall', 'Book van', 'Pack books']);

  // The sidebar's menu shows it on, and turns it off.
  await nav.getByRole('link', { name: 'Move house' }).click({ button: 'right' });
  const item = page.getByRole('menuitemcheckbox', { name: 'Sort by Date' });
  await expect(item).toHaveAttribute('aria-checked', 'true');
  await item.click();
  await expect.poll(() => titles(page)).toEqual(manual);

  // A heading has its own Sort by Date.
  await page.getByRole('toolbar', { name: 'Actions' }).getByRole('button', { name: 'New Heading' }).click();
  const heading = page.getByLabel('Heading title');
  await heading.fill('Later');
  await heading.blur();
  await page.getByRole('button', { name: 'Heading actions' }).click();
  await expect(page.getByRole('menuitemcheckbox', { name: 'Sort by Date' })).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Escape');

  expect(errors).toEqual([]);
});
