/**
 * The game as an installed app: the service worker that keeps the build offline (`scripts/pwa/sw.js`), the "new version"
 * notice and the "install" hint. What to show and when is decided by plain functions; `Pwa` only wires them to the browser.
 */

/** How long a closed install hint stays away before it asks again. */
export const INSTALL_DISMISS_MS = 30 * 24 * 60 * 60 * 1000;

/** Where a closed install hint is remembered. To ask everybody again at once, raise the version in the key. */
const DISMISS_KEY = 'slingshot.pwa.installDismissed.v1';

/** `android` is the browser's own install prompt (Chrome and Edge, on Android and on a desktop), `ios` the by-hand way. */
export type InstallHint = 'android' | 'ios' | 'none';

export interface InstallContext {
  /** Already running as an installed app. */
  standalone: boolean;
  ios: boolean;
  /** The browser offered its own install prompt (iOS never does; neither do Safari and Firefox on a desktop). */
  hasPrompt: boolean;
  /** When the player closed the hint, if they did. */
  dismissedAt: number | null;
  now: number;
}

/**
 * Which install hint to show. A browser that offers its prompt gets a button for it (so it really installs); iOS has no prompt, so
 * it gets a hint on how to do it by hand. Neither shows in an app that is already installed, nor for a month after it was closed.
 */
export function installHint({ standalone, ios, hasPrompt, dismissedAt, now }: InstallContext): InstallHint {
  if (standalone) return 'none';
  if (dismissedAt !== null && now - dismissedAt >= 0 && now - dismissedAt < INSTALL_DISMISS_MS) return 'none';
  if (ios) return 'ios';
  return hasPrompt ? 'android' : 'none';
}

/** A waiting new version is offered in the menus only: switching reloads the page, which would end a match. */
export function updateNoticeVisible({ waiting, inMatch }: { waiting: boolean; inMatch: boolean }): boolean {
  return waiting && !inMatch;
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;

export function loadInstallDismissed(store: Store | undefined = safeStorage()): number | null {
  try {
    const value = Number(store?.getItem(DISMISS_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export function saveInstallDismissed(now: number, store: Store | undefined = safeStorage()): void {
  try {
    store?.setItem(DISMISS_KEY, String(now));
  } catch {
    // Not fatal: the hint just comes back next time.
  }
}

function safeStorage(): Store | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function isIos(nav: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'> = navigator): boolean {
  // An iPad asks for the desktop site and says it is a Mac, but only an iPad has a touch screen.
  return /iPad|iPhone|iPod/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  return matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

/** Chrome's install prompt, kept until the player taps our own button. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface PwaEnv {
  serviceWorker: ServiceWorkerContainer | undefined;
  win: Pick<Window, 'addEventListener'>;
  page: Pick<Document, 'addEventListener' | 'visibilityState'>;
  reload(): void;
}

function browserEnv(): PwaEnv {
  return { serviceWorker: navigator.serviceWorker, win: window, page: document, reload: () => location.reload() };
}

export class Pwa {
  private waiting: ServiceWorker | null = null;
  private registration: ServiceWorkerRegistration | null = null;
  private prompt: BeforeInstallPromptEvent | null = null;
  private reloading = false;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly env: PwaEnv = browserEnv()) {
    env.win.addEventListener('beforeinstallprompt', (event) => {
      // Our own button asks for it, not the browser's mini bar.
      event.preventDefault();
      this.prompt = event as BeforeInstallPromptEvent;
      this.changed();
    });
    env.win.addEventListener('appinstalled', () => {
      this.prompt = null;
      this.changed();
    });
  }

  /** A new version is installed and waiting to take over. */
  get updateWaiting(): boolean {
    return this.waiting !== null;
  }

  /** The browser has offered to install the game. */
  get canInstall(): boolean {
    return this.prompt !== null;
  }

  /** Called whenever one of the two above changes. Returns how to stop listening. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Registers the worker. `url` is relative to the page, so it works under any sub-path and on /stats. */
  register(url: string): void {
    const container = this.env.serviceWorker;
    if (!container) return;
    container.addEventListener('controllerchange', () => {
      // The first install also takes control; only a switch the player asked for reloads.
      if (this.reloading) this.env.reload();
    });
    void container
      .register(url)
      .then((registration) => {
        this.registration = registration;
        const watch = (worker: ServiceWorker): void => {
          worker.addEventListener('statechange', () => {
            // Without a controller the page came from the network, so there is no older version to leave.
            if (worker.state === 'installed' && container.controller) this.setWaiting(worker);
          });
        };
        if (registration.waiting && container.controller) this.setWaiting(registration.waiting);
        if (registration.installing) watch(registration.installing);
        registration.addEventListener('updatefound', () => {
          if (registration.installing) watch(registration.installing);
        });
        // An installed app is often resumed, not opened again: look for a new version then.
        this.env.page.addEventListener('visibilitychange', () => {
          if (this.env.page.visibilityState === 'visible') void registration.update().catch(() => {});
        });
      })
      .catch(() => {
        // No worker (a private window, an insecure address): the game just needs the network as before.
      });
  }

  /** Switch to the waiting version; the page reloads once it has taken over. */
  applyUpdate(): void {
    const worker = this.waiting;
    if (!worker) return;
    this.reloading = true;
    worker.postMessage({ type: 'skip-waiting' });
  }

  /**
   * Get the newest build now, for a game the relay has turned away as out of date. A version already waiting is switched to; else the
   * worker is asked to look, and the one it finds is switched to once it is ready. A plain reload is not enough: the old build would
   * simply be served from the cache again. Without a worker (or if it finds nothing in time) it is just a reload.
   */
  async refresh(): Promise<void> {
    if (this.waiting) return this.applyUpdate();
    const registration = this.registration;
    if (registration) {
      await registration.update().catch(() => {});
      if (!this.waiting) {
        await new Promise<void>((resolve) => {
          const stop = this.onChange(() => {
            if (!this.waiting) return;
            stop();
            resolve();
          });
          setTimeout(() => {
            stop();
            resolve();
          }, 8000);
        });
      }
      if (this.waiting) return this.applyUpdate();
    }
    this.env.reload();
  }

  /** Show the browser's install prompt. It can be used once. */
  async install(): Promise<void> {
    const prompt = this.prompt;
    if (!prompt) return;
    this.prompt = null;
    this.changed();
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch {
      // Closed without an answer: nothing to do.
    }
  }

  private setWaiting(worker: ServiceWorker): void {
    this.waiting = worker;
    this.changed();
  }

  private changed(): void {
    // A copy: a listener may stop listening and listen again (a page that rebuilds itself), which must not be heard twice.
    for (const listener of [...this.listeners]) listener();
  }
}
