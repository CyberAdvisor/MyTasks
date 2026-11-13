/** Entry point: mount the app, unless it has been put inside another page's frame. */
import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { isFramed, showFramedNotice } from './lib/framed';
import { sync } from './lib/sync/sync.svelte';
import { install } from './lib/pwa/install.svelte';
import { update } from './lib/pwa/update.svelte';

const target = document.getElementById('app')!;

if (isFramed()) {
  // Inside a frame: start nothing, and offer to open the app directly.
  showFramedNotice(target);
} else {
  // Read this device's sync settings, then keep the tasks in step with the gist (FR-19).
  void sync.start();

  // Catch the browser's install prompt (FR-0.2) and watch for app updates (NFR-8).
  install.watch();
  update.start();

  mount(App, { target });
}
