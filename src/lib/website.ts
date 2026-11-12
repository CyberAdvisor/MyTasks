/**
 * The website around the app (site/, design doc NFR-13). The app links to it
 * from Setup, the sidebar's ? button and Settings › About My Tasks. Links
 * always open in a new tab (or the browser, from the installed app): the
 * website's home page sends an installed app straight back to /app/.
 */

/** Where the website lives. */
export const WEBSITE = 'https://mytasks.fyi';

/** The website's pages, by name. tests/website.test.ts checks each exists in site/. */
export const SITE_PAGES = {
  home: '/',
  guide: '/guide/',
  limitations: '/limitations/',
  privacy: '/privacy/',
  security: '/security/',
} as const;

export type SitePage = keyof typeof SITE_PAGES;

/** The full address of a website page. */
export function siteUrl(page: SitePage): string {
  return WEBSITE + SITE_PAGES[page];
}

/**
 * The "Last updated" date of the Limitations page. Setup records it with the
 * user's acknowledgment, so it shows which version of the page they read.
 * Change it whenever that page changes (tests/website.test.ts checks they match).
 */
export const LIMITATIONS_UPDATED = '2026-11-12';
