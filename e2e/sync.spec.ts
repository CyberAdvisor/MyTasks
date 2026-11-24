/**
 * Setup and sync through the gist (FR-19), in real browsers: the IndexedDB
 * writes, Web Crypto and the requests to GitHub (faked) that the unit tests
 * only simulate.
 */
import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test';
import { addTask, connect, openList, restoreSample, synced } from './app';
import { fakeGitHub, FakeGitHub } from './fakeGitHub';
import { localDate, sampleRecords } from './sampleRecords';

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
    const store = db.transaction('gists', 'readwrite').objectStore('gists');
    const row = await new Promise<Record<string, unknown>>((ok) => {
      const r = store.get('mytasks');
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

test('a device that comes back with an older copy keeps what another device completed', async ({ browser }) => {
  const gh = new FakeGitHub();
  const thursday = new Date('2026-11-19T09:00:00');
  const { todo, backup } = sampleRecords(thursday);
  const tasks = backup({
    areas: [], projects: [], headings: [], checklistItems: [], tags: [], contexts: [], savedSearches: [],
    todos: [todo('plants', 'Water the plants', { start: 'unscheduled', startDate: localDate(thursday, 1) })],
  });
  // The first device restores the task, starting Friday; the second receives it, then sits unopened.
  const first = await browser.newContext();
  await fakeGitHub(first, gh);
  const a = await first.newPage();
  await a.clock.setFixedTime(thursday);
  await connect(a);
  await restoreSample(a, tasks);
  await synced(a);
  const second = await browser.newContext();
  await fakeGitHub(second, gh);
  const b = await second.newPage();
  await b.clock.setFixedTime(thursday);
  await connect(b);
  await synced(b);
  await b.close();
  // Friday morning the first device completes it.
  await a.clock.setFixedTime(new Date('2026-11-20T09:00:00'));
  await a.reload();
  await openList(a, 'Today');
  await synced(a);
  // A frozen clock gives every change the same time: move it on for the check-off.
  await a.clock.setFixedTime(new Date('2026-11-20T09:05:00'));
  await a.getByRole('checkbox', { name: 'Complete: Water the plants' }).click();
  // A check-off is saved after its 2-second window; then make sure it's uploaded.
  await a.waitForTimeout(2500);
  await a.getByRole('button', { name: /Sync now/ }).click();
  await expect(a.getByText('Syncing…')).toBeHidden({ timeout: 15_000 });
  // Friday evening the second device comes back with its Thursday copy: its
  // return check would have moved the task into Today, a newer change.
  const back = await second.newPage();
  await back.clock.setFixedTime(new Date('2026-11-20T18:00:00'));
  await back.goto('/app/');
  await synced(back);
  await openList(back, 'Today');
  await expect(back.getByRole('checkbox', { name: 'Mark not done: Water the plants' })).toBeVisible({ timeout: 15_000 });
  // And the first device still has it completed after its next sync.
  await a.reload();
  await synced(a);
  await openList(a, 'Today');
  await expect(a.getByRole('checkbox', { name: 'Mark not done: Water the plants' })).toBeVisible({ timeout: 15_000 });
  await first.close();
  await second.close();
});

/**
 * Take one device off GitHub, or back on. `setOffline` alone doesn't stop
 * requests the faked GitHub answers, so they're refused here too.
 */
const GITHUB = /^https:\/\/(api\.github\.com|gist\.githubusercontent\.com)\//;
const refuse = (route: Route) => route.abort('internetdisconnected');
async function offline(context: BrowserContext, off: boolean): Promise<void> {
  await context.setOffline(off);
  // Only this handler: the faked GitHub's own route stays.
  if (off) await context.route(GITHUB, refuse);
  else await context.unroute(GITHUB, refuse);
}

/**
 * Wait until everything on `page` is in the gist: a Sync Now that uploads
 * nothing means the gist already holds this device's changes.
 */
async function pushed(page: Page, gh: FakeGitHub): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(1500);
    const writes = gh.writes;
    await page.getByRole('button', { name: /Sync now/ }).click();
    await page.waitForTimeout(1500);
    await expect(page.getByText('Syncing…')).toBeHidden({ timeout: 15_000 });
    if (gh.writes === writes) return;
  }
  throw new Error('the device kept uploading');
}

test('a completion made offline and a note added on another device are both kept (FR-19.10)', async ({ browser }) => {
  const gh = new FakeGitHub();
  const monday = new Date('2026-11-23T08:00:00');
  const { todo, backup } = sampleRecords(monday);
  const tasks = backup({
    areas: [], projects: [], headings: [], checklistItems: [], tags: [], contexts: [], savedSearches: [],
    todos: [todo('milk', 'Buy milk', { start: 'unscheduled', startDate: localDate(monday) })],
  });
  // Both devices start with the task.
  const first = await browser.newContext();
  await fakeGitHub(first, gh);
  const john = await first.newPage();
  await john.clock.setFixedTime(monday);
  await connect(john);
  await restoreSample(john, tasks);
  await synced(john);
  const second = await browser.newContext();
  await fakeGitHub(second, gh);
  const jane = await second.newPage();
  await jane.clock.setFixedTime(monday);
  await connect(jane);
  await synced(jane);
  // 9:00, John's phone is offline and he completes it.
  await offline(first, true);
  await john.clock.setFixedTime(new Date('2026-11-23T09:00:00'));
  await openList(john, 'Today');
  await john.getByRole('checkbox', { name: 'Complete: Buy milk' }).click();
  await john.waitForTimeout(2500);
  // 10:00, Jane adds a note, online.
  await jane.clock.setFixedTime(new Date('2026-11-23T10:00:00'));
  await openList(jane, 'Today');
  await jane.getByText('Buy milk', { exact: true }).dblclick();
  await jane.getByLabel('Notes', { exact: true }).fill('Two litres');
  await jane.keyboard.press('Escape');
  await pushed(jane, gh);
  // John comes back online and syncs: his completion and her note are both kept.
  await john.clock.setFixedTime(new Date('2026-11-23T11:00:00'));
  await offline(first, false);
  await john.reload();
  await synced(john);
  await openList(john, 'Today');
  await expect(john.getByRole('checkbox', { name: 'Mark not done: Buy milk' })).toBeVisible({ timeout: 15_000 });
  await john.getByText('Buy milk', { exact: true }).dblclick();
  await expect(john.getByText('Two litres')).toBeVisible();
  // Jane's device takes the combined task at its next sync.
  await jane.clock.setFixedTime(new Date('2026-11-23T11:05:00'));
  await jane.reload();
  await synced(jane);
  await openList(jane, 'Today');
  await expect(jane.getByRole('checkbox', { name: 'Mark not done: Buy milk' })).toBeVisible({ timeout: 15_000 });
  await first.close();
  await second.close();
});

test('a device whose change was replaced by a later one says so, and opens the task (FR-19.12)', async ({ browser }) => {
  const gh = new FakeGitHub();
  const monday = new Date('2026-11-23T08:00:00');
  const { todo, backup } = sampleRecords(monday);
  const tasks = backup({
    areas: [], projects: [], headings: [], checklistItems: [], tags: [], contexts: [], savedSearches: [],
    todos: [todo('milk', 'Buy milk', { start: 'unscheduled', startDate: localDate(monday) })],
  });
  const first = await browser.newContext();
  await fakeGitHub(first, gh);
  const john = await first.newPage();
  await john.clock.setFixedTime(monday);
  await connect(john);
  await restoreSample(john, tasks);
  await synced(john);
  const second = await browser.newContext();
  await fakeGitHub(second, gh);
  const jane = await second.newPage();
  await jane.clock.setFixedTime(monday);
  await connect(jane);
  await synced(jane);
  // 9:00, John renames it offline; 10:00, Jane renames it online.
  await offline(first, true);
  await john.clock.setFixedTime(new Date('2026-11-23T09:00:00'));
  await openList(john, 'Today');
  await john.getByText('Buy milk', { exact: true }).dblclick();
  await john.getByLabel('Title', { exact: true }).fill('Milk');
  await john.keyboard.press('Escape');
  await john.waitForTimeout(500);
  await jane.clock.setFixedTime(new Date('2026-11-23T10:00:00'));
  await openList(jane, 'Today');
  await jane.getByText('Buy milk', { exact: true }).dblclick();
  await jane.getByLabel('Title', { exact: true }).fill('Oat milk');
  await jane.keyboard.press('Escape');
  await pushed(jane, gh);
  // John comes back online: Jane's title is kept, and his device says his was replaced.
  await john.clock.setFixedTime(new Date('2026-11-23T11:00:00'));
  // The network's return starts a sync by itself (FR-19.5).
  await offline(first, false);
  const notice = john.getByRole('dialog', { name: '1 of your changes was replaced by a later change from another device' });
  await expect(notice).toBeVisible({ timeout: 30_000 });
  await expect(notice.getByText('— title')).toBeVisible();
  await notice.getByRole('button', { name: 'Oat milk' }).click();
  await expect(notice).toBeHidden();
  await expect(john.getByLabel('Title', { exact: true })).toHaveValue('Oat milk');
  // Jane's device lost nothing, so it says nothing.
  await jane.reload();
  await synced(jane);
  await expect(jane.getByRole('dialog')).toHaveCount(0);
  await first.close();
  await second.close();
});
