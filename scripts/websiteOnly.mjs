/**
 * Whether a pull request changes only the website and docs, so GitHub's
 * interface check can be skipped (.github/workflows/deploy.yml, job `scope`).
 * Reads the changed files, one per line, on standard input and prints `true`
 * or `false`. Anything outside these paths can reach the app, so it keeps the
 * full check: src/, tests/, e2e/, helper/, the workflow and package files.
 */
import { pathToFileURL } from 'node:url';

/** Paths that never reach the app: the website, docs and the top-level notes. */
const WEBSITE_ONLY = [/^site\//, /^docs\//, /^(README|DEVELOPMENT|SECURITY|CHANGELOG)\.md$/];

/** True when every file is website-only (and there is at least one). */
export function websiteOnly(files) {
  const list = files.map((f) => f.trim()).filter(Boolean);
  return list.length > 0 && list.every((f) => WEBSITE_ONLY.some((re) => re.test(f)));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  let input = '';
  process.stdin.on('data', (chunk) => (input += chunk));
  process.stdin.on('end', () => console.log(String(websiteOnly(input.split('\n')))));
}
