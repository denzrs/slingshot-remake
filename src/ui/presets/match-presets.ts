import { GAME_MODES, type GameMode } from '../../sim/modes';
import { loadCustomPresets, loadOverride, type CustomPreset } from '../../data/customPresets';
import { defaultRoomRules } from '../../data/roomRules';
import type { Key } from '../../platform/i18n';
import type { RoomRules } from '../../net/net';
import type { PowerUpKind } from '../../sim/powerups';
import { powerModeOf, rulesFor, type RuleRow } from '../menu/rules';

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
} satisfies Record<GameMode, Record<string, PresetRuleFactory>>;

export type MatchPreset = { [Mode in GameMode]: keyof typeof PRESET_GROUPS[Mode] }[GameMode];

/** The three modes have separate preset groups. Only Classic's Standard fires one ship at a time. */
export function presetsForMode(mode: GameMode): readonly MatchPreset[] {
  return Object.keys(PRESET_GROUPS[mode]) as MatchPreset[];
}

/** The hint's text key: Classic Standard is the one preset where the ships take turns, and says so. */
export const presetHintKey = (preset: MatchPreset, mode: GameMode): Key =>
  (mode === 'classic' && preset === 'standard' ? 'preset.standard.classic.hint' : `preset.${preset}.hint`);

export function presetRules(preset: MatchPreset, mode: GameMode): RoomRules {
  const factory = (PRESET_GROUPS[mode] as Record<string, PresetRuleFactory>)[preset];
  if (!factory) throw new Error(`Preset "${preset}" is not defined for ${mode}`);
  return factory(defaultRoomRules());
}

/** What the rules page's reset goes back to: a Mayhem game to the Mayhem preset at its strength, any other one to the standard rules. */
export function resetRules(rules: RoomRules, mode: GameMode): { id: 'mayhem' | 'standard'; rules: RoomRules } {
  const { mayhem } = rules;
  return mayhem ? { id: 'mayhem', rules: { ...presetRules('mayhem', mode), mayhem } } : { id: 'standard', rules: defaultRoomRules() };
}

/** What choosing the card gives: the rules the player saved over the preset, else the original ones. */
export function savedPresetRules(preset: MatchPreset, mode: GameMode): RoomRules {
  return loadOverride(mode, preset) ?? presetRules(preset, mode);
}

/** Whether the player has changed a built-in preset and kept it that way. */
export const isOverridden = (preset: MatchPreset, mode: GameMode): boolean => loadOverride(mode, preset) !== null;

/** Whether two lists hold the same items, in any order. */
const sameItems = (a: readonly unknown[], b: readonly unknown[]): boolean => a.length === b.length && a.every((item) => b.includes(item));

/** Whether a set of rules plays as the expected ones in a mode: rules the mode doesn't have, and rows that are out of play in both, don't count. */
function sameRules(rules: RoomRules, expected: RoomRules, mode: GameMode, anyMayhemLevel = false): boolean {
  if (rules.powerUps !== expected.powerUps) return false;
  return rulesFor(mode).every(({ key, when, inactive }) => {
    if (key === 'powerUpKinds' && !rules.powerUps && !expected.powerUps) return true;
    if (when && !when(rules) && !when(expected)) return true;
    if (inactive?.(rules) && inactive(expected)) return true;
    const a = rules[key], b = expected[key];
    if (key === 'mayhem' && anyMayhemLevel) return (a as number) > 0 === (b as number) > 0;
    return Array.isArray(a) && Array.isArray(b) ? sameItems(a, b) : a === b;
  });
}

/** Match the actual rules, including manual edits, rather than remembering a potentially stale label. Mayhem stays itself at any strength. */
export function matchingPreset(rules: RoomRules, mode: GameMode): MatchPreset | undefined {
  return presetsForMode(mode).find((preset) => sameRules(rules, savedPresetRules(preset, mode), mode, true));
}

/** The player's own preset that plays exactly as these rules, if any. */
export function matchingCustom(rules: RoomRules, mode: GameMode): CustomPreset | undefined {
  return loadCustomPresets(mode).find((preset) => sameRules(rules, preset.rules, mode));
}

/** The rule rows whose value differs, ignoring conditional values that are inactive on both sides. */
export function changedRules(rules: RoomRules, baseline: RoomRules, mode: GameMode, online = false): RuleRow[] {
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
    const equal = Array.isArray(current) && Array.isArray(original) ? sameItems(current, original) : current === original;
    if (!equal) changed.push(row);
  }
  return changed;
}

/** Count differing rule rows. */
export const presetChangeCount = (rules: RoomRules, baseline: RoomRules, mode: GameMode, online = false): number => changedRules(rules, baseline, mode, online).length;

export const HANDPICKED_IDS = [
  'pinballRiot', 'blindSonar', 'siegeRun', 'spacetimeRift', 'nebulaLock', 'singlePlanetMayhem',
  'orbitalSniper', 'solarSailer', 'eclipseRicochet', 'totalEclipse', 'cosmicMaelstrom', 'hyperOrbit',
  'escapeVelocity', 'horizonShadow', 'gravityCentrifuge', 'planetEater', 'singularityBlitz', 'deathSpiral',
] as const;
export type HandpickedId = (typeof HANDPICKED_IDS)[number];
export interface HandpickedPreset {
  id: HandpickedId;
  /** The game mode it is played in, whose rules and description it uses. */
  mode: GameMode;
  rules: RoomRules;
}

type HandpickedSpec = { id: HandpickedId; patch: Partial<RoomRules> };
const pickups = (powerUpKinds: PowerUpKind[], powerUpAmount: number): Partial<RoomRules> => ({ powerUps: true, powerUpKinds, powerUpAmount });

/** Each mode has six authored daily combinations; all Classic and Solar picks use simultaneous shots. */
const HANDPICKED: Record<GameMode, readonly HandpickedSpec[]> = {
  classic: [
    { id: 'pinballRiot', patch: { rounds: 3, shotTime: 20, maxPlanets: 2, bounce: true, fixedPower: true, fixedPowerLevel: 95, fadingTrails: 1, ...pickups(['splitter', 'antigravity', 'shield'], 3) } },
    { id: 'blindSonar', patch: { rounds: 5, shotTime: 20, maxPlanets: 4, invisiblePlanets: true, bounce: true, fixedPower: true, fixedPowerLevel: 65, hiddenAim: true, fadingTrails: 2, styleBonuses: true, ...pickups(['splitter', 'piercing'], 2) } },
    { id: 'siegeRun', patch: { rounds: 5, shotTime: 30, maxPlanets: 6, maxPower: 45, hiddenAim: true, neighborGrace: 1, ...pickups(['defense', 'planetkiller', 'piercing', 'shield'], 4) } },
    { id: 'spacetimeRift', patch: { rounds: 5, shotTime: 20, maxPlanets: 3, bounce: true, hiddenAim: true, fadingTrails: 2, ...pickups(['wormhole', 'blackhole', 'teleport', 'splitter'], 4) } },
    { id: 'nebulaLock', patch: { rounds: 5, shotTime: 30, maxPlanets: 5, maxPower: 70, mayhem: 1, ...pickups(['nebula', 'plasma', 'antigravity', 'blackhole'], 4) } },
    { id: 'singlePlanetMayhem', patch: { rounds: 7, shotTime: 20, maxPlanets: 1, fixedPower: true, fixedPowerLevel: 60, hiddenAim: true, neighborGrace: 1, mayhem: 3 } },
  ],
  solar: [
    { id: 'orbitalSniper', patch: { rounds: 5, shotTime: 20, maxPlanets: 4, fixedPower: true, fixedPowerLevel: 55, ...pickups(['defense', 'piercing', 'antigravity'], 3) } },
    { id: 'solarSailer', patch: { rounds: 5, shotTime: 30, maxPlanets: 5, maxPower: 35, ...pickups(['nebula', 'plasma', 'preview'], 3) } },
    { id: 'eclipseRicochet', patch: { rounds: 3, shotTime: 20, maxPlanets: 3, bounce: true, hiddenAim: true, fadingTrails: 1, ...pickups(['splitter', 'wormhole', 'shield'], 3) } },
    { id: 'totalEclipse', patch: { rounds: 5, shotTime: 20, maxPlanets: 7, invisiblePlanets: true, fadingTrails: 4, ...pickups(['planetkiller', 'splitter'], 2) } },
    { id: 'cosmicMaelstrom', patch: { rounds: 5, shotTime: 20, maxPlanets: 4, mayhem: 2, fixedPower: true, fixedPowerLevel: 75, ...pickups(['blackhole', 'teleport', 'antigravity'], 3) } },
    { id: 'hyperOrbit', patch: { rounds: 7, shotTime: 10, maxPlanets: 2, bounce: true, fixedPower: true, fixedPowerLevel: 90, mayhem: 3 } },
  ],
  horizon: [
    { id: 'escapeVelocity', patch: { rounds: 3, shotTime: 30, maxPlanets: 2, maxPower: 40, ...pickups(['antigravity', 'teleport'], 2) } },
    { id: 'horizonShadow', patch: { rounds: 5, shotTime: 20, maxPlanets: 3, hiddenAim: true, fadingTrails: 1, fixedPower: true, fixedPowerLevel: 60, ...pickups(['wormhole', 'shield', 'piercing'], 3) } },
    { id: 'gravityCentrifuge', patch: { rounds: 5, shotTime: 20, maxPlanets: 4, bounce: true, fixedPower: true, fixedPowerLevel: 85, ...pickups(['antigravity', 'nebula', 'plasma', 'splitter'], 4) } },
    { id: 'planetEater', patch: { rounds: 5, shotTime: 20, maxPlanets: 6, maxPower: 65, ...pickups(['defense', 'planetkiller', 'blackhole', 'teleport'], 4) } },
    { id: 'singularityBlitz', patch: { rounds: 3, shotTime: 10, maxPlanets: 1, bounce: true, hiddenAim: true, mayhem: 2, ...pickups(['teleport', 'splitter', 'shield'], 3) } },
    { id: 'deathSpiral', patch: { rounds: 7, shotTime: 20, maxPlanets: 3, maxPower: 50, fadingTrails: 2, mayhem: 3, ...pickups(['blackhole', 'wormhole', 'nebula', 'piercing'], 4) } },
  ],
};

export function handpickedPresets(mode: GameMode): HandpickedPreset[] {
  const defaults = defaultRoomRules();
  return HANDPICKED[mode].map(({ id, patch }) => ({
    id,
    mode,
    rules: {
      ...defaults,
      ...patch,
      powerUpKinds: [...(patch.powerUpKinds ?? defaults.powerUpKinds)],
      simultaneousShots: true,
    },
  }));
}

/** Whether two handpicked combinations are the same authored pick for the same game mode. */
export const samePick = (a: HandpickedPreset | undefined, b: HandpickedPreset): boolean => !!a && a.id === b.id && a.mode === b.mode;

let cachedPickDay = '';
let cachedPickLength = 0;
let cachedPickIndex = 0;

/** Stable per day/device, distinct across modes, with no consecutive repeats within a mode. */
export function pickOfTheDay(mode: GameMode, day: string): HandpickedPreset {
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
  const modeOffset = GAME_MODES.indexOf(mode);
  return picks[(cachedPickIndex + modeOffset) % picks.length];
}

export function matchingHandpicked(rules: RoomRules, mode: GameMode): HandpickedPreset | undefined {
  return handpickedPresets(mode).find((pick) => sameRules(rules, pick.rules, mode));
}
