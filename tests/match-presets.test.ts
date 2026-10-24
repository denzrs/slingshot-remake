import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, cloneSettings } from '../src/settings';
import { rulesOf } from '../src/lobbyPrefs';
import { presetsForMode, matchingPreset, presetRules, handpickedPresets, matchingHandpicked, pickOfTheDay, samePick, MAYHEM_PRESET_LEVEL } from '../src/ui/match-presets';
import { rulesFor } from '../src/ui/rules';

describe('match presets', () => {
  it('recognises the original defaults without applying a preset', () => {
    for (const mode of ['classic', 'horizon'] as const) {
      expect(matchingPreset(rulesOf(DEFAULT_SETTINGS), mode)).toBe('standard');
    }
  });

  it('offers complete rule sets that both modes can play with', () => {
    for (const mode of ['classic', 'horizon'] as const) {
      for (const preset of presetsForMode(mode)) {
        const rules = presetRules(preset);
        expect(matchingPreset(rules, mode)).toBe(preset);
        for (const row of rulesFor(mode)) {
          if (!row.options.length || row.control === 'tiles' || row.key === 'fixedPower' || row.key === 'maxPower') continue;
          if (row.when && !row.when(rules)) continue;
          expect(row.options.map(({ value }) => value), `${preset}: ${row.key}`).toContain(rules[row.key]);
        }
      }
    }
  });

  it('marks manually edited rules as custom, and recognises them again when restored', () => {
    const rules = presetRules('simultaneous');
    rules.rounds = 7;
    expect(matchingPreset(rules, 'classic')).toBeUndefined();
    rules.rounds = 5;
    expect(matchingPreset(rules, 'classic')).toBe('simultaneous');
    rules.simultaneousShots = false;
    rules.hiddenAim = true;
    expect(matchingPreset(rules, 'classic')).toBeUndefined();
  });

  it('does not label a Horizon match custom for Classic-only or online rules', () => {
    const rules = { ...presetRules('standard'), invisiblePlanets: true, simultaneousShots: true, styleBonuses: true, betting: true, chatPlayersOnly: true };
    expect(matchingPreset(rules, 'horizon')).toBe('standard');
    expect(matchingPreset(rules, 'classic')).toBeUndefined();
  });

  it('ignores power-up choices while they are off, but checks them while they are on', () => {
    const rules = presetRules('standard');
    rules.powerUpAmount = 1;
    rules.powerUpKinds = ['shield'];
    expect(matchingPreset(rules, 'classic')).toBe('standard');
    const changedPick = { ...handpickedPresets('classic')[2].rules, powerUpKinds: rules.powerUpKinds };
    expect(matchingHandpicked(changedPick, 'classic')).toBeUndefined();
  });

  it('replaces previous custom rules without changing seats or device preferences', () => {
    const settings = cloneSettings(DEFAULT_SETTINGS);
    settings.seats = ['human', 'hard', 'easy', 'off', 'off', 'off'];
    settings.teamMode = 2;
    settings.language = 'en';
    settings.stickSide = 'right';
    settings.menuSounds = false;
    settings.gameSounds = false;
    settings.fixedPower = true;
    settings.invisiblePlanets = true;
    const before = cloneSettings(settings);
    Object.assign(settings, presetRules('mayhem'));
    expect(matchingPreset(rulesOf(settings), 'classic')).toBe('mayhem');
    for (const key of ['seats', 'seatTeams', 'teamMode', 'language', 'stickSide', 'menuSounds', 'gameSounds'] as const) {
      expect(settings[key]).toEqual(before[key]);
    }
    expect(settings.fixedPower).toBe(false);
    expect(settings.invisiblePlanets).toBe(false);
  });

  it('gives every application its own power-up list', () => {
    const first = presetRules('mayhem');
    first.powerUpKinds.pop();
    expect(presetRules('mayhem').powerUpKinds).toEqual(DEFAULT_SETTINGS.powerUpKinds);
  });
});

describe('the Mayhem preset', () => {
  it('stands in for Party in both modes, at Wild', () => {
    for (const mode of ['classic', 'horizon'] as const) {
      expect(presetsForMode(mode).at(-1)).toBe('mayhem');
      expect(presetsForMode(mode)).not.toContain('party');
    }
    expect(MAYHEM_PRESET_LEVEL).toBe(2);
    expect(presetRules('mayhem')).toEqual({ ...rulesOf(DEFAULT_SETTINGS), mayhem: 2, styleBonuses: true, simultaneousShots: true });
  });

  it('stays selected at any strength, and no other preset has twists', () => {
    for (const mode of ['classic', 'horizon'] as const) {
      for (const mayhem of [1, 2, 3]) expect(matchingPreset({ ...presetRules('mayhem'), mayhem }, mode)).toBe('mayhem');
      expect(matchingPreset({ ...presetRules('standard'), mayhem: 2 }, mode)).not.toBe('standard');
      for (const preset of presetsForMode(mode)) expect(presetRules(preset).mayhem > 0).toBe(preset === 'mayhem');
    }
  });
});


describe('simultaneous shots in presets', () => {
  it('fires one ship at a time only in Classic Standard', () => {
    for (const mode of ['classic', 'solar', 'horizon'] as const) {
      for (const preset of presetsForMode(mode)) {
        const sequential = mode === 'classic' && preset === 'standard';
        // Event Horizon always fires simultaneously; its rule row doesn't exist.
        if (mode === 'horizon') continue;
        expect(presetRules(preset, mode).simultaneousShots, `${mode}/${preset}`).toBe(!sequential);
      }
    }
  });

  it('gives the Solar System no separate All-at-once card, since all of its presets are simultaneous', () => {
    expect(presetsForMode('solar')).toEqual(['standard', 'powerups', 'mayhem']);
  });

  it('turns every kind of power-up on in the Solar System\'s Power-ups preset', () => {
    const rules = presetRules('powerups', 'solar');
    expect(rules.powerUps).toBe(true);
    expect(rules.powerUpKinds).toEqual(DEFAULT_SETTINGS.powerUpKinds);
    expect(matchingPreset(rules, 'solar')).toBe('powerups');
    expect(matchingPreset({ ...rules, powerUps: false }, 'solar')).toBe('standard');
    expect(() => presetRules('powerups', 'classic')).toThrow();
  });
});

describe('handpicked combinations', () => {
  it('fires simultaneously in every pick', () => {
    for (const mode of ['classic', 'solar'] as const) {
      for (const pick of handpickedPresets(mode)) expect(pick.rules.simultaneousShots, `${mode}/${pick.mode}.${pick.id}`).toBe(true);
    }
  });

  it('offers Standard, the mode’s own preset and Mayhem as the regular choices', () => {
    expect(presetsForMode('classic')).toEqual(['standard', 'simultaneous', 'mayhem']);
    expect(presetsForMode('horizon')).toEqual(['standard', 'trickshot', 'mayhem']);
  });

  it('provides six distinct, selectable, mode-specific daily combinations with valid settings', () => {
    for (const mode of ['classic', 'solar', 'horizon'] as const) {
      const picks = handpickedPresets(mode);
      expect(picks).toHaveLength(6);
      expect(picks.every((pick) => pick.mode === mode)).toBe(true);
      expect(picks.filter((pick) => pick.rules.mayhem > 0)).toHaveLength(2);
      expect(new Set(picks.map(({ id, mode }) => `${mode}.${id}`)).size).toBe(6);
      for (const pick of picks) {
        expect(pick.base).toBe(mode);
        expect(samePick(matchingHandpicked(pick.rules, mode), pick)).toBe(true);
        for (const row of rulesFor(pick.base)) {
          if (!row.options.length || row.control === 'tiles' || row.key === 'fixedPower' || row.key === 'maxPower') continue;
          if (row.when && !row.when(pick.rules)) continue;
          expect(row.options.map(({ value }) => value), `${mode}/${pick.id}: ${row.key}`).toContain(pick.rules[row.key]);
        }
      }
    }
  });

  it('keeps each mode’s daily choice stable, distinct across modes and different from yesterday', () => {
    const modes = ['classic', 'solar', 'horizon'] as const;
    const days = Array.from({ length: 90 }, (_, i) => new Date(Date.UTC(2026, 9, i + 1)).toISOString().slice(0, 10));
    const key = (pick: { id: string; mode: string }) => `${pick.mode}.${pick.id}`;
    for (const mode of modes) {
      const keys = days.map((day) => key(pickOfTheDay(mode, day)));
      expect(new Set(keys).size).toBe(6);
      expect(keys.some((k, i) => i > 0 && k === keys[i - 1])).toBe(false);
    }
    for (const day of days) {
      const picks = modes.map((mode) => pickOfTheDay(mode, day));
      expect(new Set(picks.map((pick) => key(pick))).size).toBe(modes.length);
      for (const [i, pick] of picks.entries()) {
        // Revisit after another day to exercise the cache as well.
        pickOfTheDay(modes[i], '2027-01-01');
        expect(pickOfTheDay(modes[i], day)).toEqual(pick);
      }
    }
  });

  it('clears a Mayhem recommendation when choosing the Mayhem preset, even at the same chaos strength', () => {
    for (const mode of ['classic', 'solar', 'horizon'] as const) {
      for (const pick of handpickedPresets(mode).filter((pick) => pick.rules.mayhem > 0)) {
        const settings = cloneSettings(DEFAULT_SETTINGS);
        Object.assign(settings, pick.rules);
        expect(samePick(matchingHandpicked(rulesOf(settings), mode), pick)).toBe(true);
        Object.assign(settings, presetRules('mayhem'), { mayhem: pick.rules.mayhem });
        expect(matchingHandpicked(rulesOf(settings), mode)).toBeUndefined();
      }
    }
  });

  it('keeps Mayhem as part of each authored daily combination and matches its full rules', () => {
    for (const mode of ['classic', 'solar', 'horizon'] as const) {
      for (const pick of handpickedPresets(mode).filter((pick) => pick.rules.mayhem > 0)) {
        expect(pick.rules.mayhem).toBeGreaterThan(0);
        expect(samePick(matchingHandpicked(pick.rules, mode), pick)).toBe(true);
        expect(matchingHandpicked({ ...pick.rules, rounds: 15 }, mode)).toBeUndefined();
        expect(matchingHandpicked({ ...pick.rules, mayhem: pick.rules.mayhem === 3 ? 2 : 3 }, mode)).toBeUndefined();
      }
    }
  });

  it('clears the selection when edited while ignoring inactive rules and room preferences', () => {
    const pick = handpickedPresets('horizon')[0];
    expect(matchingHandpicked({ ...pick.rules, maxPower: 30, simultaneousShots: true, betting: true }, 'horizon')?.id).toBe(pick.id);
    expect(matchingHandpicked({ ...pick.rules, shotTime: 60 }, 'horizon')).toBeUndefined();
    const first = handpickedPresets('classic')[2];
    first.rules.powerUpKinds.pop();
    expect(handpickedPresets('classic')[2].rules.powerUpKinds).toHaveLength(4);
  });
});
