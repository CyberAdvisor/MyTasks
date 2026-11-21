/**
 * Setup and sync through the gist (FR-19), in real browsers: the IndexedDB
 * writes, Web Crypto and the requests to GitHub (faked) that the unit tests
 * only simulate.
 */
import { expect, test } from '@playwright/test';
import { addTask, connect, openList, synced } from './app';
import { fakeGitHub, FakeGitHub } from './fakeGitHub';

test('Setup creates one encrypted gist; a new task stays after a reload and reaches it', async ({ page, context }) => {
  const gh = await fakeGitHub(context);
  await connect(page);
  await synced(page);
  expect(gh.gists.size).toBe(1);
  const id = [...gh.gists.keys()][0];
  const before = gh.file(id);
  // The gist holds the encrypted file, never readable text.
  expect(JSON.parse(before!)).toMatchObject({ app: 'mytasks' });

  await openList(page, 'Inbox');
  await addTask(page, 'Buy stamps');
  await expect(page.getByText('Buy stamps')).toBeVisible();
  await expect.poll(() => gh.file(id), { timeout: 15_000 }).not.toBe(before);
  expect(gh.file(id)).not.toContain('Buy stamps');

  await page.reload();
  await openList(page, 'Inbox');
  await expect(page.getByText('Buy stamps')).toBeVisible();
});

test('a second device receives the task', async ({ browser }) => {
  const gh = new FakeGitHub();
  const first = await browser.newContext();
  await fakeGitHub(first, gh);
  const a = await first.newPage();
  await connect(a);
  await openList(a, 'Inbox');
  await addTask(a, 'Call the dentist');
  await synced(a);
  const id = [...gh.gists.keys()][0];
  await expect.poll(() => gh.file(id), { timeout: 15_000 }).toBeTruthy();
  // Wait for the upload that carries the new task.
  await expect(a.getByText('Syncing…')).toBeHidden({ timeout: 15_000 });

  const second = await browser.newContext();
  await fakeGitHub(second, gh);
  const b = await second.newPage();
  await connect(b);
  await openList(b, 'Inbox');
  await expect(b.getByText('Call the dentist')).toBeVisible();

  // A change on the second device reaches the first at its next sync, from
  // the mark its last sync left (NFR-7).
  await addTask(b, 'Reply from the second device');
  await expect(b.getByText('Syncing…')).toBeHidden({ timeout: 15_000 });
  await expect.poll(() => gh.writes, { timeout: 15_000 }).toBeGreaterThan(1);
  await a.reload();
  await openList(a, 'Inbox');
  await expect(a.getByText('Reply from the second device')).toBeVisible({ timeout: 15_000 });
  await first.close();
  await second.close();
});

test('clicking the sync line in the sidebar syncs now', async ({ context, page }) => {
  await fakeGitHub(context);
  await connect(page);
  await synced(page);
  const gistReads: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'GET' && /\/gists\//.test(r.url())) gistReads.push(r.url());
  });
  await page.getByRole('button', { name: /Sync now/ }).click();
  await expect.poll(() => gistReads.length).toBeGreaterThan(0);
  await synced(page);
});

test('a device that hasn’t synced for over 170 days waits for Replace With Gist', async ({ context, page }) => {
  await fakeGitHub(context);
  await connect(page);
  await addTask(page, 'Kept in the gist');
  // Upload it now, rather than after the usual short wait.
  const uploaded = page.waitForRequest((r) => r.method() === 'PATCH' && /\/gists\//.test(r.url()));
  await page.getByRole('button', { name: /Sync now/ }).click();
  await uploaded;
  await synced(page);
  // Make this device's last sync 200 days ago, as an iPad left in a drawer.
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((ok, fail) => {
      const r = indexedDB.open('mytasks-device');
      r.onsuccess = () => ok(r.result);
      r.onerror = () => fail(r.error);
    });
    const store = db.transaction('config', 'readwrite').objectStore('config');
    const row = await new Promise<Record<string, unknown>>((ok) => {
      const r = store.get('sync');
      r.onsuccess = () => ok(r.result);
    });
    await new Promise((ok) => {
      const r = store.put({ ...row, lastSyncedAt: new Date(Date.now() - 200 * 86_400_000).toISOString(), lastSync: undefined });
      r.onsuccess = ok;
    });
    db.close();
  });
  await page.reload();
  const nav = page.getByRole('navigation', { name: 'Lists' });
  await expect(nav.getByText(/^Not synced since /)).toBeVisible();
  await nav.getByText(/^Not synced since /).click();
  await expect(page.getByRole('alert')).toContainText('hasn’t synced for over 170 days');
  await page.getByRole('button', { name: 'Replace With Gist' }).click();
  await page.getByRole('dialog', { name: 'Replace this device’s tasks?' }).getByRole('button', { name: 'Replace' }).click();
  await synced(page);
  await expect(nav.getByText(/^Not synced since /)).toBeHidden();
  // The task added before (in Today, where the app opens) is there, from the gist.
  await openList(page, 'Today');
  await expect(page.getByText('Kept in the gist')).toBeVisible();
});
