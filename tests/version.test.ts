import { flushSync, mount, unmount } from 'svelte';
import VersionLink from '../src/components/VersionLink.svelte';
import { versionLabel, VERSION, COMMIT } from '../src/lib/version';

describe('version stamp', () => {
  it('has a semantic version and a 7-character commit', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(COMMIT).toMatch(/^([0-9a-f]{7}|unknown)$/);
  });

  it('labels the build with its version and commit', () => {
    expect(versionLabel('0.2.0', 'a1b2c3d')).toBe('v0.2.0 (a1b2c3d)');
    expect(versionLabel('0.2.0', 'unknown')).toBe('v0.2.0');
  });

  it("links to the website's Roadmap page, in a new tab", () => {
    const target = document.createElement('div');
    const link = mount(VersionLink, { target });
    flushSync();
    const a = target.querySelector('a')!;
    expect(a.getAttribute('href')).toBe('https://mytasks.fyi/roadmap/');
    expect(a.target).toBe('_blank');
    expect(a.rel).toBe('noopener noreferrer');
    expect(a.textContent?.trim()).toBe(versionLabel());
    unmount(link);
  });
});
