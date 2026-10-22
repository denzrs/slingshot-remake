import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, cloneSettings } from '../src/settings';
import { rulesOf } from '../src/lobbyPrefs';
import { MATCH_PRESETS, matchingPreset, presetRules } from '../src/ui/match-presets';
import { rulesFor } from '../src/ui/rules';

describe('match presets', () => {
  it('recognises the original defaults without applying a preset', () => {
    for (const mode of ['classic', 'horizon'] as const) {
      expect(matchingPreset(rulesOf(DEFAULT_SETTINGS), mode)).toBe('standard');
    }
  });

  it('offers complete rule sets that both modes can play with', () => {
    for (const mode of ['classic', 'horizon'] as const) {
      for (const preset of MATCH_PRESETS) {
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
    const rules = presetRules('sniper');
    rules.rounds = 7;
    expect(matchingPreset(rules, 'classic')).toBeUndefined();
    rules.rounds = 5;
    expect(matchingPreset(rules, 'classic')).toBe('sniper');
    rules.hiddenAim = false;
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
