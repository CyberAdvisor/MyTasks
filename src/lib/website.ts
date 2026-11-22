/**
 * The website around the app (site/, design doc NFR-13). The app links to it
 * from Setup, the sidebar's ? button, Settings › About My Tasks (which also
 * links the Book page) and the version stamp (the Roadmap page). Links
 * always open in a new tab (or the browser, from the installed app): the
 * website's home page sends an installed app straight back to /app/.
 */

/** Where the website lives. */
const WEBSITE = 'https://mytasks.fyi';

/** The My Tasks community on Reddit, for help, ideas and news (Settings › About My Tasks). */
export const COMMUNITY = 'https://www.reddit.com/r/mytasksfyi/';

/** The website's pages, by name. tests/website.test.ts checks each exists in site/. */
export const SITE_PAGES = {
  home: '/',
  guide: '/guide/',
  limitations: '/limitations/',
  privacy: '/privacy/',
  security: '/security/',
  roadmap: '/roadmap/',
  import: '/import/',
  book: '/book/',
} as const;

export type SitePage = keyof typeof SITE_PAGES;

/** The full address of a website page, or of a section of it (`hash`, without the #). */
export function siteUrl(page: SitePage, hash = ''): string {
  return WEBSITE + SITE_PAGES[page] + (hash ? `#${hash}` : '');
}

/**
 * The "Last updated" date of the Limitations page. Setup records it with the
 * user's acknowledgment, so it shows which version of the page they read.
 * Change it whenever that page changes (tests/website.test.ts checks they match).
 */
export const LIMITATIONS_UPDATED = '2026-11-22';
