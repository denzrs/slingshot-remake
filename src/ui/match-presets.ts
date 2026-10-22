import type { VersusMode } from '../game';
import { defaultRoomRules } from '../lobbyPrefs';
import type { RoomRules } from '../net';
import { rulesFor } from './rules';

/** Presets only change rules. The line-up and this device's preferences stay with the player. */
export const MATCH_PRESETS = ['standard', 'trickshot', 'sniper', 'party'] as const;
export type MatchPreset = (typeof MATCH_PRESETS)[number];

export function presetRules(preset: MatchPreset): RoomRules {
  const base = defaultRoomRules();
  switch (preset) {
    case 'standard': return base;
    case 'trickshot': return { ...base, maxPower: 60, bounce: true, styleBonuses: true };
    case 'sniper': return { ...base, hiddenAim: true, fadingTrails: 2, shotTime: 30, maxPlanets: 3 };
    case 'party': return { ...base, powerUps: true, powerUpAmount: 4, maxPlanets: 8, bounce: true, styleBonuses: true };
  }
}

/** Match the actual rules, including manual edits, rather than remembering a potentially stale label. */
export function matchingPreset(rules: RoomRules, mode: VersusMode): MatchPreset | undefined {
  return MATCH_PRESETS.find((preset) => {
    const expected = presetRules(preset);
    return rulesFor(mode).every(({ key, when, inactive }) => {
      if (when && !when(rules) && !when(expected)) return true;
      if (inactive?.(rules) && inactive(expected)) return true;
      const a = rules[key], b = expected[key];
      return Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((value) => b.includes(value)) : a === b;
    });
  });
}
