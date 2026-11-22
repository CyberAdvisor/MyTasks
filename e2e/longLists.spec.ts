/**
 * Long lists (NFR-7). The task limit: the sidebar warns from 4,500 tasks, and
 * at 5,000 a new task is refused with a message, keeping what was typed.
 * Drawing in steps: a long list draws 150 rows, then more as it scrolls, and
 * every command that needs the whole list draws the rest first. Changing
 * many selected tasks among thousands is quick.
 */
import { test, expect, type Page } from '@playwright/test';
import { addTask, connect, synced, watchErrors } from './app';
import { fakeGitHub } from './fakeGitHub';

/**
 * Add copies of the one task until the device holds `total`, straight into
 * IndexedDB, then reload. `fields` changes the copies (such as their list).
 */
async function fillTo(page: Page, total: number, fields: Record<string, unknown> = {}): Promise<void> {
  await page.evaluate(async ({ total, fields }) => {
    const db: IDBDatabase = await new Promise((ok, fail) => {
      const r = indexedDB.open('mytasks');
      r.onsuccess = () => ok(r.result);
      r.onerror = () => fail(r.error);
    });
    const store = (mode: IDBTransactionMode) => db.transaction('todos', mode).objectStore('todos');
    const rows: Record<string, unknown>[] = await new Promise((ok) => {
      const r = store('readonly').getAll();
      r.onsuccess = () => ok(r.result);
    });
    const live = rows.filter((t) => t.deletedAt === null);
    await new Promise<void>((ok, fail) => {
      const s = store('readwrite');
      // Sort keys in order (fractional-indexing's form), so the list's order is known.
      const key = (i: number) => `a0${i.toString(36).padStart(3, '0')}V`;
      for (let i = live.length; i < total; i++) s.put({ ...live[0], id: crypto.randomUUID(), title: `Filler ${i}`, sortKey: key(i), ...fields });
      s.transaction.oncomplete = () => ok();
      s.transaction.onerror = () => fail(s.transaction.error);
    });
    db.close();
  }, { total, fields });
  await page.reload();
}

test('warns near the limit and refuses a new task at it', async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext();
  await fakeGitHub(context);
  const page = await context.newPage();
  const errors = watchErrors(page);
  await connect(page);
  await addTask(page, 'First');

  await fillTo(page, 4499);
  await expect(page.getByRole('link', { name: /^Inbox/ })).toBeVisible();
  await expect(page.getByText(/of 5,000 tasks/)).toHaveCount(0);

  await fillTo(page, 4500);
  const warning = page.getByRole('link', { name: /4,500 of 5,000 tasks\. Make room/ });
  await expect(warning).toBeVisible();
  await expect(warning).toHaveAttribute('href', 'https://mytasks.fyi/guide/#task-limit');

  await fillTo(page, 5000);
  await expect(page.getByRole('link', { name: /5,000 of 5,000 tasks/ })).toBeVisible();
  await page.getByRole('toolbar', { name: 'Actions' }).getByRole('button', { name: 'New Task' }).click();
  const field = page.getByRole('dialog', { name: 'Quick Entry' }).getByPlaceholder('New Task');
  await field.fill('One too many');
  await field.press('Enter');
  const refusal = page.getByRole('dialog', { name: 'No room for more tasks' });
  // The reload above syncs all 5,000 new tasks first, which holds the database for a few seconds.
  await expect(refusal).toContainText('Another task would take you past 5,000', { timeout: 30_000 });
  await refusal.getByRole('button', { name: 'OK' }).click();
  await expect(field).toHaveValue('One too many');

  expect(errors).toEqual([]);
  await context.close();
});

test('draws a long list in steps, and all of it for commands that need it', async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await fakeGitHub(context);
  const page = await context.newPage();
  const errors = watchErrors(page);
  await connect(page);
  // Every task in the list, not the first few per group (FR-23.1).
  await page.evaluate(() => (location.hash = '#/settings'));
  await page.getByLabel('Tasks shown per project').selectOption('All');
  await page.evaluate(() => (location.hash = '#/unscheduled'));
  await addTask(page, 'First');
  await fillTo(page, 400);
  const rows = page.locator('main .row');
  const selected = page.locator('main .row.selected');

  // 150 drawn; scrolling to the end draws the next 150.
  await expect(rows).toHaveCount(150);
  await page.locator('main .scroll').evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect(rows).toHaveCount(300);

  // Down from the 150th row goes on into the rest (drawn as it comes into reach, or by the key).
  await page.evaluate(() => (location.hash = '#/today'));
  await page.evaluate(() => (location.hash = '#/unscheduled'));
  await expect(rows).toHaveCount(150);
  await rows.nth(149).getByRole('button', { name: /^Open/ }).click();
  await page.keyboard.press('ArrowDown');
  await expect(selected).toHaveText(/Filler 150\b/);

  // Select All takes every row, drawn or not.
  await page.evaluate(() => (location.hash = '#/today'));
  await page.evaluate(() => (location.hash = '#/unscheduled'));
  await expect(rows).toHaveCount(150);
  await rows.first().getByRole('button', { name: /^Open/ }).click();
  await page.keyboard.press('ControlOrMeta+a');
  await expect(selected).toHaveCount(400);
  await page.keyboard.press('Escape');

  // Printing draws every row.
  await page.evaluate(() => (location.hash = '#/today'));
  await page.evaluate(() => (location.hash = '#/unscheduled'));
  await expect(rows).toHaveCount(150);
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await expect(rows).toHaveCount(400);

  // Starting a drag draws the whole list, so drop positions count every row.
  await page.evaluate(() => (location.hash = '#/today'));
  await page.evaluate(() => (location.hash = '#/unscheduled'));
  await expect(rows).toHaveCount(150);
  const a = (await rows.first().boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 20, { steps: 4 });
  await expect(rows).toHaveCount(400);
  await page.keyboard.press('Escape');
  await page.mouse.up();

  expect(errors).toEqual([]);
  await context.close();
});

test('moves 200 selected tasks among 4,800 at once, quickly', async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await fakeGitHub(context);
  const page = await context.newPage();
  const errors = watchErrors(page);
  await connect(page);
  await page.evaluate(() => (location.hash = '#/inbox'));
  await addTask(page, 'First');
  await fillTo(page, 200);
  await fillTo(page, 4800, { start: 'unscheduled' });
  await synced(page);
  await expect(page.getByRole('link', { name: /^Inbox 200/ })).toBeVisible();

  await page.locator('main .row').first().getByRole('button', { name: /^Open/ }).click();
  await page.keyboard.press('ControlOrMeta+a');
  await expect(page.locator('main .row.selected')).toHaveCount(200);
  await page.keyboard.press('t');
  // Saved in one go: before, each task was saved and every list read again in turn (44 s in Chromium).
  await expect(page.getByRole('status').filter({ hasText: 'moved out of the Inbox' })).toContainText('200 tasks moved out of the Inbox', {
    timeout: 5_000,
  });

  expect(errors).toEqual([]);
  await context.close();
});
