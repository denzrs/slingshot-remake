import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CpuLevel } from '../src/ai';
import { AIM } from '../src/config';
import { activeSeats, addSeat, cloneSettings, DEFAULT_SETTINGS, loadSettings, saveSettings, startPower } from '../src/settings';

const CPU_LEVELS: CpuLevel[] = ['easy', 'medium', 'hard', 'hawking', 'experimental', 'experimental-easy', 'experimental-medium', 'experimental-hard'];

function storage(initial?: Record<string, unknown>): void {
  const values = new Map<string, string>();
  if (initial) values.set('slingshot.settings.v1', JSON.stringify(initial));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('CPU settings', () => {
  it.each(CPU_LEVELS)('keeps the %s CPU selection after saving and reloading', (level) => {
    storage();
    const settings = cloneSettings(DEFAULT_SETTINGS);
    settings.seats = ['human', level, 'off', 'off', 'off', 'off'];
    saveSettings(settings);
    expect(loadSettings().seats).toEqual(settings.seats);
  });

  it.each(CPU_LEVELS)('adds %s to the last free seat without exceeding six ships', (level) => {
    const settings = cloneSettings(DEFAULT_SETTINGS);
    settings.seats = ['human', 'easy', 'medium', 'hard', 'hawking', 'off'];
    expect(addSeat(settings, level)).toBe(5);
    expect(settings.seats[5]).toBe(level);
    expect(addSeat(settings, level)).toBeNull();
    expect(activeSeats(settings)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe('power settings', () => {
  it.each([10, 100])('keeps the supported cap boundary %s after saving and reloading', (maxPower) => {
    storage();
    const settings = cloneSettings({ ...DEFAULT_SETTINGS, maxPower });
    saveSettings(settings);
    expect(loadSettings().maxPower).toBe(maxPower);
  });

  it.each([0, 9, 11, 99, 101])('replaces unsupported cap %s with the default', (maxPower) => {
    storage({ maxPower });
    expect(loadSettings().maxPower).toBe(AIM.MAX_POWER);
  });

  it('keeps old settings without a cap playable at the default power', () => {
    storage({ seats: ['human', 'hard'], fixedPower: false });
    const settings = loadSettings();
    expect(settings.maxPower).toBe(AIM.MAX_POWER);
    expect(startPower(settings)).toBe(AIM.DEFAULT_POWER);
  });

  it.each([
    { fixedPower: false, fixedPowerLevel: 90, maxPower: 10, expected: 10 },
    { fixedPower: false, fixedPowerLevel: 90, maxPower: 50, expected: 50 },
    { fixedPower: false, fixedPowerLevel: 90, maxPower: 100, expected: 50 },
    { fixedPower: true, fixedPowerLevel: 90, maxPower: 10, expected: 10 },
    { fixedPower: true, fixedPowerLevel: 90, maxPower: 90, expected: 90 },
    { fixedPower: true, fixedPowerLevel: 10, maxPower: 100, expected: 10 },
  ])('starts shots at $expected with fixed=$fixedPower, level=$fixedPowerLevel and cap=$maxPower', ({ expected, ...settings }) => {
    expect(startPower(settings)).toBe(expected);
  });
});
