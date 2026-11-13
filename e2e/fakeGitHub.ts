/**
 * GitHub, faked for the interface tests: the browser's requests to
 * api.github.com and gist.githubusercontent.com are answered by the same
 * in-memory FakeGitHub the unit tests use (tests/fakeGitHub.ts). Nothing
 * reaches the real GitHub.
 *
 * Give two browser contexts the same FakeGitHub to act as two devices sharing
 * one gist.
 */
import type { BrowserContext } from '@playwright/test';
import { FakeGitHub } from '../tests/fakeGitHub';

export { FakeGitHub };

/** The app sends an Authorization header, so the browser asks first (CORS). */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
  'access-control-allow-headers': '*',
  'access-control-expose-headers': '*',
};

/** Answer this context's GitHub requests from `gh`. */
export async function fakeGitHub(context: BrowserContext, gh = new FakeGitHub()): Promise<FakeGitHub> {
  await context.route(/^https:\/\/(api\.github\.com|gist\.githubusercontent\.com)\//, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    try {
      const res = await gh.fetch(req.url(), {
        method: req.method(),
        headers: req.headers(),
        body: req.postData() ?? undefined,
      });
      await route.fulfill({
        status: res.status,
        headers: { ...Object.fromEntries(res.headers), ...CORS },
        body: await res.text(),
      });
    } catch {
      // FakeGitHub throws to simulate no network.
      await route.abort('internetdisconnected');
    }
  });
  return gh;
}
