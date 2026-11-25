/**
 * Shared steps for the interface tests: connecting a device through Setup,
 * adding tasks the way a user does, restoring the sample tasks, and adding
 * the Mac helper's files (calendar events, Reminders ticks) to the faked gist.
 */
import { expect, type Page } from '@playwright/test';
import { sampleBackup } from './sampleData';
import type { FakeGitHub } from './fakeGitHub';
import { deriveKey, seal, unseal, type Envelope, type EnvelopeApp } from '../src/lib/sync/crypto';

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

/** Replace the device's tasks with a backup's (the sample by default), through Settings › Restore from Backup…. */
export async function restoreSample(page: Page, backup: string = sampleBackup()): Promise<void> {
  await page.evaluate(() => (location.hash = '#/settings'));
  // Hand the file to Restore's file input, as picking it would.
  await page.locator('input[type=file][accept^=".json"]').evaluate((input: HTMLInputElement, text) => {
    const files = new DataTransfer();
    files.items.add(new File([text], 'sample.json', { type: 'application/json' }));
    input.files = files.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, backup);
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(page.getByText(/^Restored from the backup/)).toBeVisible({ timeout: 15_000 });
}

/** Gaps in px: tag row to title (when there is one), first task to what's above it, and, with Today's calendar events shown, tag row to their block. */
export async function titleGaps(page: Page): Promise<{ bar: number | null; first: number; events?: number }> {
  return page.evaluate(() => {
    const box = (el: Element | null) => el?.getBoundingClientRect();
    const title = box(document.querySelector('header .title'))!;
    const bar = box(document.querySelector('[role=toolbar][aria-label="Filter"]'));
    const row = box(document.querySelector('main li.row'))!;
    // Today's calendar block, when shown: the gap from its bottom to the tag bar (FR-21.3).
    const events = box(document.querySelector('[aria-label="Today\'s calendar events"]'));
    return {
      bar: bar ? Math.round(bar.top - title.bottom) : null,
      first: Math.round(row.top - (bar ?? title).bottom),
      events: events && bar ? Math.round(bar.top - events.bottom) : undefined,
    };
  });
}

/** Hand a file to Import's file input, as picking it would. */
export async function pickImportFile(page: Page, name: string, text: string): Promise<void> {
  await page.evaluate(() => (location.hash = '#/settings'));
  await page.getByLabel('Import file').evaluate(
    (input: HTMLInputElement, [n, t]) => {
      const files = new DataTransfer();
      files.items.add(new File([t], n, { type: 'text/csv' }));
      input.files = files.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    [name, text],
  );
}

/** Put one of the Mac helper's files in the faked gist, sealed with the passphrase and the gist's salt. */
async function addHelperFile(gh: FakeGitHub, name: string, app: EnvelopeApp, body: object, updated: Date): Promise<void> {
  const id = [...gh.gists.keys()][0];
  const env = JSON.parse(gh.file(id)!);
  const key = await deriveKey(PASSPHRASE, env.kdf.salt, env.kdf.iterations);
  const sealed = await seal(key, env.kdf, JSON.stringify(body), updated.toISOString());
  gh.gists.get(id)!.files[name] = { content: JSON.stringify({ ...sealed, app }) };
}

/** Put calendar.json in the faked gist, as the Mac helper writes it (FR-21.2). */
export function addCalendar(gh: FakeGitHub, calendar: object, updated = new Date()): Promise<void> {
  return addHelperFile(gh, 'calendar.json', 'mytasks-calendar', calendar, updated);
}

/** Put ticks.json in the faked gist, as the Mac helper writes it for reminders ticked in Reminders (FR-21.11). */
export function addTicks(gh: FakeGitHub, ticks: { task: string; at: string; day?: string }[]): Promise<void> {
  return addHelperFile(gh, 'ticks.json', 'mytasks-ticks', { format: 1, ticks }, new Date());
}

/** The id of the task titled `title` in the faked gist's task list, once a sync has uploaded it. */
export async function gistTaskId(gh: FakeGitHub, title: string): Promise<string> {
  const id = [...gh.gists.keys()][0];
  let found: string | undefined;
  await expect
    .poll(async () => {
      const env = JSON.parse(gh.file(id)!) as Envelope;
      const list = JSON.parse(await unseal(await deriveKey(PASSPHRASE, env.kdf.salt, env.kdf.iterations), env));
      found = list.tables.todos.find((t: { title?: string }) => t.title === title)?.id;
      return found;
    }, { timeout: 15_000 })
    .toBeTruthy();
  return found!;
}
