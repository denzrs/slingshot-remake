import type { VersusMode } from '../game';
import { defaultRoomRules } from '../lobbyPrefs';
import type { RoomRules } from '../net';
import { rulesFor } from './rules';
import type { Key } from '../i18n';
import type { MayhemPresetArt } from './mode-icons';

/** The Classic screen replaces Trickshot with a first-class simultaneous-shots preset. */
export const MATCH_PRESETS = ['standard', 'trickshot', 'sniper', 'party'] as const;
export const CLASSIC_PRESETS = ['standard', 'simultaneous', 'sniper', 'party'] as const;
export type MatchPreset = (typeof MATCH_PRESETS)[number] | (typeof CLASSIC_PRESETS)[number];

/** Event Horizon keeps Trickshot; Classic offers simultaneous fire instead. */
export function presetsForMode(mode: VersusMode): readonly MatchPreset[] {
  return mode === 'classic' ? CLASSIC_PRESETS : MATCH_PRESETS;
}

export function presetRules(preset: MatchPreset): RoomRules {
  const base = defaultRoomRules();
  switch (preset) {
    case 'standard': return base;
    case 'trickshot': return { ...base, maxPower: 60, bounce: true, styleBonuses: true };
    case 'sniper': return { ...base, hiddenAim: true, fadingTrails: 2, shotTime: 30, maxPlanets: 3 };
    case 'party': return { ...base, powerUps: true, powerUpAmount: 4, maxPlanets: 8, bounce: true, styleBonuses: true };
    case 'simultaneous': return { ...base, simultaneousShots: true };
  }
}

/** Match the actual rules, including manual edits, rather than remembering a potentially stale label. */
export function matchingPreset(rules: RoomRules, mode: VersusMode): MatchPreset | undefined {
  const candidates: readonly MatchPreset[] = [...MATCH_PRESETS, 'simultaneous'];
  return candidates.find((preset) => {
    const expected = presetRules(preset);
    return rulesFor(mode).every(({ key, when, inactive }) => {
      if (when && !when(rules) && !when(expected)) return true;
      if (inactive?.(rules) && inactive(expected)) return true;
      const a = rules[key], b = expected[key];
      return Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((value) => b.includes(value)) : a === b;
    });
  });
}

/** The same four Mayhem starts in the offline briefing and online room setup. */
export const MAYHEM_PRESETS = [
  { key: 'mayhem.preset.wildClassic', art: 'wildClassic', strength: 2, base: 'classic', simultaneousShots: false },
  { key: 'mayhem.preset.insaneClassic', art: 'insaneClassic', strength: 3, base: 'classic', simultaneousShots: false },
  { key: 'mayhem.preset.insaneClassicSimultaneous', art: 'insaneClassicSimultaneous', strength: 3, base: 'classic', simultaneousShots: true },
  { key: 'mayhem.preset.insaneHorizon', art: 'insaneHorizon', strength: 3, base: 'horizon', simultaneousShots: false },
] as const satisfies readonly { key: Key; art: MayhemPresetArt; strength: number; base: VersusMode; simultaneousShots: boolean }[];

export function matchingMayhemPreset(settings: { mayhem: number; mayhemBase: VersusMode; simultaneousShots: boolean }): (typeof MAYHEM_PRESETS)[number] | undefined {
  return MAYHEM_PRESETS.find((preset) => settings.mayhem === preset.strength
    && settings.mayhemBase === preset.base
    && (preset.base === 'horizon' || settings.simultaneousShots === preset.simultaneousShots));
}
