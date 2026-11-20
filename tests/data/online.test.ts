import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Online = typeof import('../../src/data/online');

/** A fresh copy of the module for each test: the visit's allowance lives in it. */
async function load(values = new Map<string, string>()): Promise<{ online: Online; values: Map<string, string> }> {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  vi.resetModules();
  return { online: await import('../../src/data/online'), values };
}

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe('online features', () => {
  it('are off until the player answers', async () => {
    const { online } = await load();
    expect(online.onlineDecided()).toBe(false);
    expect(online.onlineAllowed()).toBe(false);
  });

  it('keep the answer for later visits', async () => {
    const { online, values } = await load();
    online.setOnline(true);
    expect(values.get(online.ONLINE_KEY)).toBe('on');
    expect(online.onlineAllowed()).toBe(true);
    online.setOnline(false);
    expect(values.get(online.ONLINE_KEY)).toBe('off');
    expect(online.onlineAllowed()).toBe(false);
  });

  it('stay on for a player from before the question, and are not asked again', async () => {
    const { online, values } = await load();
    online.keepOnlineForReturningPlayer(true);
    expect(values.get(online.ONLINE_KEY)).toBe('on');
    expect(online.onlineAllowed()).toBe(true);
  });

  it('leave an earlier answer alone, and a new player undecided', async () => {
    const offline = await load(new Map([['slingshot.online.v1', 'off']]));
    offline.online.keepOnlineForReturningPlayer(true);
    expect(offline.online.onlineAllowed()).toBe(false);
    const fresh = await load();
    fresh.online.keepOnlineForReturningPlayer(false);
    expect(fresh.online.onlineDecided()).toBe(false);
  });

  it('are on for a visit that skips the introduction, without saving it or overruling an offline choice', async () => {
    const { online, values } = await load();
    online.allowOnlineForVisit();
    expect(online.onlineAllowed()).toBe(true);
    expect(values.has(online.ONLINE_KEY)).toBe(false);
    online.setOnline(false);
    expect(online.onlineAllowed()).toBe(false);
  });

  it('tell listeners when the answer changes, and only then', async () => {
    const { online } = await load();
    const heard: boolean[] = [];
    const stop = online.onOnlineChange((on) => heard.push(on));
    online.setOnline(false);
    online.setOnline(true);
    online.setOnline(true);
    stop();
    online.setOnline(false);
    expect(heard).toEqual([true]);
  });

  it('still switch for this visit when storage is blocked', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    });
    const online = await import('../../src/data/online');
    expect(online.onlineAllowed()).toBe(false);
    online.setOnline(true);
    expect(online.onlineAllowed()).toBe(true);
  });
});
