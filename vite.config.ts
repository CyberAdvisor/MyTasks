import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import type { Plugin } from 'vite';
import { CSP } from './src/lib/csp';

/** The version in package.json, shown in the app (src/lib/version.ts). */
const version: string = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;

/** The short commit id being built, or "unknown" when git is not available. */
function commit(): string {
  try {
    return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Put the Content Security Policy (src/lib/csp.ts) in the built page, right
 * after the charset and before any script. Builds only: the dev server needs
 * its own live-reload connection.
 */
function contentSecurityPolicy(): Plugin {
  const charset = '<meta charset="UTF-8" />';
  return {
    name: 'mytasks-csp',
    apply: 'build',
    transformIndexHtml(html) {
      if (!html.includes(charset)) throw new Error('index.html: charset tag not found for the CSP');
      return html.replace(charset, `${charset}\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
    },
  };
}

// Vite configuration for the My Tasks PWA.
export default defineConfig({
  plugins: [
    svelte(),
    contentSecurityPolicy(),
    // Install and offline (FR-0.1, NFR-1, NFR-8): the web app manifest, the
    // icons and a service worker that precaches the whole app.
    VitePWA({
      // An update waits for the user's Restart (src/lib/pwa/update.svelte.ts).
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: 'My Tasks',
        short_name: 'My Tasks',
        description: 'Plan. Do. Succeed. A free, open-source task manager.',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        // The sidebar grey; the page itself switches it for dark mode (src/lib/theme.ts).
        theme_color: '#f2f2f4',
        background_color: '#ffffff',
      },
      // Icons are made at build time from the logo (pwa-assets.config.ts).
      pwaAssets: { config: true, overrideManifestIcons: true, injectThemeColor: false },
      workbox: {
        // The manifest is added by the plugin itself; listing it here too breaks the precache.
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        // Only the app's own files are cached. Requests to GitHub
        // (api.github.com, gist.githubusercontent.com) are never handled by
        // the service worker: no runtime caching is configured for them.
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __APP_COMMIT__: JSON.stringify(commit()),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    // Let tests read tokens.css (theme.test.ts checks its contrast).
    css: { include: [/tokens\.css/] },
  },
});
