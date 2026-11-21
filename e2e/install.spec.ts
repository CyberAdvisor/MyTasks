/**
 * The sidebar's install notice in a Safari tab (FR-0.2): Install My Tasks,
 * which opens the install guide, and no warning about Safari clearing data
 * (dropped in 1.1.11). Safari's user agent is set, so Chromium runs it too.
 */
import { expect, test } from '@playwright/test';
import { connect } from './app';
import { fakeGitHub } from './fakeGitHub';

test.use({
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15',
});

test('a Safari tab shows Install My Tasks, which opens the guide, and no data warning', async ({ page, context }) => {
  await fakeGitHub(context);
  await connect(page);
  const install = page.getByRole('button', { name: 'Install My Tasks' });
  await expect(install).toBeVisible();
  await expect(page.getByText('7 days unused')).toHaveCount(0);
  await install.click();
  await expect(page.getByText('Add to Dock')).toBeVisible();
});
