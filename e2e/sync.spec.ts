/**
 * Setup and sync through the gist (FR-19), in real browsers: the IndexedDB
 * writes, Web Crypto and the requests to GitHub (faked) that the unit tests
 * only simulate.
 */
import { expect, test } from '@playwright/test';
import { addTask, connect, openList, synced } from './app';
import { fakeGitHub, FakeGitHub } from './fakeGitHub';

test('Setup creates a gist and shows the lists', async ({ page, context }) => {
  const gh = await fakeGitHub(context);
  await connect(page);
  await synced(page);
  expect(gh.gists.size).toBe(1);
  // The gist holds the encrypted file, never readable text.
  const file = gh.file([...gh.gists.keys()][0])!;
  expect(JSON.parse(file)).toMatchObject({ app: 'mytasks' });
});

test('a new task stays after a reload and reaches the gist', async ({ page, context }) => {
  const gh = await fakeGitHub(context);
  await connect(page);
  await synced(page);
  const id = [...gh.gists.keys()][0];
  const before = gh.file(id);

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
  await first.close();
  await second.close();
});
