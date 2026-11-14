import { afterEach, describe, expect, it, vi } from 'vitest';
import { finishOnboarding, introSkipped, needsOnboarding, ONBOARDING_KEY } from '../../src/data/onboarding';

afterEach(() => vi.unstubAllGlobals());

describe('first-run introduction', () => {
  it('remembers both completion and skipping without touching device settings', () => {
    const values = new Map([['slingshot.settings.v1', '{"look":"classic"}']]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    expect(needsOnboarding()).toBe(true);
    finishOnboarding();
    expect(values.get(ONBOARDING_KEY)).toBe('done');
    expect(needsOnboarding()).toBe(false);
    expect(values.get('slingshot.settings.v1')).toBe('{"look":"classic"}');
  });

  it('is left out for a visit whose address says so, whatever else the address carries', () => {
    expect(introSkipped('?nointro')).toBe(true);
    expect(introSkipped('?debug&nointro=1&try=lane-check')).toBe(true);
    expect(introSkipped('')).toBe(false);
    expect(introSkipped('?intro=no')).toBe(false);
  });

  it('allows playing when browser storage is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    });
    expect(needsOnboarding()).toBe(true);
    expect(() => finishOnboarding()).not.toThrow();
  });
});
