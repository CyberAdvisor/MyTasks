/**
 * Several gists on a device (FR-19.11, FR-19.14 to FR-19.16), in a real
 * browser: Add Gist… with its name required, the gist band and its switcher,
 * switching with nothing leaking between gists, Rename…, and disconnecting
 * one gist. Each gist has its own task database and syncs only its own file.
 */
import { expect, test, type Page } from '@playwright/test';
import { addTask, connect, openList, synced, watchErrors } from './app';
import { fakeGitHub } from './fakeGitHub';

const band = (page: Page) => page.getByRole('navigation', { name: 'Lists' }).getByRole('button', { name: /^Gist: / });

/** Wait for the app to start again after a switch. */
async function started(page: Page): Promise<void> {
  await expect(page.getByRole('navigation', { name: 'Lists' })).toBeVisible({ timeout: 30_000 });
  await synced(page);
}

async function openSettings(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Settings' }).click();
}

test('add, switch, rename and disconnect gists, keeping their tasks apart', async ({ context, page }) => {
  const errors = watchErrors(page);
  const gh = await fakeGitHub(context);
  await connect(page);
  await synced(page);
  const first = [...gh.gists.keys()][0];
  // One gist: no band.
  await expect(band(page)).toHaveCount(0);
  await openList(page, 'Inbox');
  await addTask(page, 'Only in the first');
  await synced(page);

  // Add Gist… from Settings: a new gist, with a name required.
  await openSettings(page);
  await page.getByRole('button', { name: 'Add Gist…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add Gist' });
  await expect(dialog.getByRole('radio', { name: /Create a new gist/ })).toBeChecked();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await expect(dialog.getByText('Use a different passphrase from your other gists.')).toBeVisible();
  await dialog.getByLabel('Passphrase', { exact: true }).fill('a second passphrase');
  await dialog.getByLabel('Confirm passphrase').fill('a second passphrase');
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await dialog.getByRole('button', { name: 'Add Gist' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(/Enter a name/);
  await dialog.getByLabel('Name').fill('default');
  await dialog.getByRole('button', { name: 'Add Gist' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(/already used on this device/);
  await dialog.getByLabel('Name').fill('Work');
  await dialog.getByRole('radio', { name: 'Teal' }).check();
  const firstFile = gh.file(first);
  await dialog.getByRole('button', { name: 'Add Gist' }).click();

  // The app starts again on Work: its band, in teal, and none of the first gist's tasks.
  await started(page);
  await expect(band(page)).toHaveAccessibleName('Gist: Work. Switch gist');
  await expect(band(page)).toHaveClass(/gist-teal/);
  const second = [...gh.gists.keys()].find((id) => id !== first)!;
  await openList(page, 'Inbox');
  await expect(page.getByText('Only in the first')).toBeHidden();
  const secondFile = gh.file(second);
  await addTask(page, 'Only in Work');
  await expect.poll(() => gh.file(second), { timeout: 15_000 }).not.toBe(secondFile);
  expect(gh.file(first)).toBe(firstFile);

  // The switcher from the keyboard: Down opens it on the first other gist; Escape closes it.
  await band(page).focus();
  await page.keyboard.press('ArrowDown');
  const menu = page.getByRole('menu', { name: 'Switch gist' });
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  await expect(menu.getByRole('menuitem')).toHaveText(['Default', 'Add Gist…', 'Manage Gists…']);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(band(page)).toBeFocused();

  // Switch back with a click: the first gist's tasks, and none of Work's.
  await band(page).click();
  await menu.getByRole('menuitem', { name: 'Default' }).click();
  await started(page);
  await expect(band(page)).toHaveAccessibleName('Gist: Default. Switch gist');
  await openList(page, 'Inbox');
  await expect(page.getByText('Only in the first')).toBeVisible();
  await expect(page.getByText('Only in Work')).toBeHidden();

  // Rename… the open gist; Settings lists both, the open one marked.
  await openSettings(page);
  const gists = page.getByRole('list', { name: 'Your Gists' });
  await expect(gists.getByRole('listitem')).toHaveText([/Default\s*Open\s*Rename…/, /Work\s*Switch/]);
  await gists.getByRole('button', { name: 'Rename…' }).click();
  const rename = page.getByRole('dialog', { name: 'Rename Gist' });
  await rename.getByLabel('Name').fill('Personal');
  await rename.getByRole('radio', { name: 'Red' }).check();
  await rename.getByRole('button', { name: 'Rename' }).click();
  await expect(band(page)).toHaveAccessibleName('Gist: Personal. Switch gist');
  await expect(band(page)).toHaveClass(/gist-red/);

  // Disconnect This Gist removes only Personal: the app starts again on Work, the band hidden.
  await page.getByRole('button', { name: 'Disconnect This Gist' }).click();
  await page.getByRole('dialog', { name: /Disconnect “Personal”/ }).getByRole('button', { name: 'Disconnect' }).click();
  await started(page);
  await expect(band(page)).toHaveCount(0);
  await openList(page, 'Inbox');
  await expect(page.getByText('Only in Work')).toBeVisible();
  await openSettings(page);
  await expect(page.getByRole('list', { name: 'Your Gists' }).getByRole('listitem')).toHaveText([/Work\s*Open/]);
  await expect(page.getByRole('button', { name: 'Disconnect This Device' })).toBeVisible();
  expect(errors).toEqual([]);
});
