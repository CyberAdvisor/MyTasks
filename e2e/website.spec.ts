/**
 * The website (site/) as served: every page opens without errors, and every
 * link to another page of the site works. tests/website.test.ts checks the
 * files; this checks them in a browser.
 */
import { expect, test } from '@playwright/test';
import { connect, watchErrors } from './app';
import { fakeGitHub } from './fakeGitHub';
import { COMMUNITY } from '../src/lib/website';

const PAGES = ['/', '/guide/', '/limitations/', '/privacy/', '/security/', '/roadmap/', '/self-hosting/', '/compare/', '/methods/', '/about/'];

for (const path of PAGES) {
  test(`website page ${path} opens and its links work`, async ({ page, request }) => {
    const errors = watchErrors(page);
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    await expect(page.locator('h1').first()).toBeVisible();
    await expect(page.locator('footer').getByRole('link', { name: 'Roadmap' })).toBeVisible();

    // Every link within the site, anchors aside, must open.
    const origin = new URL(page.url()).origin;
    const hrefs = await page.locator('a[href]').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
    const own = [...new Set(hrefs.filter((h) => h.startsWith(origin)).map((h) => h.split('#')[0]))];
    for (const href of own) {
      expect((await request.get(href)).status(), href).toBe(200);
    }
    expect(errors).toEqual([]);
  });
}

test("the website's colours match the app's list and sidebar, in light and dark", async ({ page }) => {
  /** Each colour token as the page resolves it, read from an element painted with it. */
  const tokens = (names: string[]) =>
    page.evaluate(
      (ns) =>
        ns.map((n) => {
          const probe = document.body.appendChild(document.createElement('div'));
          probe.style.backgroundColor = `var(${n})`;
          const colour = getComputedStyle(probe).backgroundColor;
          probe.remove();
          return colour;
        }),
      names,
    );
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto('/app/');
    const app = await tokens(['--bg', '--sidebar-bg']);
    await page.goto('/');
    expect(await tokens(['--bg', '--bg-2']), colorScheme).toEqual(app);
  }
});

test('Settings › About My Tasks links to the community on Reddit, in a new tab', async ({ context, page }) => {
  await fakeGitHub(context);
  await connect(page);
  await page.getByRole('link', { name: 'Settings' }).click();
  const link = page.getByRole('link', { name: 'Help and community (r/mytasksfyi)' });
  await expect(link).toHaveAttribute('href', COMMUNITY);
  await expect(link).toHaveAttribute('target', '_blank');
});

test('Settings › About My Tasks links to the Book page, in a new tab', async ({ context, page }) => {
  await fakeGitHub(context);
  await connect(page);
  await page.getByRole('link', { name: 'Settings' }).click();
  const link = page.getByRole('link', { name: 'The book: My Tasks, Your Way' });
  await expect(link).toHaveAttribute('href', 'https://mytasks.fyi/book/');
  await expect(link).toHaveAttribute('target', '_blank');
});

test('the Book page downloads the EPUB and PDF', async ({ page }) => {
  await page.goto('/book/');
  for (const name of ['Download the EPUB', 'Download the PDF']) {
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name }).click()]);
    expect(download.suggestedFilename()).toMatch(/^my-tasks-your-way\.(epub|pdf)$/);
  }
});
