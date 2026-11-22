/**
 * `npm run book:pdf`: makes the book's PDF from its EPUB, so the two always
 * carry the same text and pictures.
 *
 *   npm run book:pdf -- site/book/my-tasks-your-way.epub site/book/my-tasks-your-way.pdf
 *
 * The EPUB is the book's source: edit its chapters (EPUB/text/*.xhtml) and
 * pictures (EPUB/media/), zip it, then run this. It reads the EPUB's reading
 * order, lays every chapter out as print pages in Playwright's Chromium (6 ×
 * 9.6 in, Lora for the text, Space Grotesk for headings, a full-page cover,
 * each chapter on a new page, page numbers from Contents on), and sets the
 * PDF's title, author, subject (with the PDF's ISBN) and keywords. The
 * copyright page gets the PDF's ISBN in place of the EPUB's.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

/** The PDF edition's details; the EPUB has its own ISBN in its package. */
const META = {
  /** The copyright page names the format's own ISBN: the EPUB's line, and the PDF's in its place. */
  epubIsbn: 'ISBN 978-1-964431-15-4 (EPUB)',
  pdfIsbn: 'ISBN 978-1-964431-16-1 (PDF)',
  title: 'My Tasks, Your Way',
  author: 'Michael Lines',
  subject: 'Organizing Work and Life with One Simple App. ISBN 978-1-964431-16-1',
  keywords: ['My Tasks', 'task manager', 'time management', 'productivity'],
};

const [epubPath, pdfPath] = process.argv.slice(2);
if (!epubPath || !pdfPath) {
  console.error('Usage: npm run book:pdf -- <book.epub> <book.pdf>');
  process.exit(1);
}

const fonts = resolve('node_modules/@fontsource-variable');
const fontUrl = (file) => pathToFileURL(join(fonts, file)).href;

/** Print layout. Front matter (title to epigraph) has no page numbers; Contents is page 1. */
const CSS = `
@font-face { font-family: 'LoraWeb'; font-weight: 400 700; font-style: normal;
  src: local('Lora'), url('${fontUrl('lora/files/lora-latin-wght-normal.woff2')}') format('woff2'); }
@font-face { font-family: 'LoraWeb'; font-weight: 400 700; font-style: italic;
  src: local('Lora Italic'), local('Lora-Italic'), url('${fontUrl('lora/files/lora-latin-wght-italic.woff2')}') format('woff2'); }
@font-face { font-family: 'Space Grotesk'; font-weight: 300 700;
  src: url('${fontUrl('space-grotesk/files/space-grotesk-latin-wght-normal.woff2')}') format('woff2'); }

@page { size: 6in 9.597in; margin: 0.76in 0.7in 0.82in;
  @bottom-center { content: counter(page); font: 8pt 'Lora', 'LoraWeb', serif; color: #333;
    vertical-align: bottom; padding-bottom: 0.24in; } }
@page cover { margin: 0; }

html { font: 10.455pt/1.5 'Lora', 'LoraWeb', serif; color: #1a1a1a; }
body { margin: 0; }
.cover { page: cover; break-after: page; height: 9.597in; }
.cover img { width: 6in; height: 9.597in; object-fit: cover; display: block; }
.chapter { break-before: page; }

h1, h2 { font-family: 'Space Grotesk', sans-serif; font-weight: 700; color: #111; break-after: avoid; }
h1 { font-size: 18pt; line-height: 1.2; margin: 0.88in 0 0.3in; }
h2 { font-size: 12.5pt; line-height: 1.25; margin: 1.3em 0 0.45em; }
p { margin: 0 0 0.75em; orphans: 2; widows: 2; }
a { color: #1d5fbf; text-decoration: none; }
ul, ol { margin: 0 0 0.8em; padding-left: 1.4em; }
li { margin-bottom: 0.15em; }

/* Front matter: no visible headings, centred pages. */
section.front > h1 { display: none; }
section.titlepage { text-align: center; padding-top: 2.27in; }
section.titlepage > h1 { display: block; font-size: 26pt; margin: 0 0 0.25in; }
section.titlepage p:last-child { margin-top: 2.53in; font-weight: 700; font-family: 'Space Grotesk', sans-serif; }
section.copyright p { font-size: 7.5pt; line-height: 1.45; }
section.dedication { text-align: center; padding-top: 2.6in; }
section.epigraph { margin: 2.2in 0.4in 0; }
section.epigraph p:last-child { text-align: right; font-size: 9pt; margin-top: 1em; }

/* Contents: chapter titles carry their own numbers. */
nav ol { list-style: none; padding-left: 0; }
nav li { margin-bottom: 0.35em; }
nav a { color: inherit; }

/* Screenshots. */
figure { margin: 1.1em 0; text-align: center; break-inside: avoid; }
figure img { max-width: 100%; max-height: 4.6in; }
figcaption { font-size: 8.5pt; font-style: italic; color: #555; margin-top: 0.4em; }

/* The setup table. */
table { border-collapse: collapse; width: 100%; font-size: 8pt; line-height: 1.35; }
col { width: auto !important; }
th, td { border-bottom: 1px solid #ccc; padding: 0.35em 0.4em; text-align: left; vertical-align: top; }
td:first-child { font-weight: 700; width: 30%; }
`;

const dir = mkdtempSync(join(tmpdir(), 'book-'));
try {
  execFileSync('unzip', ['-q', resolve(epubPath), '-d', dir]);
  const root = join(dir, 'EPUB');
  const opf = readFileSync(join(root, 'content.opf'), 'utf8');

  // The reading order: spine idrefs to manifest hrefs.
  const hrefs = Object.fromEntries([...opf.matchAll(/<item\b[^>]*\bid="([^"]+)"[^>]*\bhref="([^"]+)"/g)].map((m) => [m[1], m[2]]));
  const spine = [...opf.matchAll(/<itemref\b[^>]*\bidref="([^"]+)"/g)].map((m) => hrefs[m[1]]);

  const parts = spine.map((href) => {
    const xhtml = readFileSync(join(root, href), 'utf8');
    if (href.endsWith('cover.xhtml')) return `<section class="cover"><img src="media/cover.jpg" alt="" /></section>`;
    let body = xhtml.slice(xhtml.indexOf('>', xhtml.indexOf('<body')) + 1, xhtml.lastIndexOf('</body>'));
    // Chapter pictures are linked from EPUB/text/; this page lives in EPUB/.
    body = body.replaceAll('../media/', 'media/').replace(META.epubIsbn, META.pdfIsbn);
    if (href.startsWith('nav')) {
      const toc = body.match(/<nav epub:type="toc"[\s\S]*?<\/nav>/)[0].replace(/href="text\//g, 'href="#');
      return `<section class="chapter contents">${toc}</section>`;
    }
    const front = /class="[^"]*\bfront\b/.test(body);
    return `<div class="chapter${front ? ' front' : ''}">${body}</div>`;
  });
  // Front matter (cover to epigraph) has no page numbers; Contents is page 1.
  // Chromium can't restart the page counter, so the two are laid out apart and joined.
  const contents = spine.findIndex((href) => href.startsWith('nav'));
  const render = async (browser, chapters, numbered) => {
    const css = numbered ? CSS : CSS + '@page { @bottom-center { content: none; } }';
    const html = `<!doctype html><html lang="en-US"><head><meta charset="utf-8" /><title>${META.title}</title>
<style>${css}</style></head><body>${chapters.join('\n')}</body></html>`;
    const file = join(root, 'book-print.html');
    writeFileSync(file, html);
    const tab = await browser.newPage();
    await tab.goto(pathToFileURL(file).href, { waitUntil: 'load' });
    await tab.evaluate(() => document.fonts.ready);
    const pdf = await tab.pdf({ preferCSSPageSize: true, printBackground: true });
    await tab.close();
    return PDFDocument.load(pdf);
  };
  const browser = await chromium.launch();
  const front = await render(browser, parts.slice(0, contents), false);
  const rest = await render(browser, parts.slice(contents), true);
  await browser.close();

  const doc = await PDFDocument.create();
  for (const part of [front, rest]) {
    for (const p of await doc.copyPages(part, part.getPageIndices())) doc.addPage(p);
  }
  doc.setTitle(META.title);
  doc.setAuthor(META.author);
  doc.setSubject(META.subject);
  doc.setKeywords([META.keywords.join('; ')]);
  doc.setCreator(META.author);
  doc.setProducer(META.author);
  writeFileSync(resolve(pdfPath), await doc.save());
  console.log(`${pdfPath}: ${doc.getPageCount()} pages`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
