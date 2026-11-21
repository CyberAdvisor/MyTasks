/**
 * Repeating tasks (FR-4.1 to FR-4.4): Repeat… in the task menu opens the
 * Repeat dialog; OK makes the task a template, with today's copy in Today;
 * the cards link copy and template; checking off the template completes its
 * next copy early; Pause and Stop… work from the Repeat submenu. A project
 * repeats the same way (FR-4.6). Touches the database (schemas 9 and 11), so
 * it runs in both browsers.
 */
import { expect, test, type Page } from '@playwright/test';
import { addTask, connect, openList, watchErrors } from './app';
import { fakeGitHub } from './fakeGitHub';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The project page's rows: the template has the "Repeating task" icon. */
const rows = (page: Page) => page.locator('main li.row');
const template = (page: Page) => rows(page).filter({ has: page.getByRole('img', { name: 'Repeating task', exact: true }) });
const copy = (page: Page) => rows(page).filter({ has: page.getByRole('img', { name: 'Copy of a repeating task' }) });

/** Open the template's Repeat submenu and choose `item`. */
async function repeatMenu(page: Page, item: string): Promise<void> {
  await template(page).locator('.title').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Repeat', exact: true }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

test('a task repeats weekly: a copy today, the template next week, pause and stop', async ({ context, page }) => {
  await fakeGitHub(context);
  const errors = watchErrors(page);
  await connect(page);
  const nav = page.getByRole('navigation', { name: 'Lists' });
  await nav.getByRole('button', { name: 'New List' }).click();
  await page.getByRole('menuitem', { name: 'New Project' }).click();
  const title = page.getByLabel('Project title');
  await title.fill('Home chores');
  await title.blur();
  await addTask(page, 'Water plants');

  // Repeat… opens the dialog, starting at the default: 1 week after completion.
  await page.getByText('Water plants', { exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Repeat…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Repeat' });
  const kind = dialog.getByRole('combobox', { name: 'Repeat' });
  await expect(kind).toHaveValue('afterCompletion');
  await kind.selectOption('week');
  await expect(dialog.getByRole('combobox', { name: 'Weekday' })).toHaveValue(String(new Date().getDay()));
  await expect(dialog.getByRole('combobox', { name: 'Next' }).locator('option:checked')).toHaveText('Today');
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();

  // The copy is in Today; the template waits on next week's date.
  await expect(rows(page)).toHaveCount(2);
  await expect(copy(page)).toHaveCount(1);
  await expect(template(page).locator('.when')).toBeVisible();
  await expect(copy(page).locator('.deadline')).toBeVisible();

  // The template's card shows its rule; the copy's card links back to it.
  await template(page).locator('.title').dblclick();
  await expect(page.getByRole('button', { name: 'Edit repeat rule' })).toContainText(`Repeat every week on ${WEEKDAYS[new Date().getDay()]}`);
  await page.keyboard.press('Escape');
  await copy(page).locator('.title').dblclick();
  await expect(page.getByText('This is a copy of a repeating task')).toBeVisible();
  await page.getByRole('button', { name: 'Show Repeating Task' }).click();
  await expect(page.getByRole('button', { name: 'Edit repeat rule' })).toBeVisible();
  await page.keyboard.press('Escape');

  await openList(page, 'Today');
  await expect(rows(page)).toHaveCount(1);
  await expect(copy(page)).toHaveCount(1);
  await nav.getByRole('link', { name: 'Home chores' }).click();

  // Checking off the template completes its next copy early, and it moves on a week (FR-4.4).
  const before = await template(page).locator('.when').textContent();
  await template(page).getByRole('checkbox').click();
  await expect(rows(page)).toHaveCount(3);
  await expect(template(page).locator('.when')).not.toHaveText(before!);
  await expect(copy(page)).toHaveCount(2);

  // Pause shows Paused; Stop… asks, then both become ordinary tasks.
  await repeatMenu(page, 'Pause');
  await expect(template(page).locator('.when')).toHaveText('Paused');
  await repeatMenu(page, 'Stop…');
  await page.getByRole('dialog', { name: 'Stop repeating?' }).getByRole('button', { name: 'Stop It' }).click();
  await expect(template(page)).toHaveCount(0);
  await expect(copy(page)).toHaveCount(0);
  await expect(rows(page)).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('a monthly repeat on the 2nd Tuesday saves (FR-4.1, fixed in 1.2.13)', async ({ context, page }) => {
  await fakeGitHub(context);
  const errors = watchErrors(page);
  await connect(page);
  await openList(page, 'Unscheduled');
  await addTask(page, 'Pay rent');
  await page.getByText('Pay rent', { exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Repeat…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Repeat' });
  await dialog.getByRole('combobox', { name: 'Repeat' }).selectOption('month');
  await dialog.getByRole('combobox', { name: 'Day' }).selectOption('2');
  await dialog.getByRole('combobox', { name: 'Which' }).selectOption('2');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await openList(page, 'Scheduled');
  await template(page).locator('.title').dblclick();
  await expect(page.getByRole('button', { name: 'Edit repeat rule' })).toContainText('Repeat every month on the 2nd Tuesday');
  expect(errors).toEqual([]);
});

test('completing a project says its repeating task will stop repeating, and stops it (review C4)', async ({ context, page }) => {
  await fakeGitHub(context);
  const errors = watchErrors(page);
  await connect(page);
  await page.getByRole('navigation', { name: 'Lists' }).getByRole('button', { name: 'New List' }).click();
  await page.getByRole('menuitem', { name: 'New Project' }).click();
  const title = page.getByLabel('Project title');
  await title.fill('Garden');
  await title.blur();
  await addTask(page, 'Water plants');
  await page.getByText('Water plants', { exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Repeat…' }).click();
  const repeat = page.getByRole('dialog', { name: 'Repeat' });
  await repeat.getByRole('button', { name: 'OK' }).click();
  await expect(copy(page)).toHaveCount(1);

  // The repeating task's menu has no Convert to Project…; its copy's has.
  await template(page).locator('.title').click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Duplicate Task' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Convert to Project…' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'More project actions' }).click();
  await page.getByRole('menuitem', { name: 'Complete Project' }).click();
  const ask = page.getByRole('dialog', { name: 'Complete this project?' });
  await expect(ask).toContainText('It still has 1 open task.');
  await expect(ask).toContainText('Its repeating task will stop repeating.');
  await ask.getByRole('button', { name: 'Complete them' }).click();

  // Both are now ordinary completed tasks: nothing repeats any more.
  await expect(ask).toBeHidden();
  await expect(rows(page).filter({ hasText: 'Water plants' })).toHaveCount(2);
  await expect(page.getByRole('img', { name: 'Repeating task', exact: true })).toHaveCount(0);
  await expect(page.getByRole('img', { name: 'Copy of a repeating task' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a project repeats weekly: a whole copy today, the template with its banner, Create Next Copy, Scheduled (FR-4.6)', async ({ context, page }) => {
  await fakeGitHub(context);
  const errors = watchErrors(page);
  await connect(page);
  const nav = page.getByRole('navigation', { name: 'Lists' });
  await nav.getByRole('button', { name: 'New List' }).click();
  await page.getByRole('menuitem', { name: 'New Project' }).click();
  const title = page.getByLabel('Project title');
  await title.fill('Weekly review');
  await title.blur();
  await addTask(page, 'Clear inbox');

  // Repeat… in the project's ⋯ menu opens the same dialog as for a task.
  await page.getByRole('button', { name: 'More project actions' }).click();
  await page.getByRole('menuitem', { name: 'Repeat…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Repeat' });
  await dialog.getByRole('combobox', { name: 'Repeat' }).selectOption('week');
  await expect(dialog.getByRole('combobox', { name: 'Next' }).locator('option:checked')).toHaveText('Today');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();

  // The page is now the template: its banner and rule; the copy is in the sidebar above it.
  await expect(page.getByRole('note')).toContainText('template of a repeating project');
  await expect(page.getByRole('button', { name: 'Edit repeat rule' })).toContainText(`Repeat every week on ${WEEKDAYS[new Date().getDay()]}`);
  const links = nav.getByRole('link', { name: 'Weekly review' });
  await expect(links).toHaveCount(2);

  // The copy holds the task and links back to its template.
  await links.first().click();
  await expect(page.getByText('This is a copy of a repeating project')).toBeVisible();
  await expect(page.getByText('Clear inbox', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show Repeating Project' }).click();
  await expect(page.getByRole('note')).toBeVisible();

  // Create Next Copy opens the new copy; the template is listed in Scheduled, its task in no list.
  await page.getByRole('button', { name: 'Template actions' }).click();
  await page.getByRole('menuitem', { name: 'Create Next Copy' }).click();
  await expect(page.getByText('This is a copy of a repeating project')).toBeVisible();
  await expect(links).toHaveCount(3);
  await openList(page, 'Scheduled');
  await expect(page.locator('main ul.templates').getByRole('link', { name: /Weekly review/ })).toHaveCount(1);
  await expect(page.locator('main li.row').filter({ hasText: 'Clear inbox' })).toHaveCount(0);
  // Today's copy's task, and only it: next week's copy waits with its project, the template's is hidden.
  await openList(page, 'Unscheduled');
  await expect(page.locator('main li.row').filter({ hasText: 'Clear inbox' })).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('a repeating project’s template: Create Copy Now, Repeat › Pause and Stop, Delete asks (FR-4.6, v1.6.1)', async ({ context, page }) => {
  await fakeGitHub(context);
  const errors = watchErrors(page);
  await connect(page);
  const nav = page.getByRole('navigation', { name: 'Lists' });
  await nav.getByRole('button', { name: 'New List' }).click();
  await page.getByRole('menuitem', { name: 'New Project' }).click();
  const title = page.getByLabel('Project title');
  await title.fill('Daily check');
  await title.blur();
  await addTask(page, 'Water plants');
  const more = page.getByRole('button', { name: 'More project actions' });
  await more.click();
  await page.getByRole('menuitem', { name: 'Repeat…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Repeat' });
  await dialog.getByRole('combobox', { name: 'Repeat' }).selectOption('week');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByRole('note')).toBeVisible();
  const links = nav.getByRole('link', { name: 'Daily check' });
  await expect(links).toHaveCount(2);

  // Checking off the template's task asks first; the change goes to a new copy, which opens.
  const task = page.locator('main li.row').filter({ hasText: 'Water plants' });
  await task.getByRole('checkbox').click();
  const ask = page.getByRole('dialog', { name: 'Create Copy Now?' });
  await ask.getByRole('button', { name: 'Create Copy' }).click();
  await expect(page.getByText('This is a copy of a repeating project')).toBeVisible();
  await expect(links).toHaveCount(3);
  await expect(task.getByRole('checkbox')).toBeChecked();
  // The template's task is left open.
  await page.getByRole('button', { name: 'Show Repeating Project' }).click();
  await expect(task.getByRole('checkbox')).not.toBeChecked();

  // Repeat › Pause shows on the rule line; Resume takes it back.
  const rule = page.getByRole('button', { name: 'Edit repeat rule' });
  await more.click();
  await page.getByRole('menuitem', { name: 'Repeat' }).click();
  await page.getByRole('menuitem', { name: 'Pause' }).click();
  await expect(rule).toContainText('paused');
  await more.click();
  await page.getByRole('menuitem', { name: 'Repeat' }).click();
  await page.getByRole('menuitem', { name: 'Resume' }).click();
  await expect(rule).not.toContainText('paused');

  // Delete Project asks first; Cancel keeps it.
  await more.click();
  await page.getByRole('menuitem', { name: 'Delete Project' }).click();
  const del = page.getByRole('dialog', { name: 'Delete this repeating project?' });
  await del.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('note')).toBeVisible();

  // Stop… makes it an ordinary project: no banner, no rule.
  await more.click();
  await page.getByRole('menuitem', { name: 'Repeat' }).click();
  await page.getByRole('menuitem', { name: 'Stop…' }).click();
  await page.getByRole('dialog', { name: 'Stop repeating?' }).getByRole('button', { name: 'Stop It' }).click();
  await expect(page.getByRole('note')).toHaveCount(0);
  await expect(rule).toHaveCount(0);
  expect(errors).toEqual([]);
});
