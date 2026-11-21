/**
 * The NFR-7 timing run (`npm run perf`), by hand only: not part of the
 * interface tests or the PR check. Desktop Chromium against a production
 * build on port 4174, with GitHub faked, as the interface tests. Where
 * Playwright's own Chromium can't be downloaded (the cloud workspace), it
 * uses /usr/bin/google-chrome.
 */
import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const CHROME = '/usr/bin/google-chrome';

export default defineConfig({
  testDir: '.',
  testMatch: /timing\.spec\.ts/,
  reporter: 'list',
  use: { baseURL: 'http://localhost:4174', serviceWorkers: 'block' },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], ...(existsSync(CHROME) ? { launchOptions: { executablePath: CHROME } } : {}) },
    },
  ],
  webServer: {
    cwd: '..',
    command: 'npm run build && node scripts/serve.mjs 4174',
    url: 'http://localhost:4174/',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
