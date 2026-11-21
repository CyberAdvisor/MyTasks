/**
 * Where the app is running, for install and its warnings (FR-0.2 to FR-0.5).
 *
 * Pure functions of the user agent, so they can be tested; the browser
 * values are read only by the defaults.
 */

/**
 * The browser, as far as installing goes:
 * - `ios`: iPhone or iPad. Every browser there is Safari underneath; install
 *   is Share › Add to Home Screen.
 * - `safari`: Safari on a Mac; install is File › Add to Dock.
 * - `chromium`: Chrome, Edge and other Chromium browsers; they offer their own
 *   install prompt.
 * - `firefox`: Firefox on a computer, which cannot install web apps.
 * - `other`: anything else; nothing is shown.
 */
export type Browser = 'ios' | 'safari' | 'chromium' | 'firefox' | 'other';

/** What the sidebar shows above the sync status. */
export type InstallNotice = 'none' | 'install';

/** Work out the browser from its user agent. */
export function detectBrowser(
  ua: string = navigator.userAgent,
  touchPoints: number = navigator.maxTouchPoints ?? 0,
): Browser {
  // iPadOS reports a Mac user agent; only the touch screen gives it away.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)) return 'ios';
  if (/Edg\/|Chrome\/|Chromium\//.test(ua)) return 'chromium';
  if (/Firefox\//.test(ua)) return /Android|Mobile/.test(ua) ? 'other' : 'firefox';
  if (/Macintosh/.test(ua) && /Safari\//.test(ua)) return 'safari';
  return 'other';
}

/** Whether the app is running installed, in its own window (FR-0.5). */
export function isStandalone(): boolean {
  return matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * Whether Print… can open the print dialog (FR-12.5). Safari ignores the
 * print command in apps added to the Home Screen on iPhone and iPad, so there
 * Print… explains instead (found in live testing, 2026-11-14).
 */
export function canPrint(browser: Browser, standalone: boolean): boolean {
  return !(browser === 'ios' && standalone);
}

/**
 * The sidebar's install notice:
 * - installed: nothing;
 * - Safari (iPhone, iPad or Mac), a browser that offered its install prompt,
 *   or Firefox: the Install My Tasks line, which can't be dismissed (decided
 *   2026-11-12, 5f). In Safari and Firefox it opens the install guide.
 *   Safari tabs had a warning that their data can be cleared after 7 days
 *   unused until v1.1.11; the gist keeps the tasks, so it was dropped
 *   (decided 2026-11-14, conversation 2026-11-14-D).
 */
export function installNotice(browser: Browser, standalone: boolean, canPrompt: boolean): InstallNotice {
  if (standalone) return 'none';
  if (browser === 'ios' || browser === 'safari' || browser === 'firefox' || canPrompt) return 'install';
  return 'none';
}

/**
 * Whether Setup shows "Install My Tasks first": on iPhone and iPad, in a
 * tab, where the installed app keeps its own data (FR-0.4; decided
 * 2026-11-12, 5f).
 */
export function installFirst(browser: Browser, standalone: boolean): boolean {
  return browser === 'ios' && !standalone;
}
