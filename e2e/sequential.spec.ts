/**
 * Sequential projects (FR-17): a tag listed in Settings makes a project
 * sequential; completing its task in Today moves the next one there, rows
 * show their place (after the project and heading, FR-1.9), and Reset Other Tasks… returns extra ones.
 */
import { expect, test } from '@playwright/test';
import { addTask, connect, openList, watchErrors } from './app';
import { fakeGitHub } from './fakeGitHub';

test('completing a sequential project’s task moves the next one into Today', async ({ context, page }) => {
  await fakeGitHub(context);
  const errors = watchErrors(page);
  await connect(page);
  const nav = page.getByRole('navigation', { name: 'Lists' });
  const row = (t: string) => page.locator('li.row', { hasText: t });

  // A project with three tasks, tagged Next Up.
  await nav.getByRole('button', { name: 'New List' }).click();
  await page.getByRole('menuitem', { name: 'New Project' }).click();
  const title = page.getByLabel('Project title');
  await title.fill('Vacation');
  await title.blur();
  for (const t of ['Book flights', 'Pack bags', 'Renew passport']) await addTask(page, t);
  await page.getByRole('button', { name: 'More project actions' }).click();
  await page.getByRole('menuitem', { name: 'Add Tags' }).click();
  await page.getByLabel('Find or create a tag').fill('Next Up');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');

  // Settings › Sequential Projects lists the tag, with P3.
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Add Tag' }).first().click();
  await page.getByLabel('Priority', { exact: true }).selectOption('3');

  // The first task is in Today, with its place in the project.
  await openList(page, 'Today');
  await expect(row('Book flights')).toContainText('Vacation · task 1 of 3');
  await expect(row('Pack bags')).toHaveCount(0);

  // Completing it moves the next one in.
  await page.getByRole('checkbox', { name: 'Complete: Book flights' }).click();
  await expect(row('Pack bags')).toContainText('Vacation · task 2 of 3', { timeout: 10_000 });

  // Grouped by project, the row still shows its place under the group heading.
  await page.getByRole('button', { name: 'More Today actions' }).click();
  await page.getByRole('menuitemradio', { name: 'Projects' }).click();
  await expect(row('Pack bags')).toContainText('task 2 of 3');
  await page.getByRole('button', { name: 'More Today actions' }).click();
  await page.getByRole('menuitemradio', { name: 'All' }).click();

  // With a second task in Today, Reset Other Tasks… returns it.
  await openList(page, 'Unscheduled');
  await row('Renew passport').getByText('Renew passport', { exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Start Date…' }).click();
  await page.getByRole('button', { name: 'Today' }).click();
  await openList(page, 'Today');
  await expect(row('Renew passport')).toBeVisible();
  // The card's ⋯ shows the same task menu as right-click (FR-1.7, since 1.1.14).
  await page.getByText('Pack bags', { exact: true }).dblclick();
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Reset Other Tasks…' }).click();
  await expect(page.getByRole('dialog')).toContainText('Renew passport');
  await page.getByRole('button', { name: 'Reset Others' }).click();
  await page.keyboard.press('Escape'); // The card stays open after a menu choice.
  await expect(row('Renew passport')).toHaveCount(0);
  await expect(row('Pack bags')).toBeVisible();
  // It went back without the automatic P3 it had in Today.
  await openList(page, 'Unscheduled');
  await expect(row('Renew passport')).toBeVisible();
  await expect(row('Renew passport').locator('.prio')).toHaveCount(0);

  // Giving the next-up task a later date sticks: the project waits for it, even after a reload's check.
  await openList(page, 'Today');
  await row('Pack bags').getByText('Pack bags', { exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Start Date…' }).click();
  await page.getByRole('button', { name: 'Tomorrow' }).click();
  await expect(row('Pack bags')).toHaveCount(0);
  await page.reload();
  await openList(page, 'Today');
  await expect(row('Pack bags')).toHaveCount(0);
  await expect(row('Renew passport')).toHaveCount(0);

  // A task under a heading names it after the project (FR-1.9).
  await nav.getByRole('link', { name: 'Vacation' }).click();
  await page.getByRole('toolbar', { name: 'Actions' }).getByRole('button', { name: 'New Heading' }).click();
  const heading = page.getByLabel('Heading title');
  await heading.fill('Documents');
  await heading.blur();
  await page.getByRole('button', { name: 'Add task under heading' }).click();
  await page.getByRole('group', { name: 'Edit task' }).getByPlaceholder('New Task').fill('Copy passport');
  await page.keyboard.press('Escape');
  await expect(row('Copy passport')).not.toContainText('Vacation'); // the project's own page, as before
  await row('Copy passport').getByText('Copy passport', { exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Start Date…' }).click();
  await page.getByRole('button', { name: 'Today' }).click();
  await openList(page, 'Today');
  await expect(row('Copy passport')).toContainText(/Vacation : Documents · task \d of \d/);
  // Grouped by project, the heading alone under the group heading.
  await page.getByRole('button', { name: 'More Today actions' }).click();
  await page.getByRole('menuitemradio', { name: 'Projects' }).click();
  await expect(row('Copy passport')).not.toContainText('Vacation :'); // waits for the regrouping
  await expect(row('Copy passport')).toContainText(/Documents · task \d of \d/);

  expect(errors).toEqual([]);
});
