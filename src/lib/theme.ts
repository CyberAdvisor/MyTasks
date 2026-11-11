/**
 * Applies the Appearance setting (FR-V.3).
 *
 * The colors themselves live in tokens.css as `light-dark()` pairs. With no
 * `data-theme` on <html> they follow the system, live, without any script;
 * Light or Dark pins them by setting `data-theme`.
 */
import type { Theme } from './model/settings';

export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
}
