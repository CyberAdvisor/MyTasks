/**
 * NFR-7 timing run (not part of the test suite): seeds 4,000 open and 1,000
 * completed tasks into IndexedDB, then times Quick Find (typing, and the
 * search on Return), typing in a task's
 * title around a save, a check-off and a change to several tasks. Prints the
 * numbers; asserts nothing.
 *
 * Run: npm run perf (by hand; not part of the PR check). To name the
 * functions in its profiles, build once with `sourcemap: true` in
 * vite.config.ts's `build`, then undo it.
 *
 * Each key's time is measured in the page: from its keydown to the end of the
 * task that handles it ("work", script and DOM updates) and to the next frame
 * after it ("frame"). Long tasks (over 50 ms) are logged with their time.
 */
import { test, expect, type Page } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { SourceMapConsumer } from 'source-map-js';

import { connect } from '../e2e/app';
import { fakeGitHub } from '../e2e/fakeGitHub';
import { seed } from './seed';
import { quickFind, searchTodos } from '../src/lib/model/search';
import { LIST_META } from '../src/lib/listMeta';

/** Source maps of the build's scripts, when built with sourcemap on, to name profiled functions. */
const maps = new Map<string, SourceMapConsumer>();
function original(url: string, line: number, column: number): string | null {
  const file = url.split('/').pop()!;
  if (!file.endsWith('.js')) return null;
  if (!maps.has(file)) {
    const dir = 'dist/app/assets';
    if (!readdirSync(dir).includes(`${file}.map`)) return null;
    maps.set(file, new SourceMapConsumer(JSON.parse(readFileSync(`${dir}/${file}.map`, 'utf8'))));
  }
  const p = maps.get(file)!.originalPositionFor({ line: line + 1, column });
  return p.source ? `${p.name ?? ''} ${p.source.replace(/^.*\/(src|node_modules)\//, '$1/')}:${p.line}` : null;
}

/** Hooks installed on every page load: key timings and long tasks. */
function hooks() {
  const w = window as unknown as { __keys: { key: string; work: number; frame: number }[]; __long: { at: number; ms: number }[] };
  w.__keys = [];
  w.__long = [];
  document.addEventListener(
    'keydown',
    (e) => {
      const t0 = performance.now();
      const entry = { key: e.key, work: 0, frame: 0 };
      w.__keys.push(entry);
      const ch = new MessageChannel();
      ch.port1.onmessage = () => (entry.work = performance.now() - t0);
      ch.port2.postMessage(0);
      requestAnimationFrame(() => {
        const c2 = new MessageChannel();
        c2.port1.onmessage = () => (entry.frame = performance.now() - t0);
        c2.port2.postMessage(0);
      });
    },
    true,
  );
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) w.__long.push({ at: e.startTime, ms: e.duration });
  }).observe({ type: 'longtask', buffered: true });
}

const take = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __keys: { key: string; work: number; frame: number }[]; __long: { at: number; ms: number }[] };
    const out = { keys: w.__keys, long: w.__long, now: performance.now() };
    w.__keys = [];
    w.__long = [];
    return out;
  });

const r = (n: number) => Math.round(n);

/** Start Chromium's CPU profiler; the returned function stops it and prints the top functions by self time. */
async function profile(page: Page, label: string): Promise<() => Promise<void>> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Profiler.start');
  return async () => {
    const { profile: p } = (await cdp.send('Profiler.stop')) as { profile: { nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number; columnNumber: number }; hitCount?: number }[]; samples: number[]; timeDeltas: number[] } };
    const byNode = new Map<number, number>();
    p.samples.forEach((id, i) => byNode.set(id, (byNode.get(id) ?? 0) + (p.timeDeltas[i] ?? 0) / 1000));
    const byFn = new Map<string, number>();
    for (const n of p.nodes) {
      const f = n.callFrame;
      const name = original(f.url, f.lineNumber, f.columnNumber) ?? `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber}`;
      byFn.set(name, (byFn.get(name) ?? 0) + (byNode.get(n.id) ?? 0));
    }
    const top = [...byFn].filter(([k]) => !/^\(idle\)|^\(program\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 25);
    console.log(`profile ${label}:\n` + top.map(([k, v]) => `  ${r(v)} ms  ${k}`).join('\n'));
    await cdp.detach();
  };
}
const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return `median ${r(s[Math.floor(s.length / 2)])} ms, max ${r(s[s.length - 1])} ms`;
};

test('NFR-7 timings', async ({ browser }) => {
  test.setTimeout(600_000);
  const data = seed();

  // The functions alone, in Node, for comparison with the page.
  const snap = { ...data, headings: [], savedSearches: [] } as never;
  const titles = Object.fromEntries(Object.entries(LIST_META).map(([k, m]) => [k, m.title])) as never;
  for (const q of ['r', 're', 'rev', 'revi', 'review', 'review p', 'review pl']) {
    const t0 = performance.now();
    for (let i = 0; i < 10; i++) quickFind(snap, q, titles);
    const qf = (performance.now() - t0) / 10;
    const t1 = performance.now();
    for (let i = 0; i < 10; i++) searchTodos(snap, { query: q, tagIds: [] });
    console.log(`node quickFind("${q}") ${qf.toFixed(1)} ms; searchTodos ${((performance.now() - t1) / 10).toFixed(1)} ms`);
  }

  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await fakeGitHub(context);
  await context.addInitScript(hooks);
  const page = await context.newPage();
  await connect(page);

  // Seed straight into IndexedDB, then reload and let the first sync finish.
  await page.evaluate(async (d) => {
    const db: IDBDatabase = await new Promise((ok, fail) => {
      const req = indexedDB.open('mytasks');
      req.onsuccess = () => ok(req.result);
      req.onerror = () => fail(req.error);
    });
    const names = Object.keys(d) as (keyof typeof d)[];
    const tx = db.transaction(names, 'readwrite');
    for (const n of names) for (const row of d[n]) tx.objectStore(n).put(row);
    await new Promise<void>((ok, fail) => {
      tx.oncomplete = () => ok();
      tx.onerror = () => fail(tx.error);
    });
    db.close();
  }, data);
  const t0 = Date.now();
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Lists' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/^Synced /)).toBeVisible({ timeout: 60_000 });
  console.log(`reload to Synced: ${Date.now() - t0} ms`);
  await page.waitForTimeout(3000);
  const startup = await take(page);
  console.log(`startup long tasks: ${startup.long.map((l) => `${r(l.ms)}`).join(', ')}`);

  // 1. Quick Find: typing (no search), then the search on Return.
  await page.evaluate(() => (location.hash = '#/today'));
  await page.waitForTimeout(1000);
  await take(page);
  await page.keyboard.press('/');
  await expect(page.getByRole('dialog', { name: 'Quick Find' })).toBeVisible();
  await page.waitForTimeout(500);
  await take(page);
  const stopFind = await profile(page, 'Quick Find typing and Return');
  for (const ch of 'review plan') {
    await page.keyboard.type(ch);
    await page.waitForTimeout(300);
  }
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  await stopFind();
  const qf = await take(page);
  const typed = qf.keys.filter((k) => k.key !== 'Enter');
  const search = qf.keys.find((k) => k.key === 'Enter')!;
  console.log(`Quick Find typing: work ${stats(typed.map((k) => k.work))}; frame ${stats(typed.map((k) => k.frame))}`);
  console.log(`Quick Find search on Return: work ${r(search.work)} ms; frame ${r(search.frame)} ms`);
  await page.keyboard.press('Escape');

  // 2. Typing in an open task's title: steady typing, then a key at points during the save.
  const row = page.locator('main .row').first();
  await row.dblclick();
  const title = page.locator('main .card input, main .card textarea').first();
  await title.click();
  await expect(title).toBeFocused();
  await page.keyboard.press('End');
  await page.waitForTimeout(1000);
  await take(page);
  for (const ch of ' steady typing') {
    await page.keyboard.type(ch);
    await page.waitForTimeout(80);
  }
  await page.waitForTimeout(2000);
  const steady = await take(page);
  console.log(`title, steady typing: work ${stats(steady.keys.map((k) => k.work))}; frame ${stats(steady.keys.map((k) => k.frame))}`);
  console.log(`  long tasks after it: ${steady.long.map((l) => `${r(l.ms)}`).join(', ') || 'none'}`);

  const during: string[] = [];
  let worst = 0;
  for (let gap = 300; gap <= 600; gap += 25) {
    await page.keyboard.type('x');
    await page.waitForTimeout(gap); // the save starts 300 ms after the last key
    await page.keyboard.type('y');
    await page.waitForTimeout(2500); // let the save and the sync after it finish
    const t = await take(page);
    const y = t.keys[t.keys.length - 1];
    worst = Math.max(worst, y.frame);
    during.push(`${gap}:${r(y.work)}/${r(y.frame)}`);
  }
  console.log(`title, key at N ms after the previous (work/frame): ${during.join(' ')}`);
  console.log(`  worst key during a save: ${r(worst)} ms`);

  // One save on its own, with what follows it (the sync 2 s later).
  const stopSave = await profile(page, 'one save (4 s)');
  await page.keyboard.type('z');
  const s0 = await page.evaluate(() => performance.now());
  await page.waitForTimeout(4000);
  await stopSave();
  const save = await take(page);
  console.log(`one save: long tasks ${save.long.map((l) => `${r(l.ms)} ms at +${r(l.at - s0)}`).join(', ') || 'none'}`);
  await page.keyboard.press('Escape');

  // 3. A check-off in Today.
  await page.waitForTimeout(3000);
  await take(page);
  const c0 = await page.evaluate(() => performance.now());
  await page.locator('main .row').nth(3).getByRole('checkbox').click();
  await page.waitForTimeout(5000);
  const check = await take(page);
  console.log(`check-off: long tasks ${check.long.map((l) => `${r(l.ms)} ms at +${r(l.at - c0)}`).join(', ') || 'none'}`);

  // 4. Several tasks at once: all 200 Inbox tasks to Today.
  await page.evaluate(() => (location.hash = '#/inbox'));
  await expect(page.locator('main .row').first()).toBeVisible();
  await page.locator('main .row').first().click();
  const inboxLink = page.getByRole('navigation', { name: 'Lists' }).getByRole('link', { name: /^Inbox/ });
  console.log(`inbox before: ${await inboxLink.textContent()}`);
  await page.keyboard.press('ControlOrMeta+a');
  await page.waitForTimeout(2000);
  console.log(`selected: ${await page.locator('main .row.selected').count()}`);
  await take(page);
  const m0 = await page.evaluate(() => performance.now());
  await page.keyboard.press('t');
  // Poll the sidebar's Inbox count until every task has gone.
  const counts: string[] = [];
  for (let i = 0; i < 400; i++) {
    const n = Number((await inboxLink.textContent())!.replace(/\D/g, '') || 0);
    counts.push(`${n}`);
    if (n === 0) break;
    await page.waitForTimeout(100);
  }
  console.log(`inbox count every 0.1 s: ${counts.join(' ')}`);
  const m1 = await page.evaluate(() => performance.now());
  await page.waitForTimeout(5000);
  const many = await take(page);
  console.log(`200 tasks to Today: all gone after ${r(m1 - m0)} ms; long tasks ${many.long.map((l) => `${r(l.ms)} ms at +${r(l.at - m0)}`).join(', ') || 'none'}`);

  await context.close();
});
