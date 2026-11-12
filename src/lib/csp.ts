/**
 * The Content Security Policy (NFR-11). The build puts it in a <meta> tag in
 * index.html (vite.config.ts), because GitHub Pages cannot send headers.
 *
 * - Scripts come only from the app itself: no inline scripts, no `eval`.
 * - The only connections outside the app go to the user's gist (NFR-10).
 * - Inline style attributes are allowed; several components set them.
 *
 * A meta tag cannot carry `frame-ancestors` or violation reports; that needs
 * headers, which GitHub Pages does not offer.
 */

/** The hosts outside the app that it may connect to: GitHub's gist API. */
export const GITHUB_HOSTS = ['https://api.github.com', 'https://gist.githubusercontent.com'] as const;

const DIRECTIVES: Record<string, string[]> = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'"],
  'connect-src': ["'self'", ...GITHUB_HOSTS],
  'manifest-src': ["'self'"],
  'worker-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'none'"],
};

/** The policy, as the content of the meta tag. */
export const CSP = Object.entries(DIRECTIVES)
  .map(([name, sources]) => `${name} ${sources.join(' ')}`)
  .join('; ');
