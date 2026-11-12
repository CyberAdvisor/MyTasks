/**
 * The website in site/ (design doc NFR-13): every page carries the website's
 * Content Security Policy, uses no inline scripts or styles, shares the same
 * header and footer, and links only to pages, files and anchors that exist.
 */
import { describe, expect, it } from 'vitest';
import { SITE_CSP } from '../src/lib/csp';

/** Every page's HTML, by path under site/ (e.g. "guide/index.html"). */
const sources = import.meta.glob<string>('../site/**/*.html', { query: '?raw', import: 'default', eager: true });
const pages = Object.entries(sources).map(([path, text]) => ({ name: path.slice('../site/'.length), html: text }));

/** Every file the website serves, by path under site/, plus the app's own public files under app/. */
const siteFiles = new Set(Object.keys(import.meta.glob('../site/**/*')).map((p) => p.slice('../site/'.length)));
const appFiles = new Set(Object.keys(import.meta.glob('../public/*')).map((p) => 'app/' + p.slice('../public/'.length)));

/** The text between two markers, inclusive. */
function block(html: string, start: string, end: string): string {
  const i = html.indexOf(start);
  return html.slice(i, html.indexOf(end, i) + end.length);
}

/** The file under site/ that an absolute path serves: the file itself, or a folder's index.html. */
function fileFor(path: string): string {
  const name = path.slice(1);
  return path.endsWith('/') ? name + 'index.html' : name;
}

/** Does the site serve something at this absolute path? /app/ is the app, built into dist/app/. */
function served(path: string): boolean {
  if (path === '/app/') return true;
  return siteFiles.has(fileFor(path)) || appFiles.has(path.slice(1));
}

describe('website pages', () => {
  it('has the five pages', () => {
    expect(pages.map((p) => p.name).sort()).toEqual([
      'guide/index.html',
      'index.html',
      'limitations/index.html',
      'privacy/index.html',
      'security/index.html',
    ]);
  });

  it.each(pages)('$name carries the website CSP and nothing inline', ({ html }) => {
    expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="${SITE_CSP}">`);
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/); // every script has a src
    expect(html).not.toMatch(/\sstyle=|<style/);
    expect(html).not.toMatch(/\son[a-z]+=/); // no inline event handlers
  });

  it('shares one header and footer across pages', () => {
    const headers = new Set(pages.map((p) => block(p.html, '<header class="site">', '</header>')));
    const footers = new Set(pages.map((p) => block(p.html, '<footer class="site">', '</footer>')));
    expect(headers.size).toBe(1);
    expect(footers.size).toBe(1);
  });

  it.each(pages)('$name links only to pages, files and anchors that exist', ({ html }) => {
    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    for (const [, url] of html.matchAll(/(?:href|src|srcset)="([^"]+)"/g)) {
      if (/^https?:/.test(url)) continue;
      if (url.startsWith('#')) {
        expect(ids, url).toContain(url.slice(1));
        continue;
      }
      const [path, hash] = url.split('#');
      expect(served(path), url).toBe(true);
      if (hash) {
        expect(sources[`../site/${fileFor(path)}`], url).toContain(`id="${hash}"`);
      }
    }
  });

  it('never names a version', () => {
    for (const { name, html } of pages) expect(html, name).not.toMatch(/\bv?\d+\.\d+\.\d+\b|version \d/i);
  });
});

describe('the website policy', () => {
  it('allows only its own files and no connections', () => {
    expect(SITE_CSP).not.toContain('unsafe');
    expect(SITE_CSP).toContain("connect-src 'none'");
    expect(SITE_CSP).toContain("script-src 'self'");
  });
});
