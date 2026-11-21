/**
 * Archive (FR-12.11; v1.4.2) in a real browser: Settings › Archive saves old
 * completed items to a CSV file after a confirmation, then removes them;
 * recent ones stay.
 */
import { expect, test } from '@playwright/test';
import { connect, pickImportFile } from './app';
import { fakeGitHub } from './fakeGitHub';

test.beforeEach(async ({ page, context }) => {
  await fakeGitHub(context);
  await connect(page);
  // One task completed long ago and one yesterday, through Import.
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  await pickImportFile(page, 'seed.csv', `type,title,status,completed_date\ntask,Ancient,completed,2025-01-02\ntask,Fresh,completed,${yesterday}`);
  await page.getByRole('dialog').getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Import From Other Apps' }).getByRole('status')).toContainText('Imported 2 tasks');
});

test('archives old completed tasks to a file, then removes them', async ({ page }) => {
  const section = page.getByRole('region', { name: 'Archive' });
  await expect(section.getByLabel('Archive items completed more than')).toHaveValue('90');
  await section.getByRole('button', { name: 'Archive…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Archive 1 task?' });
  await expect(dialog).toBeVisible();

  // Keep the file's contents as the app hands it to the browser.
  await page.evaluate(() => {
    const make = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob: Blob) => (((window as unknown as { saved: Blob }).saved = blob), make(blob));
  });
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Archive', exact: true }).click();
  // Playwright's WebKit turns the spaces in a download's name into underscores.
  expect((await download).suggestedFilename()).toMatch(/^My[ _]Tasks[ _]archive[ _]\d{4}-\d{2}-\d{2}\.csv$/);
  const text = await page.evaluate(() => (window as unknown as { saved: Blob }).saved.text());
  expect(text).toContain('Ancient');
  expect(text).not.toContain('Fresh');
  await expect(section.getByRole('status')).toContainText('Archived 1 task.');

  await page.evaluate(() => (location.hash = '#/logbook'));
  await expect(page.getByText('Fresh', { exact: true })).toBeVisible();
  await expect(page.getByText('Ancient', { exact: true })).toHaveCount(0);
});

test('says when nothing is old enough, and checks the number of days', async ({ page }) => {
  const section = page.getByRole('region', { name: 'Archive' });
  const field = section.getByLabel('Archive items completed more than');
  await field.fill('3650');
  await section.getByRole('button', { name: 'Archive…' }).click();
  await expect(section.getByRole('status')).toContainText('Nothing completed before');
  await field.fill('0');
  await section.getByRole('button', { name: 'Archive…' }).click();
  await expect(section.getByRole('alert')).toContainText('Enter a number of days, 1 or more.');
});
