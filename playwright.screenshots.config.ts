/**
 * `npm run screenshots` (e2e/screenshots.shoot.ts): the README and website
 * screenshots, against the same production build and server as the interface
 * tests (playwright.config.ts), in Playwright's own Chromium (installed in the
 * user folder by `npx playwright install chromium`). On a Mac, text renders in
 * the Mac's own font.
 */
import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  testMatch: /\.shoot\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  projects: [
    {
      name: 'screenshots',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
