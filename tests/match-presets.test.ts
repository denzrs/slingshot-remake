import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, cloneSettings } from '../src/settings';
import { rulesOf } from '../src/lobbyPrefs';
import { presetsForMode, matchingPreset, presetRules, handpickedPresets, matchingHandpicked, pickOfTheDay, MAYHEM_PRESETS, mayhemPresetRules } from '../src/ui/match-presets';
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
    const party = { ...presetRules('party'), powerUpKinds: rules.powerUpKinds };
    expect(matchingPreset(party, 'classic')).toBeUndefined();
  });

  it('replaces previous custom rules without changing seats or device preferences', () => {
    const settings = cloneSettings(DEFAULT_SETTINGS);
    settings.seats = ['human', 'hard', 'easy', 'off', 'off', 'off'];
    settings.teamMode = 2;
    settings.language = 'en';
    settings.stickSide = 'right';
    settings.sound = false;
    settings.fixedPower = true;
    settings.invisiblePlanets = true;
    const before = cloneSettings(settings);
    Object.assign(settings, presetRules('party'));
    expect(matchingPreset(rulesOf(settings), 'classic')).toBe('party');
    for (const key of ['seats', 'seatTeams', 'teamMode', 'language', 'stickSide', 'sound'] as const) {
      expect(settings[key]).toEqual(before[key]);
    }
    expect(settings.fixedPower).toBe(false);
    expect(settings.invisiblePlanets).toBe(false);
  });

  it('gives every application its own power-up list', () => {
    const first = presetRules('party');
    first.powerUpKinds.pop();
    expect(presetRules('party').powerUpKinds).toEqual(DEFAULT_SETTINGS.powerUpKinds);
  });
});


describe('handpicked combinations', () => {
  it('removes Sniper and Insane Classic from the regular choices', () => {
    expect(presetsForMode('classic')).toEqual(['standard', 'simultaneous', 'party']);
    expect(presetsForMode('horizon')).toEqual(['standard', 'trickshot', 'party']);
    expect(MAYHEM_PRESETS.map(({ art }) => art)).toEqual(['wildClassic', 'insaneClassicSimultaneous', 'insaneHorizon']);
  });

  it('provides four distinct, selectable combinations with valid settings in each mode', () => {
    for (const mode of ['classic', 'horizon', 'mayhem'] as const) {
      const picks = handpickedPresets(mode);
      expect(picks).toHaveLength(4);
      expect(new Set(picks.map(({ id }) => id)).size).toBe(4);
      for (const pick of picks) {
        expect(matchingHandpicked(pick.rules, mode, pick.base)?.id).toBe(pick.id);
        for (const row of rulesFor(pick.base, false, mode === 'mayhem')) {
          if (!row.options.length || row.control === 'tiles' || row.key === 'fixedPower' || row.key === 'maxPower') continue;
          if (row.when && !row.when(pick.rules)) continue;
          expect(row.options.map(({ value }) => value), `${mode}/${pick.id}: ${row.key}`).toContain(pick.rules[row.key]);
        }
      }
    }
  });

  it('keeps each mode’s daily choice stable, distinct from other modes and different from yesterday', () => {
    const modes = ['classic', 'horizon', 'mayhem'] as const;
    const days = Array.from({ length: 90 }, (_, i) => new Date(Date.UTC(2026, 9, i + 1)).toISOString().slice(0, 10));
    for (const mode of modes) {
      const ids = days.map((day) => pickOfTheDay(mode, day).id);
      expect(new Set(ids).size).toBe(4);
      expect(ids.some((id, i) => i > 0 && id === ids[i - 1])).toBe(false);
      expect(ids.slice(4)).not.toEqual(ids.slice(0, -4));
    }
    for (const day of days) {
      const picks = modes.map((mode) => pickOfTheDay(mode, day));
      expect(new Set(picks.map(({ id }) => id)).size).toBe(3);
      for (const pick of picks) {
        // Revisit after another day to exercise the cache as well.
        pickOfTheDay(pick.mode, '2027-01-01');
        expect(pickOfTheDay(pick.mode, day)).toEqual(pick);
      }
    }
  });

  it('clears a Mayhem recommendation when choosing any regular preset, even at the same chaos strength', () => {
    for (const pick of handpickedPresets('mayhem')) {
      const settings = cloneSettings(DEFAULT_SETTINGS);
      Object.assign(settings, pick.rules, { mayhemBase: pick.base });
      expect(matchingHandpicked(rulesOf(settings), 'mayhem', settings.mayhemBase)?.id).toBe(pick.id);
      for (const preset of MAYHEM_PRESETS) {
        Object.assign(settings, mayhemPresetRules(preset), { mayhemBase: preset.base });
        expect(matchingHandpicked(rulesOf(settings), 'mayhem', settings.mayhemBase)).toBeUndefined();
      }
    }
  });

  it('uses Mayhem settings that survive game normalization, and matches the actual base mode', () => {
    for (const pick of handpickedPresets('mayhem')) {
      expect(pick.rules.mayhem).toBeGreaterThan(0);
      expect(pick.rules.maxPlanets).toBe(DEFAULT_SETTINGS.maxPlanets);
      expect(pick.rules.powerUps).toBe(false);
      expect(matchingHandpicked(pick.rules, 'mayhem', pick.base === 'classic' ? 'horizon' : 'classic')).toBeUndefined();
      expect(matchingHandpicked({ ...pick.rules, rounds: 15 }, 'mayhem', pick.base)).toBeUndefined();
    }
  });

  it('clears the selection when edited while ignoring inactive rules and room preferences', () => {
    const pick = handpickedPresets('horizon')[0];
    expect(matchingHandpicked({ ...pick.rules, maxPower: 30, simultaneousShots: true, betting: true }, 'horizon')?.id).toBe(pick.id);
    expect(matchingHandpicked({ ...pick.rules, shotTime: 60 }, 'horizon')).toBeUndefined();
    const first = handpickedPresets('classic')[2];
    first.rules.powerUpKinds.pop();
    expect(handpickedPresets('classic')[2].rules.powerUpKinds).toHaveLength(3);
  });
});
