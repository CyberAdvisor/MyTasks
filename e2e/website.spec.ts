/**
 * The website (site/) as served: every page opens without errors, and every
 * link to another page of the site works. tests/website.test.ts checks the
 * files; this checks them in a browser.
 */
import { expect, test } from '@playwright/test';
import { watchErrors } from './app';

const PAGES = ['/', '/guide/', '/limitations/', '/privacy/', '/security/', '/roadmap/'];

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
