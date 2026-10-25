import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CpuLevel } from '../../src/sim/ai';
import { AIM } from '../../src/sim/config';
import { POWER_UP, POWER_UP_KINDS } from '../../src/sim/powerups';
import { activeSeats, addSeat, cloneSettings, DEFAULT_SETTINGS, loadSettings, saveSettings, startPower } from '../../src/data/settings';

const CPU_LEVELS: CpuLevel[] = ['easy', 'medium', 'hard', 'hawking'];

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

describe('Mayhem settings', () => {
  it('start off', () => {
    storage();
    expect(loadSettings()).toMatchObject({ mayhem: 0 });
  });

  it('keep the chaos strength', () => {
    storage();
    const settings = cloneSettings(DEFAULT_SETTINGS);
    settings.mayhem = 3;
    saveSettings(settings);
    expect(loadSettings()).toMatchObject({ mayhem: 3 });
  });

  it('drop values nobody offers', () => {
    storage({ mayhem: 7 });
    expect(loadSettings()).toMatchObject({ mayhem: 0 });
  });
});

describe('debris', () => {
  it.each(['low', 'medium', 'high'] as const)('keeps %s after saving and reloading', (debris) => {
    storage();
    saveSettings({ ...cloneSettings(DEFAULT_SETTINGS), debris });
    expect(loadSettings().debris).toBe(debris);
  });

  it.each([undefined, 'endless', 'toString'])('replaces %s with medium', (debris) => {
    storage({ debris });
    expect(loadSettings().debris).toBe('medium');
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

describe('power-up choices', () => {
  it('start with every kind and the usual amount, also for settings saved before they existed', () => {
    storage();
    const loaded = loadSettings();
    expect(loaded.powerUpKinds).toEqual(POWER_UP_KINDS);
    expect(loaded.powerUpAmount).toBe(POWER_UP.DEFAULT_AMOUNT);
  });

  it('keep the kinds and the amount after saving and reloading', () => {
    storage();
    const settings = cloneSettings(DEFAULT_SETTINGS);
    settings.powerUpKinds = ['splitter', 'shield'];
    settings.powerUpAmount = 4;
    saveSettings(settings);
    const loaded = loadSettings();
    expect(loaded.powerUpKinds).toEqual(['splitter', 'shield']);
    expect(loaded.powerUpAmount).toBe(4);
  });

  it('drop unknown kinds, keep the usual order, and never end up with none', () => {
    storage({ powerUpKinds: ['shield', 'warp', 'preview'], powerUpAmount: 9 });
    const loaded = loadSettings();
    expect(loaded.powerUpKinds).toEqual(['preview', 'shield']);
    expect(loaded.powerUpAmount).toBe(POWER_UP.DEFAULT_AMOUNT);
    storage({ powerUpKinds: [] });
    expect(loadSettings().powerUpKinds).toEqual(POWER_UP_KINDS);
    storage({ powerUpKinds: 'preview' });
    expect(loadSettings().powerUpKinds).toEqual(POWER_UP_KINDS);
  });

  it('are copied with the settings, so a running match keeps its own', () => {
    const copy = cloneSettings(DEFAULT_SETTINGS);
    copy.powerUpKinds.pop();
    expect(DEFAULT_SETTINGS.powerUpKinds).toEqual(POWER_UP_KINDS);
  });
});

describe('display settings', () => {
  it('keeps the menu background match on by default and through a save', () => {
    storage();
    expect(loadSettings().menuBackground).toBe(true);
    const settings = cloneSettings(DEFAULT_SETTINGS);
    settings.menuBackground = false;
    saveSettings(settings);
    expect(loadSettings().menuBackground).toBe(false);
  });

  it('puts the aiming stick on the left unless the right was chosen, and remembers the choice', () => {
    storage();
    expect(loadSettings().stickSide).toBe('left');
    const settings = cloneSettings(DEFAULT_SETTINGS);
    settings.stickSide = 'right';
    saveSettings(settings);
    expect(loadSettings().stickSide).toBe('right');
    storage({ stickSide: 'top' });
    expect(loadSettings().stickSide).toBe('left');
  });

  it('ignores stored display flags that are not booleans', () => {
    storage({ menuBackground: 'false', particles: 0, contours: null });
    const s = loadSettings();
    expect(s.menuBackground).toBe(true);
    expect(s.particles).toBe(true);
    expect(s.contours).toBe(true);
  });
});

describe('sound settings', () => {
  it('migrates the old single switch to menu and game sounds', () => {
    storage({ sound: false });
    expect(loadSettings()).toMatchObject({ menuSounds: false, gameSounds: false });
  });

  it('lets saved menu and game choices override the old single switch', () => {
    storage({ sound: false, menuSounds: true });
    expect(loadSettings()).toMatchObject({ menuSounds: true, gameSounds: false });
  });
});

describe('Graphics look', () => {
  it('is the classic look unless the player picked another', () => {
    storage();
    expect(loadSettings().look).toBe('classic');
  });

  it('keeps the refined look after saving and reloading', () => {
    storage();
    const settings = cloneSettings(DEFAULT_SETTINGS);
    settings.look = 'refined';
    saveSettings(settings);
    expect(loadSettings().look).toBe('refined');
  });

  it('falls back to the classic look for a value it does not know', () => {
    storage({ look: 'sepia' });
    expect(loadSettings().look).toBe('classic');
  });
});

describe('killcam settings', () => {
  it('defaults old and fresh settings to automatic salvos', () => {
    storage();
    expect(loadSettings().killcam).toBe('auto');
    storage({ simultaneousShots: false });
    expect(loadSettings().killcam).toBe('auto');
  });

  it.each(['auto', 'off', 'every', 'round'] as const)('remembers %s after saving and reloading', (killcam) => {
    storage();
    saveSettings({ ...cloneSettings(DEFAULT_SETTINGS), killcam });
    expect(loadSettings().killcam).toBe(killcam);
  });

  it.each([null, 1, true, 'all'])('rejects invalid persisted value %s', (killcam) => {
    storage({ killcam });
    expect(loadSettings().killcam).toBe('auto');
  });
});
