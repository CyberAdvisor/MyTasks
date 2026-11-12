/*
 * Sends old links and old installs to the app, which moved from the root of
 * mytasks.fyi to /app/ in v0.5.0. Loaded by the home page only.
 *
 * - An old link to a list (mytasks.fyi/#/today) opens that list in the app.
 * - An app installed before the move still starts at mytasks.fyi; opened as
 *   an installed app (standalone), it goes straight to the app.
 */
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
if (location.hash.startsWith('#/')) location.replace('/app/' + location.hash);
else if (standalone) location.replace('/app/');
