/**
 * Several gists on a device (FR-19.11), in a real browser: each gist has its
 * own task database, and nothing from one shows in or syncs to the other.
 * The switcher's buttons come in 19b, so this test adds the second gist and
 * switches the way the app records it: an entry in `mytasks-device` and the
 * active database's name in localStorage, then a reload.
 */
import { expect, test, type Page } from '@playwright/test';
import { addTask, connect, openList, synced, watchErrors } from './app';
import { fakeGitHub } from './fakeGitHub';

/** Add a second gist to this device as a copy of the first's entry, on its own database. */
async function addSecondGist(page: Page, gistId: string): Promise<void> {
  await page.evaluate(async (gistId) => {
    const db = await new Promise<IDBDatabase>((ok, fail) => {
      const r = indexedDB.open('mytasks-device');
      r.onsuccess = () => ok(r.result);
      r.onerror = () => fail(r.error);
    });
    const store = db.transaction('gists', 'readwrite').objectStore('gists');
    const first = await new Promise<Record<string, unknown>>((ok) => {
      const r = store.get('mytasks');
      r.onsuccess = () => ok(r.result);
    });
    const { calendar: _, lastSync: __, ...rest } = first;
    await new Promise((ok) => {
      const r = store.put({ ...rest, db: `mytasks-${gistId}`, gistId, lastSyncedAt: null });
      r.onsuccess = ok;
    });
    db.close();
  }, gistId);
}

/** Make a gist's database active, as switching does, and reload on it. */
async function switchTo(page: Page, dbName: string): Promise<void> {
  await page.evaluate((name) => (name === 'mytasks' ? localStorage.removeItem('mytasks.activeDb') : localStorage.setItem('mytasks.activeDb', name)), dbName);
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Lists' })).toBeVisible();
}

test('two gists on one device keep their tasks apart', async ({ context, page }) => {
  const errors = watchErrors(page);
  const gh = await fakeGitHub(context);
  await connect(page);
  await synced(page);
  const first = [...gh.gists.keys()][0];
  // A second gist with the same passphrase, as a copy of the first while it's empty.
  const second = gh.add({ 'mytasks.json': gh.file(first)! });

  await openList(page, 'Inbox');
  await addTask(page, 'Only in the first');
  await synced(page);
  await addSecondGist(page, second);

  await switchTo(page, `mytasks-${second}`);
  await synced(page);
  await openList(page, 'Inbox');
  await expect(page.getByText('Only in the first')).toBeHidden();
  const firstFile = gh.file(first);
  const secondFile = gh.file(second);
  await addTask(page, 'Only in the second');
  // The second gist's file changes; the first's doesn't.
  await expect.poll(() => gh.file(second), { timeout: 15_000 }).not.toBe(secondFile);
  expect(gh.file(first)).toBe(firstFile);

  await switchTo(page, 'mytasks');
  await synced(page);
  await openList(page, 'Inbox');
  await expect(page.getByText('Only in the first')).toBeVisible();
  await expect(page.getByText('Only in the second')).toBeHidden();
  expect(errors).toEqual([]);
});
