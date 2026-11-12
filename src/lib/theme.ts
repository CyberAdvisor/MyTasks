/**
 * Applies the Appearance setting (FR-V.3).
 *
 * The colors themselves live in tokens.css as `light-dark()` pairs. With no
 * `data-theme` on <html> they follow the system, live, without any script;
 * Light or Dark pins them by setting `data-theme`.
 *
 * The installed app's title bar takes the `theme-color` meta tags in
 * index.html: the sidebar grey (decided 2026-11-12, 5f). index.html has one
 * tag per system theme; a pinned theme sets both to its own color.
 */
import type { Theme } from './model/settings';

/** Title bar colors: the sidebar's `--sidebar-bg` in each theme (tokens.css). */
export const TITLE_BAR = { light: '#f2f2f4', dark: '#262628' } as const;

export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
  for (const meta of root.ownerDocument.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const mode = theme === 'system' ? (meta.getAttribute('media')?.includes('dark') ? 'dark' : 'light') : theme;
    meta.content = TITLE_BAR[mode];
  }
}
