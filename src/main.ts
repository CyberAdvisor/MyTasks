/** Entry point: mount the app, unless it has been put inside another page's frame. */
import { mount } from 'svelte';
import './app.css';
import './print.css';
import App from './App.svelte';
import { isFramed, showFramedNotice } from './lib/framed';
import { sync } from './lib/sync/sync.svelte';
import { install } from './lib/pwa/install.svelte';
import { update } from './lib/pwa/update.svelte';
import { failureKind } from './lib/db/failures';
import { ui } from './lib/state/ui.svelte';
import { rowLimit } from './lib/state/rowLimit.svelte';
import { blockZoom } from './lib/pwa/noZoom';
import { adoptOldTheme } from './lib/state/theme';

const target = document.getElementById('app')!;

if (isFramed()) {
  // Inside a frame: start nothing, and offer to open the app directly.
  showFramedNotice(target);
} else {
  // Read this device's sync settings, then keep the tasks in step with the gist (FR-19).
  void sync.start();
  // A theme chosen before 1.11 moves to this device's own setting (FR-19.11).
  void adoptOldTheme();

  // Catch the browser's install prompt (FR-0.2) and watch for app updates (NFR-8).
  install.watch();
  update.start();

  // No pinch zoom, as in a native app (see noZoom.ts).
  blockZoom();

  // Saves are started without waiting (`void repo.x()`), so a failure from any
  // command lands here: an add refused at the task limit (NFR-7), storage full,
  // or another database failure (review C1). Say why, once; log the rest as before.
  window.addEventListener('unhandledrejection', (e) => {
    const kind = failureKind(e.reason);
    if (kind === 'other') return;
    if (kind === 'limit') {
      e.preventDefault();
      ui.limitRefused = { count: e.reason.count, adding: e.reason.adding };
      return;
    }
    console.error('Save failed', e.reason);
    e.preventDefault();
    ui.saveFailed ??= kind; // one message at a time; a second failure doesn't stack another
  });

  // Print every row of a long list, not just those drawn so far (NFR-7).
  window.addEventListener('beforeprint', () => rowLimit.drawAll());

  mount(App, { target });
}
