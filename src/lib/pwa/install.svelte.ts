/**
 * Installing the app (FR-0.2): the browser's own install prompt where there
 * is one (Chrome, Edge), otherwise the install guide.
 */
import { detectBrowser, isStandalone, type Browser } from './platform';

/** Chrome's install prompt event; not in TypeScript's DOM types. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
}

class Install {
  /** The browser, read once. */
  readonly browser: Browser = typeof navigator === 'undefined' ? 'other' : detectBrowser();
  /** Whether the app runs installed. Does not change while it runs. */
  readonly standalone: boolean = typeof window === 'undefined' ? false : isStandalone();
  /** Whether the browser has offered its install prompt. */
  canPrompt = $state(false);
  /** Whether the install guide dialog is open. */
  guideOpen = $state(false);

  private promptEvent: InstallPromptEvent | null = null;

  /**
   * Catch the install prompt. Called at startup, before the app mounts,
   * because the browser may offer it straight away.
   */
  watch(): void {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.promptEvent = e as InstallPromptEvent;
      this.canPrompt = true;
    });
    window.addEventListener('appinstalled', () => {
      this.promptEvent = null;
      this.canPrompt = false;
    });
  }

  /**
   * Install: the browser's prompt when it offered one, else the guide. A
   * prompt can be shown only once; if it is turned down, Install My Tasks
   * stays and opens the guide instead.
   */
  start(): void {
    const event = this.promptEvent;
    this.promptEvent = null;
    if (event) void event.prompt();
    else this.guideOpen = true;
  }
}

export const install = new Install();
