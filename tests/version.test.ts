import { changelogUrl, versionLabel, VERSION, COMMIT } from '../src/lib/version';

describe('version stamp', () => {
  it('has a semantic version and a 7-character commit', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(COMMIT).toMatch(/^([0-9a-f]{7}|unknown)$/);
  });

  it('labels the build with its version and commit', () => {
    expect(versionLabel('0.2.0', 'a1b2c3d')).toBe('v0.2.0 (a1b2c3d)');
    expect(versionLabel('0.2.0', 'unknown')).toBe('v0.2.0');
  });

  it("links to the version's changelog section at the build's commit", () => {
    expect(changelogUrl('0.2.0', 'a1b2c3d')).toBe('https://github.com/CyberAdvisor/MyTasks/blob/a1b2c3d/CHANGELOG.md#v0.2.0');
    expect(changelogUrl('0.2.0', 'unknown')).toBe('https://github.com/CyberAdvisor/MyTasks/blob/main/CHANGELOG.md#v0.2.0');
  });
});
