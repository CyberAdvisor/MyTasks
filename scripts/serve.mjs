/**
 * `npm run preview`: serve the built site (dist/) the way GitHub Pages does,
 * the website at / and the app at /app/, with its service worker. Vite's own
 * preview serves only the app, so it can't show the website around it.
 *
 * Usage: node scripts/serve.mjs [port]   (default 4173)
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../dist', import.meta.url));
const PORT = Number(process.argv[2] ?? 4173);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/** The file for a URL path: the file itself, or a folder's index.html. Null outside dist/. */
async function fileFor(urlPath) {
  const path = normalize(join(ROOT, decodeURIComponent(urlPath)));
  if (!path.startsWith(ROOT)) return null;
  const info = await stat(path).catch(() => null);
  if (info?.isDirectory()) return join(path, 'index.html');
  return info ? path : null;
}

createServer(async (req, res) => {
  const urlPath = new URL(req.url, 'http://localhost').pathname;
  // A folder without its trailing slash redirects, as GitHub Pages does.
  const info = await stat(join(ROOT, decodeURIComponent(urlPath))).catch(() => null);
  if (info?.isDirectory() && !urlPath.endsWith('/')) {
    res.writeHead(301, { Location: urlPath + '/' }).end();
    return;
  }
  const file = await fileFor(urlPath);
  const body = file && (await readFile(file).catch(() => null));
  if (!body) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(body);
}).listen(PORT, () => console.log(`My Tasks: website http://localhost:${PORT}/  app http://localhost:${PORT}/app/`));
