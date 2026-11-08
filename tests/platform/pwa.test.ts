import { describe, expect, it, vi } from 'vitest';
import {
  INSTALL_DISMISS_MS,
  installHint,
  isIos,
  loadInstallDismissed,
  Pwa,
  saveInstallDismissed,
  updateNoticeVisible,
  type InstallContext,
  type PwaEnv,
} from '../../src/platform/pwa';

const NOW = 1_700_000_000_000;
const ready: InstallContext = { standalone: false, ios: false, hasPrompt: true, dismissedAt: null, now: NOW };

describe('installHint', () => {
  it('offers the install once the browser has offered its prompt, on a phone or a desktop alike', () => {
    expect(installHint(ready)).toBe('android');
    expect(installHint({ ...ready, hasPrompt: false })).toBe('none');
  });

  it('stays away from an app that is already installed', () => {
    expect(installHint({ ...ready, standalone: true })).toBe('none');
    expect(installHint({ ...ready, ios: true, standalone: true })).toBe('none');
  });

  it('shows the by-hand hint on iOS, which has no prompt', () => {
    expect(installHint({ ...ready, ios: true, hasPrompt: false })).toBe('ios');
    expect(installHint({ ...ready, ios: true, hasPrompt: true })).toBe('ios');
  });

  it('stays away after a dismissal, and comes back after the window', () => {
    expect(installHint({ ...ready, dismissedAt: NOW - 1000 })).toBe('none');
    expect(installHint({ ...ready, dismissedAt: NOW - INSTALL_DISMISS_MS + 1 })).toBe('none');
    expect(installHint({ ...ready, dismissedAt: NOW - INSTALL_DISMISS_MS })).toBe('android');
    expect(installHint({ ...ready, ios: true, dismissedAt: NOW - INSTALL_DISMISS_MS })).toBe('ios');
  });

  it('does not hold a dismissal that lies in the future (a clock set back)', () => {
    expect(installHint({ ...ready, dismissedAt: NOW + 1000 })).toBe('android');
  });
});

describe('updateNoticeVisible', () => {
  it('shows a waiting version in the menus only', () => {
    expect(updateNoticeVisible({ waiting: true, inMatch: false })).toBe(true);
    expect(updateNoticeVisible({ waiting: true, inMatch: true })).toBe(false);
    expect(updateNoticeVisible({ waiting: false, inMatch: false })).toBe(false);
  });
});

describe('the dismissal', () => {
  const store = (initial: Record<string, string> = {}) => {
    const data = { ...initial };
    return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v) };
  };

  it('is remembered', () => {
    const s = store();
    expect(loadInstallDismissed(s)).toBeNull();
    saveInstallDismissed(NOW, s);
    expect(loadInstallDismissed(s)).toBe(NOW);
  });

  it('survives a corrupt value and storage that throws', () => {
    expect(loadInstallDismissed(store({ 'slingshot.pwa.installDismissed.v1': 'nonsense' }))).toBeNull();
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadInstallDismissed(broken)).toBeNull();
    expect(() => saveInstallDismissed(NOW, broken)).not.toThrow();
  });
});

describe('isIos', () => {
  it('knows an iPhone, and an iPad that calls itself a Mac', () => {
    expect(isIos({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', platform: 'iPhone', maxTouchPoints: 5 })).toBe(true);
    expect(isIos({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)', platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true);
    expect(isIos({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)', platform: 'MacIntel', maxTouchPoints: 0 })).toBe(false);
    expect(isIos({ userAgent: 'Mozilla/5.0 (Linux; Android 14)', platform: 'Linux armv8l', maxTouchPoints: 5 })).toBe(false);
  });
});

/** A browser with a service worker container, a window and a page, all of which the test can poke. */
function browser(options: { controlled?: boolean } = {}) {
  const container = new EventTarget() as EventTarget & { controller: object | null; register: (url: string) => Promise<unknown> };
  container.controller = options.controlled === false ? null : {};
  const registration = new EventTarget() as EventTarget & { waiting: unknown; installing: unknown; updates: number; update: () => Promise<void> };
  registration.waiting = null;
  registration.installing = null;
  registration.updates = 0;
  registration.update = async () => void registration.updates++;
  const registered: string[] = [];
  container.register = async (url) => {
    registered.push(url);
    return registration;
  };
  const win = new EventTarget();
  const page = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
  const state = { reloads: 0 };
  const env = {
    serviceWorker: container as unknown as ServiceWorkerContainer,
    win,
    page,
    reload: () => void state.reloads++,
  } as unknown as PwaEnv;
  const worker = () => {
    const w = new EventTarget() as EventTarget & { state: string; messages: unknown[]; postMessage: (m: unknown) => void };
    w.state = 'installing';
    w.messages = [];
    w.postMessage = (m) => void w.messages.push(m);
    return w;
  };
  return { container, registration, registered, win, page, state, env, worker };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Pwa update', () => {
  it('registers the worker at the path it is given', async () => {
    const b = browser();
    new Pwa(b.env).register('./sw.js');
    await settle();
    expect(b.registered).toEqual(['./sw.js']);
  });

  it('waits on a new version and switches only when asked', async () => {
    const b = browser();
    const pwa = new Pwa(b.env);
    let changes = 0;
    pwa.onChange(() => changes++);
    pwa.register('./sw.js');
    await settle();
    expect(pwa.updateWaiting).toBe(false);

    const w = b.worker();
    b.registration.installing = w;
    b.registration.dispatchEvent(new Event('updatefound'));
    w.state = 'installed';
    w.dispatchEvent(new Event('statechange'));
    expect(pwa.updateWaiting).toBe(true);
    expect(changes).toBe(1);
    expect(w.messages).toEqual([]);

    // The new worker taking control by itself (not asked for) does not reload a page.
    b.container.dispatchEvent(new Event('controllerchange'));
    expect(b.state.reloads).toBe(0);

    pwa.applyUpdate();
    expect(w.messages).toEqual([{ type: 'skip-waiting' }]);
    expect(b.state.reloads).toBe(0);
    b.container.dispatchEvent(new Event('controllerchange'));
    expect(b.state.reloads).toBe(1);
  });

  it('finds a version that was already waiting when the page opened', async () => {
    const b = browser();
    b.registration.waiting = b.worker();
    const pwa = new Pwa(b.env);
    pwa.register('./sw.js');
    await settle();
    expect(pwa.updateWaiting).toBe(true);
  });

  it('does not call the very first install an update', async () => {
    const b = browser({ controlled: false });
    const pwa = new Pwa(b.env);
    pwa.register('./sw.js');
    await settle();
    const w = b.worker();
    b.registration.installing = w;
    b.registration.dispatchEvent(new Event('updatefound'));
    w.state = 'installed';
    w.dispatchEvent(new Event('statechange'));
    expect(pwa.updateWaiting).toBe(false);
  });

  it('looks for a new version when the page comes back', async () => {
    const b = browser();
    new Pwa(b.env).register('./sw.js');
    await settle();
    b.page.visibilityState = 'hidden';
    b.page.dispatchEvent(new Event('visibilitychange'));
    expect(b.registration.updates).toBe(0);
    b.page.visibilityState = 'visible';
    b.page.dispatchEvent(new Event('visibilitychange'));
    expect(b.registration.updates).toBe(1);
  });

  it('does nothing without service worker support', () => {
    const b = browser();
    const pwa = new Pwa({ ...b.env, serviceWorker: undefined });
    expect(() => pwa.register('./sw.js')).not.toThrow();
    expect(() => pwa.applyUpdate()).not.toThrow();
  });
});

describe('Pwa refresh (a build the relay turned away)', () => {
  it('switches to a version that is already waiting', async () => {
    const b = browser();
    const w = b.worker();
    b.registration.waiting = w;
    const pwa = new Pwa(b.env);
    pwa.register('./sw.js');
    await settle();
    await pwa.refresh();
    expect(w.messages).toEqual([{ type: 'skip-waiting' }]);
    expect(b.state.reloads).toBe(0);
  });

  it('asks the worker to look, and switches to the version it finds', async () => {
    const b = browser();
    const w = b.worker();
    b.registration.update = async () => {
      b.registration.updates++;
      b.registration.installing = w;
      b.registration.dispatchEvent(new Event('updatefound'));
      queueMicrotask(() => {
        w.state = 'installed';
        w.dispatchEvent(new Event('statechange'));
      });
    };
    const pwa = new Pwa(b.env);
    pwa.register('./sw.js');
    await settle();
    await pwa.refresh();
    expect(b.registration.updates).toBe(1);
    expect(w.messages).toEqual([{ type: 'skip-waiting' }]);
  });

  it('reloads when the worker finds nothing in time', async () => {
    vi.useFakeTimers();
    try {
      const b = browser();
      const pwa = new Pwa(b.env);
      pwa.register('./sw.js');
      await vi.advanceTimersByTimeAsync(0);
      const done = pwa.refresh();
      await vi.advanceTimersByTimeAsync(8000);
      await done;
      expect(b.state.reloads).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('just reloads without a service worker', async () => {
    const b = browser();
    await new Pwa({ ...b.env, serviceWorker: undefined }).refresh();
    expect(b.state.reloads).toBe(1);
  });
});

describe('Pwa install', () => {
  const offered = (b: ReturnType<typeof browser>) => {
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      shown: 0,
      prompt: async () => void (event.shown += 1),
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    });
    b.win.dispatchEvent(event);
    return event;
  };

  it('keeps the browser prompt for its own button and uses it once', async () => {
    const b = browser();
    const pwa = new Pwa(b.env);
    expect(pwa.canInstall).toBe(false);
    const event = offered(b);
    expect(event.defaultPrevented).toBe(true);
    expect(pwa.canInstall).toBe(true);
    await pwa.install();
    expect(event.shown).toBe(1);
    expect(pwa.canInstall).toBe(false);
    await pwa.install();
    expect(event.shown).toBe(1);
  });

  it('does not loop when a listener stops and listens again as it is told', () => {
    const b = browser();
    const pwa = new Pwa(b.env);
    let calls = 0;
    const listen = (): (() => void) => {
      const stop = pwa.onChange(() => {
        calls++;
        stop();
        listen();
      });
      return stop;
    };
    listen();
    offered(b);
    expect(calls).toBe(1);
  });

  it('forgets the prompt once the app is installed', () => {
    const b = browser();
    const pwa = new Pwa(b.env);
    offered(b);
    b.win.dispatchEvent(new Event('appinstalled'));
    expect(pwa.canInstall).toBe(false);
  });
});
