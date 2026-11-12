/// <reference types="vite-plugin-pwa/vanillajs" />

// Constants Vite fills in at build time (vite.config.ts `define`).

/** The version in package.json. */
declare const __APP_VERSION__: string;
/** The short git commit id of the build, or "unknown". */
declare const __APP_COMMIT__: string;
