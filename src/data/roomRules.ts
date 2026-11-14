import { AIM, ANOMALIES, EDGE_MODES, GRACE, MAYHEM, TRAIL_FADE, isEdgeMode, type Anomaly, type EdgeMode } from '../sim/config';
import { CLASSIC_FAMILY, type GameMode } from '../sim/modes';
import { POWER_UP, POWER_UP_KINDS, type PowerUpKind } from '../sim/powerups';

export const KILLCAM_MODES = ['auto', 'off', 'every', 'round'] as const;
export type KillcamMode = (typeof KILLCAM_MODES)[number];
export type KillcamPlayback = Exclude<KillcamMode, 'auto'>;
export const isKillcamMode = (value: unknown): value is KillcamMode => KILLCAM_MODES.some((mode) => mode === value);

export { ANOMALIES, EDGE_MODES, isEdgeMode, type Anomaly, type EdgeMode };

// ————————————————————————————— The table —————————————————————————————

/** An on/off rule. `modes`: the game modes it exists in (every mode when left out). */
export interface FlagRule {
  kind: 'flag';
  default: boolean;
  modes?: readonly GameMode[];
}

/** A rule with one value out of a list. A value that is not in the list is not a legal one: it is refused on the wire. */
export interface ChoiceRule<T> {
  kind: 'choice';
  default: T;
  /** What the rules page offers. */
  options: readonly T[];
  /** A number rule that also takes any whole number in this range, for tools and rooms that set what the page does not offer. */
  accepts?: { min: number; max: number };
  modes?: readonly GameMode[];
}

/** A rule with several values out of a list, each at most once, in the list's order. */
export interface SetRule<T> {
  kind: 'set';
  default: readonly T[];
  options: readonly T[];
  /** The set is never empty. */
  nonEmpty: boolean;
  modes?: readonly GameMode[];
}

export type RuleSpec = FlagRule | ChoiceRule<number | string> | SetRule<string>;

const flag = (value: boolean, modes?: readonly GameMode[]): FlagRule => ({ kind: 'flag', default: value, modes });
const numbers = (value: number, options: readonly number[], accepts?: { min: number; max: number }): ChoiceRule<number> => ({ kind: 'choice', default: value, options, accepts });
const words = <T extends string>(value: T, options: readonly T[]): ChoiceRule<T> => ({ kind: 'choice', default: value, options });
const kinds = <T extends string>(value: readonly T[], options: readonly T[], nonEmpty = false): SetRule<T> => ({ kind: 'set', default: value, options, nonEmpty });

/**
 * The rules of a game, declared once: what a room is set up with, and the match part of the local settings. They are sent over the
 * wire, kept in the browser (settings, presets, the lobby) and shown on the rules page. `RoomRules`, the standard rules, the check of
 * saved rules and the slider stops of the rules page all come from this table, and `npm run protocol` writes the relay's contract from it.
 *
 * To add a rule: an entry here, a row in `ruleRows()` (`ui/menu/rules.ts`), its words in `i18n`, and `npm run protocol`.
 */
export const RULES = {
  /** 0 = endless match. */
  rounds: numbers(5, [0, 1, 3, 5, 7, 10, 15, 20], { min: 0, max: 99 }),
  maxPlanets: numbers(4, [1, 2, 3, 4, 5, 6, 7, 8]),
  invisiblePlanets: flag(false, CLASSIC_FAMILY),
  /** What the edge of the field does to a shot. */
  edges: words<EdgeMode>('void', EDGE_MODES),
  /** Every shot has the same power, `fixedPowerLevel`: only the angle can be aimed. Mutually exclusive with a cap in the menus. */
  fixedPower: flag(false),
  fixedPowerLevel: numbers(AIM.FIXED_POWER, AIM.FIXED_OPTIONS),
  /** Shots can't be fired harder than this: a low cap favours trick shots over power shots. */
  maxPower: numbers(AIM.MAX_POWER, AIM.CAP_OPTIONS),
  /** Seconds before a shot fizzles out. */
  shotTime: numbers(20, [10, 20, 30, 60], { min: 5, max: 120 }),
  /** Classic only: swing-bys, grazes and the like multiply a hit's points, as they always do in Event Horizon. */
  styleBonuses: flag(false, CLASSIC_FAMILY),
  /** With four or more ships, each one's first this many shots of a round (0 = off) pass through its nearest enemy. */
  neighborGrace: numbers(0, GRACE.OPTIONS),
  /** Classic only: everybody aims, then all shots fly at once — as in Event Horizon — instead of one shot per turn. */
  simultaneousShots: flag(false, CLASSIC_FAMILY),
  /** Automatic: replays after kills in salvos, off for sequential shots. */
  killcam: words<KillcamMode>('auto', KILLCAM_MODES),
  /** Other players' aim arrows, angles and ship headings stay hidden: you only see your own aim. */
  hiddenAim: flag(false),
  /** Seconds a finished shot's flight path stays on the board before it has faded away; 0 = it stays. */
  fadingTrails: numbers(0, TRAIL_FADE.OPTIONS),
  /** Classic and Solar System: a round that drags on ends in sudden death (enemy ships pull shots in; the sun goes red giant, then supernova). */
  suddenDeath: flag(true, CLASSIC_FAMILY),
  /** Mayhem: every round has twists of its own, laid over these rules. 0 = off, otherwise the chaos strength (1 mild, 2 wild, 3 insane). */
  mayhem: numbers(0, MAYHEM.LEVELS),
  /** Online: eliminated players may bet points of the match on who wins the round (a rule of the room). */
  betting: flag(false),
  /** Online: only the people who play may write in the room's chat; spectators read along (a rule of the room). */
  chatPlayersOnly: flag(false),
  /** Pickups float on the field, and a shot that flies past one takes it (preview, teleport or splitter). */
  powerUps: flag(false),
  /** Power-ups: the kinds that may turn up (never empty), and how many pickups lie on the field at once. */
  powerUpKinds: kinds<PowerUpKind>(POWER_UP_KINDS, POWER_UP_KINDS, true),
  powerUpAmount: numbers(POWER_UP.DEFAULT_AMOUNT, POWER_UP.AMOUNTS),
  /** The anomalies the match plays by, in their usual order: any of them, all of them or none. */
  anomalies: kinds<Anomaly>([], ANOMALIES),
} satisfies Record<string, RuleSpec>;

type ValueOf<S> = S extends FlagRule ? boolean : S extends ChoiceRule<infer T> ? T : S extends SetRule<infer T> ? T[] : never;

/** What a room is set up with, and the match part of the local settings: one value for every rule of the table. */
export type RoomRules = { -readonly [K in keyof typeof RULES]: ValueOf<(typeof RULES)[K]> };

/** Every rule, in the order they are kept in. */
export const RULE_KEYS = Object.keys(RULES) as (keyof RoomRules)[];

const specOf = (key: keyof RoomRules): RuleSpec => RULES[key];

/** The standard rules: what a game starts with until somebody changes them. */
export const DEFAULT_ROOM_RULES: Readonly<RoomRules> = Object.fromEntries(RULE_KEYS.map((key) => {
  const spec = specOf(key);
  return [key, spec.kind === 'set' ? [...spec.default] : spec.default];
})) as unknown as RoomRules;

/** The rules out of anything that has them, such as a set of settings: a copy that shares nothing with it. */
export function rulesOf(source: RoomRules): RoomRules {
  const rules: Record<string, unknown> = {};
  for (const key of RULE_KEYS) rules[key] = Array.isArray(source[key]) ? [...(source[key] as unknown[])] : source[key];
  return rules as unknown as RoomRules;
}

/**
 * The rules a new room starts with: the standard ones. Online play keeps its own state — whatever
 * a player has set up for offline games stays out of it, and the other way round.
 */
export const defaultRoomRules = (): RoomRules => rulesOf(DEFAULT_ROOM_RULES);

/** A saved set of values for a rule with several: only legal ones, each once, in the usual order; null when it is not a list or may not be empty. */
function setFrom(spec: SetRule<string>, value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const chosen = spec.options.filter((option) => value.includes(option));
  return chosen.length || !spec.nonEmpty ? chosen : null;
}

/** A saved list of anomalies: only known ones, each once, in the usual order. Anything else is none. */
export function anomaliesFrom(value: unknown): Anomaly[] {
  return Array.isArray(value) ? ANOMALIES.filter((anomaly) => value.includes(anomaly)) : [];
}

/** Whether a value is a legal one for the rule: what the relay accepts. */
export function isLegal(spec: RuleSpec, value: unknown): boolean {
  switch (spec.kind) {
    case 'flag':
      return typeof value === 'boolean';
    case 'choice':
      return spec.options.some((option) => option === value) || (!!spec.accepts && Number.isInteger(value) && (value as number) >= spec.accepts.min && (value as number) <= spec.accepts.max);
    case 'set':
      return Array.isArray(value) && new Set(value).size === value.length && value.every((v) => spec.options.includes(v)) && (!spec.nonEmpty || value.length > 0);
  }
}

/** Saved rules made safe to play: what is missing or no longer offered falls back to the standard rules. */
export function roomRulesFrom(saved: Partial<RoomRules> | undefined): RoomRules {
  // Rules saved before they changed shape: the loop's yes/no for reflective edges, and neighbour grace as an on/off switch meaning two shots.
  const old = (saved ?? {}) as Record<string, unknown>;
  const source: Record<string, unknown> = { ...old };
  if (!isEdgeMode(old.edges) && old.bounce === true) source.edges = 'wall';
  if (old.neighborGrace === true) source.neighborGrace = 2;
  const rules: Record<string, unknown> = {};
  for (const key of RULE_KEYS) {
    const spec = specOf(key);
    const value = source[key];
    if (spec.kind === 'set') rules[key] = setFrom(spec, value) ?? [...spec.default];
    else rules[key] = isLegal(spec, value) ? value : spec.default;
  }
  return rules as unknown as RoomRules;
}
