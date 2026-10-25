import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearOverride, deleteCustomPreset, loadCustomPresets, loadOverride, MAX_CUSTOM_PRESETS, MAX_PRESET_NAME, saveCustomPreset, saveOverride } from '../../src/data/customPresets';
import { defaultRoomRules } from '../../src/data/roomRules';
import { isOverridden, matchingCustom, matchingPreset, presetRules, savedPresetRules } from '../../src/ui/presets/match-presets';

const KEY = 'slingshot.presets.v2';

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

describe('the player\'s own presets', () => {
  it('start empty in every mode', () => {
    storage();
    for (const mode of ['classic', 'solar', 'horizon'] as const) expect(loadCustomPresets(mode)).toEqual([]);
  });

  it('keep a named list per mode, in the order they were made', () => {
    storage();
    const classic = { ...defaultRoomRules(), rounds: 7, bounce: true };
    const horizon = { ...defaultRoomRules(), shotTime: 10, powerUps: true, powerUpKinds: ['shield' as const] };
    const first = saveCustomPreset('classic', { name: 'Blitz', rules: classic })!;
    const second = saveCustomPreset('classic', { name: 'Marathon', rules: { ...classic, rounds: 20 } })!;
    saveCustomPreset('horizon', { name: 'Schild', rules: horizon });
    expect(loadCustomPresets('classic').map((p) => p.name)).toEqual(['Blitz', 'Marathon']);
    expect(loadCustomPresets('classic')[0]).toEqual({ id: first.id, name: 'Blitz', rules: classic });
    expect(second.id).not.toBe(first.id);
    expect(loadCustomPresets('horizon')[0].rules).toEqual(horizon);
    expect(loadCustomPresets('solar')).toEqual([]);
  });

  it('replace a preset in its place when it is saved again', () => {
    storage();
    const a = saveCustomPreset('classic', { name: 'A', rules: defaultRoomRules() })!;
    saveCustomPreset('classic', { name: 'B', rules: defaultRoomRules() });
    saveCustomPreset('classic', { id: a.id, name: 'A2', rules: { ...defaultRoomRules(), rounds: 3 } });
    expect(loadCustomPresets('classic').map((p) => [p.name, p.rules.rounds])).toEqual([['A2', 3], ['B', defaultRoomRules().rounds]]);
  });

  it('stop at the limit, and make room again once one is deleted', () => {
    storage();
    for (let i = 0; i < MAX_CUSTOM_PRESETS; i++) expect(saveCustomPreset('classic', { name: `P${i}`, rules: defaultRoomRules() })).not.toBeNull();
    expect(saveCustomPreset('classic', { name: 'one too many', rules: defaultRoomRules() })).toBeNull();
    deleteCustomPreset('classic', loadCustomPresets('classic')[1].id);
    expect(loadCustomPresets('classic').map((p) => p.name)).toEqual(['P0', 'P2', 'P3']);
    expect(saveCustomPreset('classic', { name: 'room again', rules: defaultRoomRules() })).not.toBeNull();
  });

  it('refuse an empty name and a preset that was deleted elsewhere', () => {
    storage();
    expect(saveCustomPreset('classic', { name: '   ', rules: defaultRoomRules() })).toBeNull();
    expect(saveCustomPreset('classic', { id: 'gone', name: 'Ghost', rules: defaultRoomRules() })).toBeNull();
    expect(loadCustomPresets('classic')).toEqual([]);
  });

  it('tidy names to fit on a card', () => {
    storage();
    const kept = saveCustomPreset('classic', { name: `  a   b ${'x'.repeat(60)}`, rules: defaultRoomRules() })!;
    expect(kept.name.startsWith('a b x')).toBe(true);
    expect(kept.name.length).toBeLessThanOrEqual(MAX_PRESET_NAME);
  });

  it('leave the table switches with the table', () => {
    const values = storage();
    saveCustomPreset('classic', { name: 'Tisch', rules: { ...defaultRoomRules(), betting: true, chatPlayersOnly: true } });
    expect(JSON.parse(values[KEY]).classic.custom[0].rules).not.toHaveProperty('betting');
    expect(loadCustomPresets('classic')[0].rules).toMatchObject({ betting: false, chatPlayersOnly: false });
  });

  it('fall back to the standard rules for values nobody offers any more', () => {
    storage({ [KEY]: JSON.stringify({ classic: { custom: [{ id: 'x', name: 'Old', rules: { rounds: 7, mayhem: 9 } }, { nonsense: true }] } }) });
    expect(loadCustomPresets('classic')).toEqual([{ id: 'x', name: 'Old', rules: { ...defaultRoomRules(), rounds: 7 } }]);
  });

  it('survive corrupt or blocked storage', () => {
    storage({ [KEY]: '{not json' });
    expect(loadCustomPresets('classic')).toEqual([]);
    expect(loadOverride('classic', 'standard')).toBeNull();
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    expect(() => saveCustomPreset('classic', { name: 'x', rules: defaultRoomRules() })).not.toThrow();
    expect(() => saveOverride('classic', 'standard', defaultRoomRules())).not.toThrow();
    expect(loadCustomPresets('classic')).toEqual([]);
  });
});

describe('changed built-in presets', () => {
  it('stay as they are until the player saves a change, and come back with a reset', () => {
    storage();
    expect(isOverridden('standard', 'classic')).toBe(false);
    expect(savedPresetRules('standard', 'classic')).toEqual(presetRules('standard', 'classic'));
    const changed = { ...presetRules('standard', 'classic'), rounds: 10, hiddenAim: true };
    saveOverride('classic', 'standard', changed);
    expect(isOverridden('standard', 'classic')).toBe(true);
    expect(savedPresetRules('standard', 'classic')).toEqual(changed);
    // Neither another preset nor another mode is touched.
    expect(savedPresetRules('mayhem', 'classic')).toEqual(presetRules('mayhem', 'classic'));
    expect(savedPresetRules('standard', 'horizon')).toEqual(presetRules('standard', 'horizon'));
    clearOverride('classic', 'standard');
    expect(isOverridden('standard', 'classic')).toBe(false);
    expect(savedPresetRules('standard', 'classic')).toEqual(presetRules('standard', 'classic'));
  });

  it('are the card that matches the rules, instead of the original', () => {
    storage();
    const original = presetRules('standard', 'classic');
    const changed = { ...original, rounds: 10 };
    expect(matchingPreset(changed, 'classic')).toBeUndefined();
    saveOverride('classic', 'standard', changed);
    expect(matchingPreset(changed, 'classic')).toBe('standard');
    expect(matchingPreset(original, 'classic')).toBeUndefined();
  });

  it('are kept beside the player\'s own presets', () => {
    storage();
    saveOverride('classic', 'standard', { ...presetRules('standard', 'classic'), rounds: 10 });
    const mine = saveCustomPreset('classic', { name: 'Mine', rules: { ...defaultRoomRules(), rounds: 3 } })!;
    expect(isOverridden('standard', 'classic')).toBe(true);
    expect(matchingCustom({ ...defaultRoomRules(), rounds: 3 }, 'classic')?.id).toBe(mine.id);
    deleteCustomPreset('classic', mine.id);
    expect(isOverridden('standard', 'classic')).toBe(true);
    expect(matchingCustom({ ...defaultRoomRules(), rounds: 3 }, 'classic')).toBeUndefined();
  });
});
