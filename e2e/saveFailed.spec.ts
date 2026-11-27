/**
 * Failed saves (review C1): a save the database refuses is reported, once,
 * with OK and Reload, and nothing is half-saved.
 */
import { expect, test, type Page } from '@playwright/test';
import { addTask, connect, watchErrors } from './app';
import { fakeGitHub } from './fakeGitHub';

/** Make writes of tasks throw `name` (or stop when null), as a full disk or a broken database would. */
async function failWrites(page: Page, name: string | null): Promise<void> {
  await page.evaluate((n) => ((window as unknown as { __failWrites: string | null }).__failWrites = n), name);
}

/** The titles of the tasks stored on the device, read from its database. */
function storedTitles(): Promise<string[]> {
  return new Promise((resolve) => {
    const open = indexedDB.open('mytasks');
    open.onsuccess = () => {
      const all = open.result.transaction('todos').objectStore('todos').getAll();
      all.onsuccess = () => {
        resolve((all.result as { title: string; deletedAt: string | null }[]).filter((t) => !t.deletedAt).map((t) => t.title));
        open.result.close();
      };
    };
  });
}

/** Try to add a task through Quick Entry, which stays open when the save fails. */
async function tryAdd(page: Page, title: string): Promise<void> {
  await page.getByRole('toolbar', { name: 'Actions' }).getByRole('button', { name: 'New Task' }).click();
  const field = page.getByRole('dialog', { name: 'Quick Entry' }).getByPlaceholder('New Task');
  await field.fill(title);
  await field.press('Enter');
}

test('a failed save says so, once, and changes nothing', async ({ context }) => {
  await fakeGitHub(context);
  await context.addInitScript(() => {
    for (const method of ['put', 'add'] as const) {
      const original = IDBObjectStore.prototype[method];
      IDBObjectStore.prototype[method] = function (this: IDBObjectStore, ...args: unknown[]) {
        const name = (window as unknown as { __failWrites?: string | null }).__failWrites;
        if (name && this.name === 'todos') throw new DOMException('Write refused by the test', name);
        return (original as (...a: unknown[]) => IDBRequest).apply(this, args);
      } as typeof original;
    }
  });
  const page = await context.newPage();
  const errors = watchErrors(page);
  await connect(page);
  await addTask(page, 'Saved before');
  // Quick Entry closes before its save ends: wait for the task to be stored before writes start failing.
  await expect.poll(() => page.evaluate(storedTitles)).toEqual(['Saved before']);

  // Storage full: its own message, and the typed task is kept in Quick Entry.
  await failWrites(page, 'QuotaExceededError');
  await tryAdd(page, 'Too big to fit');
  const full = page.getByRole('dialog', { name: 'Storage is full' });
  await expect(full).toBeVisible();
  await expect(full).toContainText('Free up space on this device');
  await full.getByRole('button', { name: 'OK' }).click();
  await expect(full).toBeHidden();
  await expect(page.getByRole('dialog', { name: 'Quick Entry' }).getByPlaceholder('New Task')).toHaveValue('Too big to fit');
  await page.keyboard.press('Escape');

  // Another failure: "Couldn't save"; a second failure while it shows doesn't stack a second message.
  await failWrites(page, 'UnknownError');
  await tryAdd(page, 'Lost one');
  const failed = page.getByRole('dialog', { name: "Couldn't save" });
  await expect(failed).toBeVisible();
  await page.evaluate(() => {
    // Two more failures arrive while the message shows (a storage-full one among them).
    for (let i = 0; i < 2; i++) {
      const reason = new DOMException('Write refused by the test', 'QuotaExceededError');
      const promise = Promise.reject(reason);
      promise.catch(() => {});
      window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', { promise, reason, cancelable: true }));
    }
  });
  await expect(page.getByRole('dialog', { name: /Couldn't save|Storage is full/ })).toHaveCount(1);
  await expect(failed).toBeVisible();

  // Reload: only what was saved before is there.
  await failWrites(page, null);
  await page.getByRole('dialog', { name: "Couldn't save" }).getByRole('button', { name: 'Reload' }).click();
  await expect(page.getByText('Saved before')).toBeVisible();
  await expect(page.getByText('Too big to fit')).toHaveCount(0);
  await expect(page.getByText('Lost one')).toHaveCount(0);

  // The failures are logged, nothing else.
  expect(errors.filter((e) => !e.startsWith('console: Save failed'))).toEqual([]);
});
