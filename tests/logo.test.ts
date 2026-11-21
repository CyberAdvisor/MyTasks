/**
 * The logo (FR-V.5): the MT monogram in teal in the icon source, the icons'
 * edge fill, the app's colour tokens and the website, with no trace of the
 * earlier coral logo.
 */
import { describe, expect, it } from 'vitest';
import { ICON_FILL } from '../pwa-assets.config';
import favicon from '../public/favicon.svg?raw';
import tokens from '../src/tokens.css?raw';
import logo from '../src/components/Logo.svelte?raw';

/** Every page of the website, by path. */
const pages = import.meta.glob<string>('../site/**/*.html', { query: '?raw', import: 'default', eager: true });
/** The earlier logos' colours: the coral monogram and the blue placeholder. */
const OLD = /712b13|f5c4b3|993c1d|faece7|2f6fdb/i;

/** WCAG contrast ratio between two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('logo', () => {
  it('the icon file draws the monogram in both colour pairs, with an MT-only form at small sizes', () => {
    for (const colour of ['#0F5B52', '#CFEFE8', '#17776B', '#E6F7F3']) expect(favicon).toContain(colour);
    expect(favicon).toContain('prefers-color-scheme:dark');
    expect(favicon).toContain('@media (max-width:24px){.full{display:none}.small{display:inline}}');
    expect(favicon).not.toMatch(OLD);
  });

  it('the letters stand out from the tile in both appearances', () => {
    expect(contrast('#0F5B52', '#CFEFE8')).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#17776B', '#E6F7F3')).toBeGreaterThanOrEqual(4.5);
  });

  it('icons drawn on a full square are filled with the dark teal', () => {
    expect(ICON_FILL).toBe('#0F5B52');
  });

  it('the app logo uses colour tokens that follow Light or Dark', () => {
    expect(tokens).toContain('--logo-bg: light-dark(#0f5b52, #17776b);');
    expect(tokens).toContain('--logo-fg: light-dark(#cfefe8, #e6f7f3);');
    expect(logo).toContain('var(--logo-bg)');
    expect(logo).toContain('var(--logo-fg)');
    expect(logo).not.toMatch(OLD);
  });

  it('every website page shows the new logo', () => {
    const withLogo = Object.entries(pages).filter(([, html]) => html.includes('class="brand"'));
    expect(withLogo.length).toBeGreaterThan(0);
    for (const [path, html] of withLogo) {
      expect(html, path).toContain('fill="#0f5b52"');
      expect(html, path).not.toMatch(OLD);
    }
  });
});
