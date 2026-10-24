import type { VersusMode } from '../game';
import { defaultRoomRules } from '../lobbyPrefs';
import type { Key } from '../i18n';
import type { RoomRules } from '../net';
import { powerModeOf, rulesFor, type RuleRow } from './rules';

/** The chaos strength the Mayhem preset starts at in all three modes: Wild. */
export const MAYHEM_PRESET_LEVEL = 2;

type PresetRuleFactory = (base: RoomRules) => RoomRules;
/** Each game mode owns its regular preset group, even when two groups currently share entries. */
const PRESET_GROUPS = {
  classic: {
    standard: (base) => base,
    simultaneous: (base) => ({ ...base, simultaneousShots: true }),
    mayhem: (base) => ({ ...base, mayhem: MAYHEM_PRESET_LEVEL, styleBonuses: true, simultaneousShots: true }),
  },
  // Every Solar System preset fires simultaneously, so it has no separate "All at once" card.
  solar: {
    standard: (base) => ({ ...base, simultaneousShots: true }),
    powerups: (base) => ({ ...base, simultaneousShots: true, powerUps: true, powerUpAmount: 3 }),
    mayhem: (base) => ({ ...base, mayhem: MAYHEM_PRESET_LEVEL, styleBonuses: true, simultaneousShots: true }),
  },
  horizon: {
    standard: (base) => base,
    trickshot: (base) => ({ ...base, maxPower: 60, bounce: true, styleBonuses: true }),
    mayhem: (base) => ({ ...base, mayhem: MAYHEM_PRESET_LEVEL, styleBonuses: true }),
  },
} satisfies Record<VersusMode, Record<string, PresetRuleFactory>>;

export type MatchPreset = { [Mode in VersusMode]: keyof typeof PRESET_GROUPS[Mode] }[VersusMode];

/** The three modes have separate preset groups. Only Classic's Standard fires one ship at a time. */
export function presetsForMode(mode: VersusMode): readonly MatchPreset[] {
  return Object.keys(PRESET_GROUPS[mode]) as MatchPreset[];
}

/** The hint's text key: Classic Standard is the one preset where the ships take turns, and says so. */
export const presetHintKey = (preset: MatchPreset, mode: VersusMode): Key =>
  (mode === 'classic' && preset === 'standard' ? 'preset.standard.classic.hint' : `preset.${preset}.hint`) as Key;

export function presetRules(preset: MatchPreset, mode?: VersusMode): RoomRules {
  const findFactory = (group: Record<string, PresetRuleFactory>): PresetRuleFactory | undefined => group[preset];
  const factory = mode
    ? findFactory(PRESET_GROUPS[mode])
    : Object.values(PRESET_GROUPS).map(findFactory).find((candidate) => candidate !== undefined);
  if (!factory) throw new Error(`Preset "${preset}" is not defined${mode ? ` for ${mode}` : ''}`);
  return factory(defaultRoomRules());
}

/** Whether a set of rules plays as the expected ones in a mode: rules the mode doesn't have, and rows that are out of play in both, don't count. */
function sameRules(rules: RoomRules, expected: RoomRules, mode: VersusMode, anyMayhemLevel = false): boolean {
  if (rules.powerUps !== expected.powerUps) return false;
  return rulesFor(mode).every(({ key, when, inactive }) => {
    if (key === 'powerUpKinds' && !rules.powerUps && !expected.powerUps) return true;
    if (when && !when(rules) && !when(expected)) return true;
    if (inactive?.(rules) && inactive(expected)) return true;
    const a = rules[key], b = expected[key];
    if (key === 'mayhem' && anyMayhemLevel) return (a as number) > 0 === (b as number) > 0;
    return Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((value) => b.includes(value)) : a === b;
  });
}

/** Match the actual rules, including manual edits, rather than remembering a potentially stale label. Mayhem stays itself at any strength. */
export function matchingPreset(rules: RoomRules, mode: VersusMode): MatchPreset | undefined {
  return presetsForMode(mode).find((preset) => sameRules(rules, presetRules(preset, mode), mode, true));
}

/** The rule rows whose value differs, ignoring conditional values that are inactive on both sides. */
export function changedRules(rules: RoomRules, baseline: RoomRules, mode: VersusMode, online = false): RuleRow[] {
  const changed: RuleRow[] = [];
  for (const row of rulesFor(mode, online)) {
    if (row.key === 'fixedPower') {
      // A different cap or fixed level counts under the rows of its own, below.
      if (powerModeOf(rules) !== powerModeOf(baseline) || (powerModeOf(rules) === 'cap' && rules.maxPower !== baseline.maxPower) || (powerModeOf(rules) === 'fixed' && rules.fixedPowerLevel !== baseline.fixedPowerLevel)) changed.push(row);
      continue;
    }
    if (row.key === 'maxPower' || row.key === 'fixedPowerLevel') continue;
    // The table's own switches, one click away in the room: a different pick, not a change to the preset.
    if (row.key === 'betting' || row.key === 'chatPlayersOnly') continue;
    if (row.when && !row.when(rules) && !row.when(baseline)) continue;
    if (row.inactive && row.inactive(rules) && row.inactive(baseline)) continue;

    const value = (source: RoomRules): unknown => row.key === 'powerUpKinds'
      ? source.powerUps ? source.powerUpKinds : []
      : source[row.key];
    const current = value(rules);
    const original = value(baseline);
    const equal = Array.isArray(current) && Array.isArray(original)
      ? current.length === original.length && current.every((item) => original.includes(item))
      : current === original;
    if (!equal) changed.push(row);
  }
  return changed;
}

/** Count differing rule rows. */
export const presetChangeCount = (rules: RoomRules, baseline: RoomRules, mode: VersusMode, online = false): number => changedRules(rules, baseline, mode, online).length;

export const HANDPICKED_IDS = ['express', 'ghost', 'garden', 'supernova'] as const;
export type HandpickedId = (typeof HANDPICKED_IDS)[number];
export interface HandpickedPreset {
  id: HandpickedId;
  /** Which set of texts describes it: the mode's own, or Mayhem's. */
  mode: Exclude<VersusMode, 'solar'> | 'mayhem';
  /** The mode it is played in. */
  base: VersusMode;
  rules: RoomRules;
}

/** The authored Mayhem combinations: each is played in one mode, and joins that mode's rotation. The Solar System plays Classic's. */
const MAYHEM_PICKS: readonly { id: HandpickedId; base: VersusMode; patch: Partial<RoomRules> }[] = [
  { id: 'express', base: 'classic', patch: { rounds: 3, shotTime: 10, mayhem: 1 } },
  { id: 'ghost', base: 'horizon', patch: { rounds: 3, shotTime: 30, mayhem: 2 } },
  { id: 'garden', base: 'classic', patch: { rounds: 7, shotTime: 30, mayhem: 2 } },
  { id: 'supernova', base: 'horizon', patch: { rounds: 7, shotTime: 10, mayhem: 3 } },
];

/** Four authored combinations per mode, then the Mayhem ones played in it. Classic and the Solar System play all of them with simultaneous shots; Event Horizon always does. */
export function handpickedPresets(mode: VersusMode): HandpickedPreset[] {
  // The Solar System has Classic's rules, so Classic's texts and combinations describe it.
  const classic = mode !== 'horizon';
  const make = (id: HandpickedId, patch: Partial<RoomRules>): HandpickedPreset => ({ id, mode: classic ? 'classic' : mode, base: mode, rules: { ...defaultRoomRules(), ...patch, mayhem: 0, simultaneousShots: classic } });
  return [
    make('express', { rounds: 3, shotTime: 10, maxPlanets: 2, ...(classic ? {} : { fixedPower: true, fixedPowerLevel: 50 }) }),
    make('ghost', { rounds: 5, shotTime: 30, maxPlanets: classic ? 3 : 4, hiddenAim: true, fadingTrails: 2 }),
    make('garden', { rounds: 7, shotTime: 30, maxPlanets: 6, maxPower: 60, bounce: true, styleBonuses: true, powerUps: true, powerUpAmount: 2, powerUpKinds: ['preview', 'teleport', 'shield'] }),
    make('supernova', { rounds: 5, shotTime: 10, maxPlanets: 8, bounce: true, styleBonuses: true, powerUps: true, powerUpAmount: 4 }),
    ...MAYHEM_PICKS.filter((pick) => pick.base === (classic ? 'classic' : 'horizon')).map(({ id, patch }): HandpickedPreset => ({
      id, mode: 'mayhem', base: mode, rules: { ...defaultRoomRules(), ...patch, styleBonuses: true, simultaneousShots: classic },
    })),
  ];
}

/** Whether two handpicked combinations are the same one (a mode's own and its Mayhem one may share a name). */
export const samePick = (a: HandpickedPreset | undefined, b: HandpickedPreset): boolean => !!a && a.id === b.id && a.mode === b.mode;

let cachedPickDay = '';
let cachedPickLength = 0;
let cachedPickIndex = 0;

/** Stable per day/device, distinct across modes, with no consecutive repeats within a mode. */
export function pickOfTheDay(mode: VersusMode, day: string): HandpickedPreset {
  const picks = handpickedPresets(mode);
  if (day !== cachedPickDay || picks.length !== cachedPickLength) {
    const [year, month, date] = day.split('-').map(Number);
    const days = Math.abs(Math.floor(Date.UTC(year, month - 1, date) / 86_400_000));
    let seed = 0x51a95;
    let index = 0;
    for (let i = 0; i < days; i++) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      // Move on by at least one: today's combination cannot equal yesterday's.
      index = (index + 1 + (seed >>> 0) % (picks.length - 1)) % picks.length;
    }
    cachedPickDay = day;
    cachedPickLength = picks.length;
    cachedPickIndex = index;
  }
  // Distinct offsets keep the modes on different authored combinations each day.
  const modeOffset = { classic: 0, horizon: 1, solar: 2 }[mode];
  return picks[(cachedPickIndex + modeOffset) % picks.length];
}

export function matchingHandpicked(rules: RoomRules, mode: VersusMode): HandpickedPreset | undefined {
  return handpickedPresets(mode).find((pick) => sameRules(rules, pick.rules, mode));
}
