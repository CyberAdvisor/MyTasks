/**
 * Install and offline (FR-0.2 to FR-0.5): which browser the app is in, and
 * what the sidebar and Setup show there.
 */
import { describe, expect, it } from 'vitest';
import { detectBrowser, installFirst, installNotice } from '../src/lib/pwa/platform';

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  winEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  android: 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  macFirefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0',
  androidFirefox: 'Mozilla/5.0 (Android 15; Mobile; rv:133.0) Gecko/133.0 Firefox/133.0',
};

describe('detectBrowser', () => {
  it('tells the install routes apart', () => {
    expect(detectBrowser(UA.iphone, 5)).toBe('ios');
    expect(detectBrowser(UA.iphoneChrome, 5)).toBe('ios');
    expect(detectBrowser(UA.macSafari, 0)).toBe('safari');
    expect(detectBrowser(UA.macChrome, 0)).toBe('chromium');
    expect(detectBrowser(UA.winEdge, 0)).toBe('chromium');
    expect(detectBrowser(UA.android, 5)).toBe('chromium');
    expect(detectBrowser(UA.macFirefox, 0)).toBe('firefox');
    expect(detectBrowser(UA.androidFirefox, 5)).toBe('other');
  });

  it('recognises an iPad, which reports a Mac user agent, by its touch screen', () => {
    expect(detectBrowser(UA.macSafari, 5)).toBe('ios');
  });
});

describe('installNotice', () => {
  it('shows nothing once installed', () => {
    for (const b of ['ios', 'safari', 'chromium', 'firefox', 'other'] as const) {
      expect(installNotice(b, true, true)).toBe('none');
    }
  });

  it('warns in a Safari tab, on iPhone, iPad or Mac (FR-0.3)', () => {
    expect(installNotice('ios', false, false)).toBe('warning');
    expect(installNotice('safari', false, false)).toBe('warning');
  });

  it('offers Install My Tasks where the browser can prompt, and in Firefox', () => {
    expect(installNotice('chromium', false, true)).toBe('install');
    expect(installNotice('chromium', false, false)).toBe('none');
    expect(installNotice('firefox', false, false)).toBe('install');
    expect(installNotice('other', false, false)).toBe('none');
  });
});

describe('installFirst', () => {
  it('asks to install before connecting on iPhone and iPad only', () => {
    expect(installFirst('ios', false)).toBe(true);
    expect(installFirst('ios', true)).toBe(false);
    expect(installFirst('safari', false)).toBe(false);
    expect(installFirst('chromium', false)).toBe(false);
  });
});
