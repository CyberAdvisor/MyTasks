/** Entry point: mount the app. */
import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { sync } from './lib/sync/sync.svelte';

// Read this device's sync settings, then keep the list in step with the gist (FR-19).
void sync.start();

const app = mount(App, { target: document.getElementById('app')! });

export default app;
