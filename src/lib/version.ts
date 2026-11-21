/**
 * This build's version, shown beside the sync status at the bottom
 * of the sidebar and on the Setup screen so a tester always knows which build is running. The version
 * comes from package.json and the commit from git, both filled in by Vite
 * at build time (vite.config.ts).
 */

/** Semantic version from package.json, e.g. "0.2.0". */
export const VERSION: string = __APP_VERSION__;

/** Short commit id of the build, e.g. "a1b2c3d", or "unknown" outside git. */
export const COMMIT: string = __APP_COMMIT__;

/** "v0.2.0 (a1b2c3d)", or "v0.2.0" when the commit is unknown. */
export function versionLabel(version = VERSION, commit = COMMIT): string {
  return commit === 'unknown' ? `v${version}` : `v${version} (${commit})`;
}
