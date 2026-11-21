/*
 * Retires the service worker of the app's old address.
 *
 * Until v0.5.0 the app ran at the root of mytasks.fyi, with a service worker
 * here (/sw.js, scope /). The app now runs at /app/ with its own service
 * worker, and the root is the website. Browsers that still have the old
 * worker check this file for updates and get this one instead. It removes the
 * old worker's caches (not the app's, under /app/), unregisters itself and
 * reloads open pages from the network, so they show the website, or the app
 * when they were opened as an installed app (site/assets/site.js).
 */
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      const scope = self.registration.scope; // https://mytasks.fyi/
      // Workbox names its caches after the scope: keep the app's (…/app/).
      for (const key of await caches.keys()) {
        if (key.endsWith(scope)) await caches.delete(key);
      }
      await self.registration.unregister();
      for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url);
    })(),
  );
});
