import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadCustomPreset, saveCustomPreset } from '../src/customPresets';
import { defaultRoomRules } from '../src/lobbyPrefs';

const KEY = 'slingshot.presets.v1';

/** A localStorage that keeps what is written, like the browser's. */
const storage = (initial: Record<string, string> = {}) => {
  const values = { ...initial };
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, value: string) => void (values[key] = value),
  });
  return values;
};

afterEach(() => vi.unstubAllGlobals());

describe('my rules', () => {
  it('start empty in every mode', () => {
    storage();
    for (const mode of ['classic', 'solar', 'horizon'] as const) expect(loadCustomPreset(mode)).toBeNull();
  });

  it('keep one set of rules per mode', () => {
    storage();
    const classic = { ...defaultRoomRules(), rounds: 7, bounce: true };
    const horizon = { ...defaultRoomRules(), shotTime: 10, powerUps: true, powerUpKinds: ['shield' as const] };
    saveCustomPreset('classic', classic);
    saveCustomPreset('horizon', horizon);
    expect(loadCustomPreset('classic')).toEqual(classic);
    expect(loadCustomPreset('horizon')).toEqual(horizon);
    expect(loadCustomPreset('solar')).toBeNull();
  });

  it('leave the table switches with the table', () => {
    const values = storage();
    saveCustomPreset('classic', { ...defaultRoomRules(), betting: true, chatPlayersOnly: true });
    expect(JSON.parse(values[KEY]).classic).not.toHaveProperty('betting');
    expect(loadCustomPreset('classic')).toMatchObject({ betting: false, chatPlayersOnly: false });
  });

  it('fall back to the standard rules for values nobody offers any more', () => {
    storage({ [KEY]: JSON.stringify({ classic: { rounds: 7, mayhem: 9 } }) });
    expect(loadCustomPreset('classic')).toEqual({ ...defaultRoomRules(), rounds: 7 });
  });

  it('survive corrupt or blocked storage', () => {
    storage({ [KEY]: '{not json' });
    expect(loadCustomPreset('classic')).toBeNull();
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    expect(() => saveCustomPreset('classic', defaultRoomRules())).not.toThrow();
    expect(loadCustomPreset('classic')).toBeNull();
  });
});
