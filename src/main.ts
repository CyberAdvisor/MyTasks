/** Entry point: mount the app. */
import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { sync } from './lib/sync/sync.svelte';
import { install } from './lib/pwa/install.svelte';
import { update } from './lib/pwa/update.svelte';

// Read this device's sync settings, then keep the list in step with the gist (FR-19).
void sync.start();

// Catch the browser's install prompt (FR-0.2) and watch for app updates (NFR-8).
install.watch();
update.start();

const app = mount(App, { target: document.getElementById('app')! });

export default app;
