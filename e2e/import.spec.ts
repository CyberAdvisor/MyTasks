/**
 * Import (FR-12.6; v1.4.0) in a real browser: the website's sample file,
 * with its repeating project (FR-4.6, v1.6.2), and a Todoist export
 * (FR-12.13, v1.12.0), through Settings › Import…, the preview, what it adds, and one
 * Undo taking it all back.
 */
import { expect, test } from '@playwright/test';
import { connect, openList, pickImportFile as pick, watchErrors } from './app';
import { fakeGitHub } from './fakeGitHub';
import { TODOIST_EXPORT } from '../tests/fixtures/todoistExport';

test.beforeEach(async ({ page, context }) => {
  await fakeGitHub(context);
  await connect(page);
});

test('imports the sample after a preview, and one Undo takes it back', async ({ page }) => {
  const errors = watchErrors(page);
  // The website's sample, as the build serves it.
  const sample = await (await page.request.get('/assets/import/mytasks-import-sample.csv')).text();
  await pick(page, 'sample.csv', sample);
  const dialog = page.getByRole('dialog', { name: 'Import “sample.csv”?' });
  await expect(dialog).toContainText('It holds 11 tasks, 2 projects, 2 headings, 2 areas and 3 checklist items.');
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Import From Other Apps' }).getByRole('status')).toContainText(/^Imported 11 tasks, 2 projects/);

  const lists = page.getByRole('navigation', { name: 'Lists' });
  await expect(lists.getByText('Kitchen refresh')).toBeVisible();
  await openList(page, 'Kitchen refresh');
  const headings = page.getByRole('textbox', { name: 'Heading title' });
  await expect(headings.first()).toHaveValue('Choose');
  await expect(headings.nth(1)).toHaveValue('Do');
  await expect(page.getByText('Pick a cabinet colour', { exact: true })).toBeVisible();
  // The repeating project comes in as its template.
  await openList(page, 'Weekly review');
  await expect(page.getByRole('note')).toContainText('template of a repeating project');
  await expect(page.getByText('Plan next week', { exact: true })).toBeVisible();

  await page.keyboard.press('ControlOrMeta+z');
  await expect(lists.getByText('Kitchen refresh')).toHaveCount(0);
  await expect(lists.getByText('Home', { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Import has its own Settings section, not under Backup', async ({ page }) => {
  await page.evaluate(() => (location.hash = '#/settings'));
  const section = page.getByRole('region', { name: 'Import From Other Apps' });
  await expect(section.getByRole('button', { name: 'Import…' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Backup' }).getByRole('button', { name: 'Import…' })).toHaveCount(0);
});

test('a file with a problem names the row and changes nothing', async ({ page }) => {
  await pick(page, 'bad.csv', 'type,title,priority\ntask,Fine,\ntask,Too high,9');
  const section = page.getByRole('region', { name: 'Import From Other Apps' });
  await expect(section.getByRole('alert')).toContainText('Row 3: priority should be 1, 2, 3, 4 or 5. Nothing was imported.');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a deferred row with a start date comes in scheduled on that date (v1.5.3)', async ({ page }) => {
  await pick(page, 'dated.csv', 'type,title,start,start_date\ntask,Book a table,deferred,2099-12-18');
  await page.getByRole('dialog', { name: 'Import “dated.csv”?' }).getByRole('button', { name: 'Import', exact: true }).click();
  await openList(page, 'Scheduled');
  const row = page.locator('main li.row').filter({ hasText: 'Book a table' });
  await expect(row.locator('.when')).toHaveText('Dec 18');
  await openList(page, 'Deferred');
  await expect(page.getByText('Book a table')).toHaveCount(0);
});

test('imports a Todoist export after a preview naming it, and one Undo takes it back (v1.12.0)', async ({ page }) => {
  const errors = watchErrors(page);
  // A real Todoist export, its author's name and id replaced.
  await pick(page, 'Claude test – delete me.csv', TODOIST_EXPORT);
  const dialog = page.getByRole('dialog', { name: 'Import “Claude test – delete me.csv”?' });
  await expect(dialog).toContainText('It holds 5 tasks, 1 project and 1 heading.');
  await expect(dialog).toContainText('Read as a Todoist export: the project “Claude test – delete me”, with no area.');
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();

  const lists = page.getByRole('navigation', { name: 'Lists' });
  await openList(page, 'Claude test – delete me');
  await expect(page.getByRole('textbox', { name: 'Heading title' }).first()).toHaveValue('Section A');
  await expect(page.getByText('Sub-task one', { exact: true })).toBeVisible();
  await expect(page.getByText('Pay rent', { exact: true })).toBeVisible();

  await page.keyboard.press('ControlOrMeta+z');
  await expect(lists.getByText('Claude test – delete me')).toHaveCount(0);
  expect(errors).toEqual([]);
});
