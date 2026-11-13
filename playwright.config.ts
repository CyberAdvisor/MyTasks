/**
 * Interface tests (`npm run test:ui`): real browsers against a production
 * build, served as GitHub Pages serves it (scripts/serve.mjs), with GitHub
 * faked (e2e/fakeGitHub.ts). The unit tests (Vitest, jsdom) can't see real
 * IndexedDB transactions, the Content Security Policy, the service worker or
 * layout; these tests can.
 *
 * Every test runs in desktop Chromium and desktop WebKit (close to Safari, the
 * reference platform). Tests of the phone layout run in WebKit at iPhone size.
 */
import { defineConfig, devices } from '@playwright/test';

/** Not 4173, so a running `npm run preview` doesn't get in the way. */
const PORT = 4174;
const CI = !!process.env.CI;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Most tests don't need the service worker; the offline test turns it on.
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /phone\.spec/ },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, testIgnore: /phone\.spec/ },
    { name: 'iphone', use: { ...devices['iPhone 15'] }, testMatch: /phone\.spec/ },
  ],
  webServer: {
    command: `npm run build && node scripts/serve.mjs ${PORT}`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !CI,
    timeout: 180_000,
  },
});
