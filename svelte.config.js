import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** Svelte compiler configuration: TypeScript in components via Vite. */
export default {
  preprocess: vitePreprocess(),
};
