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
