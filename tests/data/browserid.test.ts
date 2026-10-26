import { afterEach, describe, expect, it, vi } from 'vitest';

async function fresh() {
  vi.resetModules();
  return import('../../src/data/browserId');
}

afterEach(() => vi.unstubAllGlobals());

describe('browser id', () => {
  it('is made once, kept, and has the shape the relay reads', async () => {
    const values: Record<string, string> = {};
    vi.stubGlobal('localStorage', { getItem: (key: string) => values[key] ?? null, setItem: (key: string, value: string) => { values[key] = value; } });
    const { browserId } = await fresh();
    const id = browserId();
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(browserId()).toBe(id);
    // A later page load reads the same one back.
    const again = await fresh();
    expect(again.browserId()).toBe(id);
  });

  it('two browsers get two ids', async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 20; i++) {
      vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
      ids.add((await fresh()).browserId());
    }
    expect(ids.size).toBe(20);
  });

  it('lasts the page when there is no storage, and replaces a stored value that is not an id', async () => {
    vi.stubGlobal('localStorage', undefined);
    const { browserId } = await fresh();
    expect(browserId()).toBe(browserId());

    const values: Record<string, string> = { 'slingshot.browser.v1': 'not an id' };
    vi.stubGlobal('localStorage', { getItem: (key: string) => values[key] ?? null, setItem: (key: string, value: string) => { values[key] = value; } });
    const replaced = (await fresh()).browserId();
    expect(replaced).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(values['slingshot.browser.v1']).toBe(replaced);
  });

  it('is added to the relay address, keeping what is there', async () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
    const { browserId, withBrowserId } = await fresh();
    const id = browserId();
    expect(withBrowserId('wss://relay.example:8443')).toBe(`wss://relay.example:8443/?b=${id}`);
    expect(withBrowserId('ws://localhost:8080/?x=1')).toBe(`ws://localhost:8080/?x=1&b=${id}`);
    expect(withBrowserId('not a url')).toBe('not a url');
  });
});
