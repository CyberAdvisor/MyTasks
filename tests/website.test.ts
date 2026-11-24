/**
 * The website in site/ (design doc NFR-13): every page carries the website's
 * Content Security Policy, uses no inline scripts or styles, shares the same
 * header and footer, links only to pages, files and anchors that exist, and
 * has its canonical address and share tags, with every page in the sitemap.
 */
import { describe, expect, it } from 'vitest';
import { CSP, SITE_CSP } from '../src/lib/csp';
import appHtml from '../index.html?raw';
import sitemap from '../site/sitemap.xml?raw';
import robots from '../site/robots.txt?raw';
import { COMMUNITY, LIMITATIONS_UPDATED, SITE_PAGES } from '../src/lib/website';
import { version } from '../package.json';

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
  it('has the twelve pages', () => {
    expect(pages.map((p) => p.name).sort()).toEqual([
      'about/index.html',
      'book/index.html',
      'compare/index.html',
      'guide/index.html',
      'import/index.html',
      'index.html',
      'limitations/index.html',
      'methods/index.html',
      'privacy/index.html',
      'roadmap/index.html',
      'security/index.html',
      'self-hosting/index.html',
    ]);
  });

  it('keeps the comparison on its own page, with My Tasks and four others, linked from Home', () => {
    const home = sources['../site/index.html'];
    expect(home).not.toContain('<table class="cmp">');
    expect(home).toContain('href="/compare/"');
    const header = block(sources['../site/compare/index.html'], '<table class="cmp">', '</tr>');
    expect(header.match(/<th>/g)).toHaveLength(5);
  });

  it('points to r/mytasksfyi for help: Home, the footer, Troubleshooting and Limitations item 9', () => {
    const page = (name: string) => sources[`../site/${name}`];
    expect(block(page('index.html'), 'id="help"', '</section>')).toContain(`href="${COMMUNITY}"`);
    expect(block(page('index.html'), '<footer class="site">', '</footer>')).toContain(`href="${COMMUNITY}"`);
    expect(block(page('guide/index.html'), 'id="troubleshooting"', '</main>')).toContain(`href="${COMMUNITY}"`);
    expect(block(page('limitations/index.html'), 'id="no-warranty"', '</div>')).toContain(`href="${COMMUNITY}"`);
  });

  it('links to Ko-fi for donations, from Home and the footer', () => {
    const home = sources['../site/index.html'];
    expect(block(home, '<section class="hero">', '</section>')).toContain('href="https://ko-fi.com/Z8O623D716"');
    expect(block(home, '<footer class="site">', '</footer>')).toContain('href="https://ko-fi.com/Z8O623D716"');
  });

  it('answers common questions on Home, each opening on click', () => {
    const faq = block(sources['../site/index.html'], 'id="faq"', '</section>');
    expect(faq.match(/<details><summary>/g)?.length).toBeGreaterThanOrEqual(6);
  });

  it('links from the Guide to Ways to organize', () => {
    expect(sources['../site/guide/index.html']).toContain('href="/methods/"');
  });

  it('keeps the header short and sorts the footer into three titled columns', () => {
    const home = sources['../site/index.html'];
    const nav = block(home, '<nav class="main">', '</nav>');
    expect([...nav.matchAll(/<a [^>]*>([^<]+)<\/a>/g)].map((m) => m[1])).toEqual([
      'Features', 'Guide', 'Compare', 'Limitations', 'Open the app',
    ]);
    const footer = block(home, '<footer class="site">', '</footer>');
    expect([...footer.matchAll(/<h2>([^<]+)<\/h2>/g)].map((m) => m[1])).toEqual(['Product', 'Help', 'Project']);
    expect(footer).toContain('href="/about/"');
    expect(block(footer, '<div class="base">', '</div>')).toContain('href="/privacy/"');
  });

  it('offers the book as EPUB and PDF, linked from Home, the footer, the Guide and the app', () => {
    const book = sources['../site/book/index.html'];
    for (const file of ['/book/my-tasks-your-way.epub', '/book/my-tasks-your-way.pdf']) {
      expect(book).toContain(`href="${file}" download`);
      expect(siteFiles.has(file.slice(1)), file).toBe(true);
    }
    expect(book).toContain('ISBN 978-1-964431-15-4');
    expect(book).toContain('ISBN 978-1-964431-16-1');
    // Free everywhere, and no store named.
    expect(book).toContain('Also free at major online book outlets.');
    const home = sources['../site/index.html'];
    expect(block(home, 'id="book"', '</section>')).toContain('href="/book/"');
    expect(block(home, '<footer class="site">', '</footer>')).toContain('href="/book/"');
    expect(sources['../site/guide/index.html']).toContain('href="/book/"');
    expect(SITE_PAGES.book).toBe('/book/');
  });

  it('names a book edition no newer than the app', () => {
    const reflects = sources['../site/book/index.html'].match(/as of version (\d+)\.(\d+)\.(\d+)/)!.slice(1).map(Number);
    const app = version.split('.').map(Number);
    expect(reflects[0] * 1e6 + reflects[1] * 1e3 + reflects[2]).toBeLessThanOrEqual(app[0] * 1e6 + app[1] * 1e3 + app[2]);
  });

  it('points from Limitations item 9 to the self-hosting guide', () => {
    const item9 = block(sources['../site/limitations/index.html'], 'id="no-warranty"', '</div>');
    expect(item9).toContain('href="/self-hosting/"');
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

  it.each(pages)('$name has its canonical address and the tags a shared link shows', ({ name, html }) => {
    const url = 'https://mytasks.fyi/' + name.replace(/index\.html$/, '');
    const title = html.match(/<title>([^<]*)<\/title>/)![1];
    const description = html.match(/<meta name="description" content="([^"]*)">/)![1];
    expect(html).toContain(`<link rel="canonical" href="${url}">`);
    expect(html).toContain(`<meta property="og:url" content="${url}">`);
    expect(html).toContain(`<meta property="og:title" content="${title}">`);
    expect(html).toContain(`<meta property="og:description" content="${description}">`);
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    const image = html.match(/<meta property="og:image" content="https:\/\/mytasks\.fyi(\/[^"]+)">/)![1];
    expect(served(image), image).toBe(true);
  });

  it('lists every page in the sitemap, which robots.txt names, keeping search engines out of the app', () => {
    const listed = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).sort();
    const expected = pages.map((p) => 'https://mytasks.fyi/' + p.name.replace(/index\.html$/, '')).sort();
    expect(listed).toEqual(expected);
    expect(robots).toContain('Disallow: /app/');
    expect(robots).toContain('Sitemap: https://mytasks.fyi/sitemap.xml');
  });

  it('never names a version, except on the Roadmap page and the Book page (the version the book reflects)', () => {
    for (const { name, html } of pages) {
      if (name === 'roadmap/index.html' || name === 'book/index.html') continue;
      expect(html, name).not.toMatch(/\bv?\d+\.\d+\.\d+\b|version \d/i);
    }
  });
});

describe('links from the app (src/lib/website.ts)', () => {
  it('point only at pages that exist', () => {
    for (const path of Object.values(SITE_PAGES)) expect(siteFiles.has(fileFor(path)), path).toBe(true);
  });

  it('record the Limitations page\'s own "Last updated" date with the acknowledgment', () => {
    const shown = sources['../site/limitations/index.html'].match(/Last updated ([A-Z][a-z]+ \d{1,2}, \d{4})/)?.[1];
    const [y, m, d] = LIMITATIONS_UPDATED.split('-').map(Number);
    const expected = new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    expect(shown).toBe(expected);
  });
});

describe('the website policy', () => {
  it('allows only its own files and no connections, so nothing from another site shares the app\'s origin', () => {
    expect(SITE_CSP).not.toContain('unsafe');
    expect(SITE_CSP).toContain("script-src 'self';");
    expect(SITE_CSP).toContain("img-src 'self';");
    expect(SITE_CSP).toContain("connect-src 'none'");
    expect(SITE_CSP).not.toMatch(/https?:/);
    for (const { html } of pages) expect(html).not.toMatch(/<(script|img)[^>]+src="https?:/);
    expect(CSP).toContain("script-src 'self';");
    expect(appHtml).not.toMatch(/<script[^>]+src="https?:/);
  });
});
