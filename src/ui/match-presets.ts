import type { VersusMode } from '../game';
import { defaultRoomRules, mayhemRules } from '../lobbyPrefs';
import type { RoomRules } from '../net';
import { rulesFor } from './rules';
import type { Key } from '../i18n';
import type { MayhemPresetArt } from './mode-icons';

/** Regular presets follow the featured handpicked collection. */
export const MATCH_PRESETS = ['standard', 'trickshot', 'party'] as const;
export const CLASSIC_PRESETS = ['standard', 'simultaneous', 'party'] as const;
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
    case 'party': return { ...base, powerUps: true, powerUpAmount: 4, maxPlanets: 8, bounce: true, styleBonuses: true };
    case 'simultaneous': return { ...base, simultaneousShots: true };
  }
}

/** Match the actual rules, including manual edits, rather than remembering a potentially stale label. */
export function matchingPreset(rules: RoomRules, mode: VersusMode): MatchPreset | undefined {
  const candidates = presetsForMode(mode);
  return candidates.find((preset) => {
    const expected = presetRules(preset);
    if (rules.powerUps !== expected.powerUps) return false;
    return rulesFor(mode).every(({ key, when, inactive }) => {
      if (key === 'powerUpKinds' && !rules.powerUps && !expected.powerUps) return true;
      if (when && !when(rules) && !when(expected)) return true;
      if (inactive?.(rules) && inactive(expected)) return true;
      const a = rules[key], b = expected[key];
      return Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((value) => b.includes(value)) : a === b;
    });
  });
}

/** The same Mayhem starts in the offline briefing and online room setup. */
export const MAYHEM_PRESETS = [
  { key: 'mayhem.preset.wildClassic', art: 'wildClassic', strength: 2, base: 'classic', simultaneousShots: false },
  { key: 'mayhem.preset.insaneClassicSimultaneous', art: 'insaneClassicSimultaneous', strength: 3, base: 'classic', simultaneousShots: true },
  { key: 'mayhem.preset.insaneHorizon', art: 'insaneHorizon', strength: 3, base: 'horizon', simultaneousShots: false },
] as const satisfies readonly { key: Key; art: MayhemPresetArt; strength: number; base: VersusMode; simultaneousShots: boolean }[];

/** Applying a regular Mayhem preset also replaces a previous recommendation's round and flight settings. */
export function mayhemPresetRules(preset: (typeof MAYHEM_PRESETS)[number]): RoomRules {
  return mayhemRules({ ...defaultRoomRules(), mayhem: preset.strength, simultaneousShots: preset.simultaneousShots }, preset.base);
}

export function matchingMayhemPreset(settings: { mayhem: number; mayhemBase: VersusMode; simultaneousShots: boolean }): (typeof MAYHEM_PRESETS)[number] | undefined {
  return MAYHEM_PRESETS.find((preset) => settings.mayhem === preset.strength
    && settings.mayhemBase === preset.base
    && (preset.base === 'horizon' || settings.simultaneousShots === preset.simultaneousShots));
}


export type PickMode = VersusMode | 'mayhem';
export const HANDPICKED_IDS = ['express', 'ghost', 'garden', 'supernova'] as const;
export type HandpickedId = (typeof HANDPICKED_IDS)[number];
export interface HandpickedPreset {
  id: HandpickedId;
  mode: PickMode;
  base: VersusMode;
  rules: RoomRules;
}

/** Four authored combinations per mode; Mayhem only uses settings its round engine preserves. */
export function handpickedPresets(mode: PickMode): HandpickedPreset[] {
  const base = defaultRoomRules();
  const make = (id: HandpickedId, patch: Partial<RoomRules>, gameMode: VersusMode = mode === 'mayhem' ? 'classic' : mode): HandpickedPreset => ({
    id, mode, base: gameMode,
    rules: mode === 'mayhem' ? mayhemRules({ ...base, ...patch }, gameMode) : { ...defaultRoomRules(), ...patch, mayhem: 0 },
  });
  if (mode === 'mayhem') return [
    make('express', { rounds: 3, shotTime: 10, mayhem: 1, simultaneousShots: true }),
    make('ghost', { rounds: 3, shotTime: 30, mayhem: 2 }, 'horizon'),
    make('garden', { rounds: 7, shotTime: 30, mayhem: 2 }),
    make('supernova', { rounds: 7, shotTime: 10, mayhem: 3 }, 'horizon'),
  ];
  return [
    make('express', { rounds: 3, shotTime: 10, maxPlanets: 2, ...(mode === 'classic' ? { simultaneousShots: true } : { fixedPower: true, fixedPowerLevel: 50 }) }),
    make('ghost', { rounds: 5, shotTime: 30, maxPlanets: mode === 'classic' ? 3 : 4, hiddenAim: true, fadingTrails: 2 }),
    make('garden', { rounds: 7, shotTime: 30, maxPlanets: 6, maxPower: 60, bounce: true, styleBonuses: true, powerUps: true, powerUpAmount: 2, powerUpKinds: ['preview', 'teleport', 'shield'] }),
    make('supernova', { rounds: 5, shotTime: 10, maxPlanets: 8, bounce: true, styleBonuses: true, simultaneousShots: mode === 'classic', powerUps: true, powerUpAmount: 4 }),
  ];
}

let cachedPickDay = '';
let cachedPickIndex = 0;

/** Stable per day/device, distinct across modes, with no consecutive repeats within a mode. */
export function pickOfTheDay(mode: PickMode, day: string): HandpickedPreset {
  if (day !== cachedPickDay) {
    const [year, month, date] = day.split('-').map(Number);
    const days = Math.abs(Math.floor(Date.UTC(year, month - 1, date) / 86_400_000));
    let seed = 0x51a95;
    let index = 0;
    for (let i = 0; i < days; i++) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      // Move by one, two or three: today's combination cannot equal yesterday's.
      index = (index + 1 + (seed >>> 0) % (HANDPICKED_IDS.length - 1)) % HANDPICKED_IDS.length;
    }
    cachedPickDay = day;
    cachedPickIndex = index;
  }
  // Distinct offsets keep all three modes on different authored combinations each day.
  const modeOffset = { classic: 0, horizon: 1, mayhem: 2 }[mode];
  return handpickedPresets(mode)[(cachedPickIndex + modeOffset) % HANDPICKED_IDS.length];
}

export function matchingHandpicked(rules: RoomRules, mode: PickMode, base: VersusMode = mode === 'horizon' ? 'horizon' : 'classic'): HandpickedPreset | undefined {
  return handpickedPresets(mode).find((pick) => {
    if (mode === 'mayhem' && base !== pick.base) return false;
    return rulesFor(pick.base, false, mode === 'mayhem').every(({ key, when, inactive }) => {
      const expected = pick.rules;
      if (mode !== 'mayhem' && rules.powerUps !== expected.powerUps) return false;
      if (key === 'powerUpKinds' && !rules.powerUps && !expected.powerUps) return true;
      if (when && !when(rules) && !when(expected)) return true;
      if (inactive?.(rules) && inactive(expected)) return true;
      const a = rules[key], b = expected[key];
      return Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((value) => b.includes(value)) : a === b;
    });
  });
}
