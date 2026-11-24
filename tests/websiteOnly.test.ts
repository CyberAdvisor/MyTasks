/** Which pull requests skip GitHub's interface check (scripts/websiteOnly.mjs). */
import { describe, expect, it } from 'vitest';
import { websiteOnly } from '../scripts/websiteOnly.mjs';

describe('websiteOnly', () => {
  it('skips a PR that changes only website pages, docs or the top-level notes', () => {
    expect(websiteOnly(['site/privacy/index.html', 'site/assets/site.css', 'README.md', 'CHANGELOG.md', 'docs/images/a.png'])).toBe(true);
  });

  it('keeps the check when anything can reach the app', () => {
    // A website change with the policy in src/lib/csp.ts and the tests.
    expect(websiteOnly(['site/index.html', 'src/lib/csp.ts', 'tests/website.test.ts', 'e2e/website.spec.ts'])).toBe(false);
    for (const f of ['src/App.svelte', 'e2e/app.ts', 'helper/calendar_sync.py', 'package.json', 'package-lock.json', '.github/workflows/deploy.yml', 'index.html', 'public/favicon.svg']) {
      expect(websiteOnly(['site/index.html', f]), f).toBe(false);
    }
  });

  it('keeps the check when the list is empty', () => {
    expect(websiteOnly([])).toBe(false);
    expect(websiteOnly(['', ' '])).toBe(false);
  });
});
