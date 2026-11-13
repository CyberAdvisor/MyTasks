/**
 * The Content Security Policy (NFR-11) in a real browser: the built page
 * carries it, and connecting and using the app breaks none of its rules.
 */
import { expect, test } from '@playwright/test';
import { addTask, connect, openList, synced, watchErrors } from './app';
import { fakeGitHub } from './fakeGitHub';

test('connecting and adding a task break no policy rule', async ({ page, context }) => {
  // Record violations from the browser's own event, in every browser.
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { cspViolations: string[] }).cspViolations = seen;
    document.addEventListener('securitypolicyviolation', (e) => seen.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  const errors = watchErrors(page);
  await fakeGitHub(context);
  await connect(page);

  const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(policy).toContain("script-src 'self'");
  expect(policy).toContain('https://api.github.com');

  await openList(page, 'Inbox');
  await addTask(page, 'Renew passport');
  await synced(page);
  expect(await page.evaluate(() => (window as unknown as { cspViolations: string[] }).cspViolations)).toEqual([]);
  expect(errors).toEqual([]);
});
