/**
 * The Content Security Policy (NFR-11): scripts only from the app, and no
 * connections outside it except the user's gist (NFR-10).
 */
import { describe, expect, it } from 'vitest';
import { CSP, GITHUB_HOSTS } from '../src/lib/csp';

/** The policy as a map of directive to sources. */
const directives = new Map(
  CSP.split(';').map((d) => {
    const [name, ...sources] = d.trim().split(/\s+/);
    return [name, sources] as const;
  }),
);

describe('Content Security Policy', () => {
  it('allows scripts only from the app: no inline scripts, no eval', () => {
    expect(directives.get('script-src')).toEqual(["'self'"]);
    expect(CSP).not.toContain('unsafe-eval');
    expect(directives.get('default-src')).toEqual(["'self'"]);
  });

  it('connects only to the app and GitHub’s gist API', () => {
    expect(GITHUB_HOSTS).toEqual(['https://api.github.com', 'https://gist.githubusercontent.com']);
    expect(directives.get('connect-src')).toEqual(["'self'", ...GITHUB_HOSTS]);
  });

  it('blocks plugins, <base> and form posts', () => {
    expect(directives.get('object-src')).toEqual(["'none'"]);
    expect(directives.get('base-uri')).toEqual(["'none'"]);
    expect(directives.get('form-action')).toEqual(["'none'"]);
  });

  it('has nothing that would break the meta tag it goes in', () => {
    expect(CSP).not.toMatch(/["<>]/);
  });
});

/** Files read as text, as tests/website.test.ts does. */
const files = import.meta.glob<string>(['../site/_headers', '../wrangler.jsonc'], { query: '?raw', import: 'default', eager: true });

describe('Cloudflare hosting (NFR-13): site/_headers and wrangler.jsonc', () => {
  const headers = files['../site/_headers'];
  /** The header lines under a path rule, up to the next blank line. */
  const rule = (path: string) => headers.split(`\n${path}\n`)[1]?.split('\n\n')[0] ?? '';

  it('forbids framing and sniffing on every page, beside the meta-tag policies', () => {
    expect(rule('/*')).toContain("Content-Security-Policy: frame-ancestors 'none'");
    expect(rule('/*')).toContain('X-Content-Type-Options: nosniff');
    // Only frame-ancestors: a second full policy would also apply, and the
    // website's (no connections) would then block the app's sync.
    expect(rule('/*').match(/Content-Security-Policy: (.*)/)?.[1]).toBe("frame-ancestors 'none'");
  });

  it('makes browsers check for a new stylesheet and service worker', () => {
    for (const path of ['/assets/site.css', '/sw.js', '/app/sw.js']) expect(rule(path), path).toContain('Cache-Control: no-cache');
  });

  it('serves the whole build, files only', () => {
    const config = files['../wrangler.jsonc'];
    expect(config).toContain('"directory": "./dist"');
    expect(config).not.toContain('"main"');
  });
});
