/**
 * Themes (FR-V.3): the Appearance setting, applying it, and text contrast of
 * the design tokens in both themes (design doc, Section 6: 4.5:1).
 */
import { describe, expect, it } from 'vitest';
import { readSettings } from '../src/lib/model/settings';
import { TITLE_BAR, applyTheme } from '../src/lib/theme';
import tokensCss from '../src/tokens.css?raw';

type Mode = 'light' | 'dark';

/** Token values from tokens.css, resolved for one theme. */
function tokens(mode: Mode): Map<string, string> {
  const out = new Map<string, string>();
  for (const [, name, raw] of tokensCss.matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
    const inner = raw.trim().match(/^light-dark\((.*)\)$/)?.[1];
    out.set(name, inner ? splitPair(inner)[mode === 'light' ? 0 : 1] : raw.trim());
  }
  return out;
}

/** Split "a, b" at the comma that is not inside parentheses. */
function splitPair(s: string): [string, string] {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') depth--;
    else if (s[i] === ',' && depth === 0) return [s.slice(0, i).trim(), s.slice(i + 1).trim()];
  }
  throw new Error(`Not a light-dark pair: ${s}`);
}

/** WCAG relative luminance of a #rrggbb color. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Text tokens and the backgrounds they appear on. */
const TEXT_PAIRS: [text: string, backgrounds: string[]][] = [
  ['--text', ['--bg', '--sidebar-bg', '--surface', '--chip-bg', '--selected-bg', '--selected-row', '--segment-on']],
  ['--text-2', ['--bg', '--sidebar-bg', '--surface', '--chip-bg', '--hover-bg', '--field']],
  ['--text-3', ['--bg', '--sidebar-bg', '--surface']],
  ['--accent-text', ['--bg', '--surface', '--tag-bg']],
  ['--danger', ['--bg', '--surface']],
  ['--on-accent', ['--accent']],
  ['--on-strong', ['--p1', '--p2', '--p3', '--p4', '--p5', '--danger']],
  ['--toast-text', ['--toast-bg']],
  ['--toast-link', ['--toast-bg']],
];

describe('design tokens', () => {
  for (const mode of ['light', 'dark'] as const) {
    it(`text has at least 4.5:1 contrast in the ${mode} theme`, () => {
      const t = tokens(mode);
      const failures: string[] = [];
      for (const [fg, bgs] of TEXT_PAIRS) {
        for (const bg of bgs) {
          const ratio = contrast(t.get(fg)!, t.get(bg)!);
          if (ratio < 4.5) failures.push(`${fg} on ${bg}: ${ratio.toFixed(2)}`);
        }
      }
      expect(failures).toEqual([]);
    });
  }

  it('gives every theme-dependent token a light and a dark value', () => {
    const light = tokens('light');
    const dark = tokens('dark');
    for (const [name, value] of light) {
      expect(value, name).not.toMatch(/light-dark/);
      expect(dark.has(name), name).toBe(true);
    }
  });
});

describe('Appearance setting', () => {
  it('defaults to System and ignores unknown values', () => {
    expect(readSettings([]).theme).toBe('system');
    expect(readSettings([{ key: 'theme', value: 'dark' }]).theme).toBe('dark');
    expect(readSettings([{ key: 'theme', value: 'sepia' }]).theme).toBe('system');
  });

  it('pins Light or Dark on <html>, and System removes the pin', () => {
    const root = document.createElement('html');
    applyTheme('dark', root);
    expect(root.dataset.theme).toBe('dark');
    applyTheme('light', root);
    expect(root.dataset.theme).toBe('light');
    applyTheme('system', root);
    expect(root.dataset.theme).toBeUndefined();
  });

  it('colors the title bar with the sidebar grey, following a pinned theme', () => {
    expect(TITLE_BAR.light).toBe(tokens('light').get('--sidebar-bg'));
    expect(TITLE_BAR.dark).toBe(tokens('dark').get('--sidebar-bg'));
    document.head.innerHTML =
      '<meta name="theme-color" media="(prefers-color-scheme: light)" content="">' +
      '<meta name="theme-color" media="(prefers-color-scheme: dark)" content="">';
    const [light, dark] = document.head.querySelectorAll('meta');
    const root = document.createElement('html');
    applyTheme('system', root);
    expect([light.content, dark.content]).toEqual([TITLE_BAR.light, TITLE_BAR.dark]);
    applyTheme('dark', root);
    expect([light.content, dark.content]).toEqual([TITLE_BAR.dark, TITLE_BAR.dark]);
    applyTheme('light', root);
    expect([light.content, dark.content]).toEqual([TITLE_BAR.light, TITLE_BAR.light]);
    document.head.innerHTML = '';
  });
});
