/**
 * Shared steps for the interface tests: connecting a device through Setup and
 * adding tasks, the way a user does.
 */
import { expect, type Page } from '@playwright/test';

export const TOKEN = 'good';
export const PASSPHRASE = 'correct horse battery';

/**
 * How long to wait for the lists after entering the passphrase. Deriving the
 * key takes 600,000 PBKDF2 rounds on purpose (FR-19.6); with several tests
 * doing it at once, WebKit on a Mac can take well over Playwright's default
 * 5 seconds.
 */
const KEY_DERIVATION_TIMEOUT = 30_000;

/**
 * Open the app and connect it through Setup with the fake GitHub's token.
 * With no gist yet it creates one; with one, it unlocks it.
 */
export async function connect(page: Page): Promise<void> {
  await page.goto('/app/');
  await page.getByLabel('Personal access token').fill(TOKEN);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Connect' }).click();
  const confirm = page.getByLabel('Confirm passphrase');
  const unlock = page.getByRole('button', { name: 'Unlock' });
  await expect(confirm.or(unlock)).toBeVisible();
  await page.getByLabel('Passphrase', { exact: true }).fill(PASSPHRASE);
  if (await confirm.isVisible()) {
    await confirm.fill(PASSPHRASE);
    await page.getByRole('button', { name: 'Connect' }).click();
  } else {
    await unlock.click();
  }
  await expect(page.getByRole('navigation', { name: 'Lists' })).toBeVisible({ timeout: KEY_DERIVATION_TIMEOUT });
}

/** Open a built-in list or a project from the sidebar. */
export async function openList(page: Page, name: string): Promise<void> {
  await page.getByRole('navigation', { name: 'Lists' }).getByRole('link', { name, exact: false }).first().click();
}

/** Add a task to the current list with the toolbar's New Task (Quick Entry). */
export async function addTask(page: Page, title: string): Promise<void> {
  await page.getByRole('toolbar', { name: 'Actions' }).getByRole('button', { name: 'New Task' }).click();
  const field = page.getByRole('dialog', { name: 'Quick Entry' }).getByPlaceholder('New Task');
  await field.fill(title);
  await field.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Quick Entry' })).toBeHidden();
}

/**
 * Collect the page's errors as they happen: uncaught exceptions, console
 * errors (the app logs failed database work there) and Content Security
 * Policy violations. A test ends by expecting the list to be empty.
 */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  return errors;
}

/** Wait until the sidebar says the device has synced. */
export async function synced(page: Page): Promise<void> {
  await expect(page.getByText(/^Synced /)).toBeVisible({ timeout: 15_000 });
}
