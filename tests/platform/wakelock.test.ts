import { describe, expect, it } from 'vitest';
import { ScreenWake } from '../../src/platform/wakelock';

function fakes() {
  const state = { requests: 0, released: 0, hidden: false, deny: false };
  const sentinels: { fire: () => void }[] = [];
  const nav = {
    wakeLock: {
      async request() {
        state.requests++;
        if (state.deny) throw new DOMException('no', 'NotAllowedError');
        const listeners: (() => void)[] = [];
        sentinels.push({ fire: () => listeners.forEach((l) => l()) });
        return {
          release: async () => void state.released++,
          addEventListener: (_: string, l: () => void) => listeners.push(l),
        } as unknown as WakeLockSentinel;
      },
    },
  };
  let onVisible: () => void = () => {};
  const page = {
    get visibilityState() {
      return state.hidden ? 'hidden' : 'visible';
    },
    addEventListener: (_: string, l: () => void) => (onVisible = l),
  } as unknown as Pick<Document, 'visibilityState' | 'addEventListener'>;
  return { state, sentinels, nav, page, show: () => ((state.hidden = false), onVisible()) };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('ScreenWake', () => {
  it('holds the screen while wanted and lets go afterwards', async () => {
    const f = fakes();
    const wake = new ScreenWake(f.nav, f.page);
    wake.set(true);
    await tick();
    expect(wake.held).toBe(true);
    wake.set(false);
    expect(wake.held).toBe(false);
    expect(f.state.released).toBe(1);
  });

  it('asks only once for repeated answers', async () => {
    const f = fakes();
    const wake = new ScreenWake(f.nav, f.page);
    for (let i = 0; i < 5; i++) wake.set(true);
    await tick();
    wake.set(true);
    expect(f.state.requests).toBe(1);
  });

  it('asks again when the page comes back after being hidden', async () => {
    const f = fakes();
    const wake = new ScreenWake(f.nav, f.page);
    wake.set(true);
    await tick();
    f.state.hidden = true;
    f.sentinels[0].fire(); // the browser lets go of the lock when the page is hidden
    expect(wake.held).toBe(false);
    f.show();
    await tick();
    expect(f.state.requests).toBe(2);
    expect(wake.held).toBe(true);
  });

  it('does not ask while the page is hidden', async () => {
    const f = fakes();
    f.state.hidden = true;
    const wake = new ScreenWake(f.nav, f.page);
    wake.set(true);
    await tick();
    expect(f.state.requests).toBe(0);
    f.show();
    await tick();
    expect(wake.held).toBe(true);
  });

  it('gives a lock back that arrives after it was no longer wanted', async () => {
    const f = fakes();
    const wake = new ScreenWake(f.nav, f.page);
    wake.set(true);
    wake.set(false);
    await tick();
    expect(wake.held).toBe(false);
    expect(f.state.released).toBe(1);
  });

  it('survives a refusal and a browser without the API', async () => {
    const f = fakes();
    f.state.deny = true;
    const wake = new ScreenWake(f.nav, f.page);
    wake.set(true);
    await tick();
    expect(wake.held).toBe(false);
    const none = new ScreenWake({}, f.page);
    expect(none.supported).toBe(false);
    none.set(true);
    await tick();
    expect(none.held).toBe(false);
  });
});
