/**
 * App updates (NFR-8). A new version installs in the background and waits.
 * The "Update available" banner's Restart saves any edit in progress, then
 * switches to it. Nothing ever reloads on its own, so an edit is never cut
 * off; a dismissed update applies the next time the app starts.
 */
import { tick } from 'svelte';
import { registerSW } from 'virtual:pwa-register';
import { db } from '../db/database';
import { ui } from '../state/ui.svelte';

/** How often a long-open window checks for a new version. */
const CHECK_EVERY_MS = 60 * 60 * 1000;
/** Checks closer together than this are skipped (focus and visibility often fire together). */
const MIN_GAP_MS = 10 * 1000;

class Update {
  /** Whether a new version is waiting. */
  available = $state(false);
  /** Whether the banner was dismissed (until the next start). */
  dismissed = $state(false);

  private apply: ((reload?: boolean) => Promise<void>) | null = null;
  /** Set once Restart is pressed in this window. */
  private restarting = false;
  /** Set when another window already switched to the new version. */
  private switched = false;

  /** Register the service worker. Called once at startup. */
  start(): void {
    this.apply = registerSW({
      onNeedRefresh: () => (this.available = true),
      // The new version took over: reload only if this window asked for it.
      onNeedReload: () => {
        if (this.restarting) location.reload();
        else this.switched = this.available = true;
      },
      onRegisteredSW: (_url, registration) => {
        if (!registration) return;
        let lastCheck = Date.now();
        const check = () => {
          if (Date.now() - lastCheck < MIN_GAP_MS) return;
          lastCheck = Date.now();
          void registration.update().catch(() => {});
        };
        setInterval(check, CHECK_EVERY_MS);
        // Check on coming back to the app: when its window becomes visible
        // again, or gains focus. On a Mac, switching to another app often
        // leaves the window visible, so focus is what catches that.
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') check();
        });
        window.addEventListener('focus', check);
      },
    });
  }

  /** Restart into the new version, after saving any edit in progress. */
  async restart(): Promise<void> {
    await saveEdits();
    if (this.switched) return location.reload();
    this.restarting = true;
    await this.apply?.();
  }
}

/**
 * Finish every pending write: close the card (its fields save as they
 * close), commit check-offs still in their delay, then wait for the database
 * to finish what was queued.
 */
async function saveEdits(): Promise<void> {
  (document.activeElement as HTMLElement | null)?.blur();
  ui.close();
  ui.flush();
  await tick();
  await new Promise((resolve) => setTimeout(resolve));
  // A read-write transaction over every table runs after those queued before it.
  await db.transaction('rw', db.tables, () => {});
}

export const update = new Update();
