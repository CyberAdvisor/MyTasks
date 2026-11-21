/**
 * Settings › Sync's "In your gist" overview (v1.4.3): counts by state and
 * the gist file's size after a sync.
 */
import { expect, test } from '@playwright/test';
import { connect, pickImportFile } from './app';
import { fakeGitHub } from './fakeGitHub';

test('shows tasks and projects by state, and the file size once synced', async ({ page, context }) => {
  await fakeGitHub(context);
  await connect(page);
  await pickImportFile(
    page,
    'seed.csv',
    'type,title,project,status,completed_date\nproject,P,,,\ntask,Open one,P,,\ntask,Done one,P,completed,2026-01-02\ntask,Dropped,,canceled,2026-01-03',
  );
  await page.getByRole('dialog').getByRole('button', { name: 'Import', exact: true }).click();
  const sync = page.getByRole('region', { name: 'Sync' });
  await sync.getByRole('button', { name: 'Sync Now' }).click();

  const table = sync.getByRole('table', { name: 'In your gist' });
  await expect(table.getByRole('row', { name: /^Tasks/ })).toHaveText(/Tasks\s*1\s*2\s*0\s*0/);
  await expect(table.getByRole('row', { name: /^Projects/ })).toHaveText(/Projects\s*1\s*0\s*0\s*0/);
  await expect(sync.getByText(/File size: under 0\.1 MB of 5 MB/)).toBeVisible();
});
