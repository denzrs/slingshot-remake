import { MAYHEM } from './config';
import { t, type Key } from './i18n';
import { POWER_UP_KINDS, type PowerUpKind } from './powerups';
import { createRng, intRange, pick, shuffle, type Rng } from './rng';
import type { Settings } from './settings';

/**
 * Mayhem: each round plays by its own twists, drawn from a deck. A twist is a named bundle of the rules the
 * game has anyway (reflecting edges, hidden planets, a power cap, themed power-ups …) laid over the rules the
 * room was set up with, and gone again when the round is over. Everything here is pure, so the match can call
 * it from its own rng and the tests can call it directly.
 */

export type TwistId =
  | 'billiard'
  | 'blind'
  | 'memory'
  | 'precision'
  | 'shortBreath'
  | 'crowded'
  | 'void'
  | 'pickupRain'
  | 'heavyweights'
  | 'gravityParty'
  | 'fortress'
  | 'teleportChaos';

/** The rules a twist may change. */
export type TwistRules = Pick<
  Settings,
  'maxPlanets' | 'bounce' | 'invisiblePlanets' | 'fixedPower' | 'fixedPowerLevel' | 'maxPower' | 'hiddenAim' | 'fadingTrails' | 'powerUps' | 'powerUpKinds' | 'powerUpAmount'
>;

const TWIST_RULE_KEYS: readonly (keyof TwistRules)[] = ['maxPlanets', 'bounce', 'invisiblePlanets', 'fixedPower', 'fixedPowerLevel', 'maxPower', 'hiddenAim', 'fadingTrails', 'powerUps', 'powerUpKinds', 'powerUpAmount'];

/** What a twist takes hold of: two twists that share a slot never come together in one round. */
type Slot = 'planets' | 'bounce' | 'power' | 'sight' | 'pickups';

interface TwistDef {
  slots: readonly Slot[];
  /** Only meaningful in Classic (Event Horizon always shows its planets and scores trick shots anyway). */
  classicOnly?: boolean;
  /** Left out of mild rounds: it takes away something the ships rely on. */
  harsh?: boolean;
  /** A number the twist rolls anew every time (a power, a planet count) — the same one it is applied and announced with. */
  roll?: (rng: Rng) => number;
  apply: (n: number) => Partial<TwistRules>;
}

const pickups = (kinds: readonly PowerUpKind[], amount: number): Partial<TwistRules> => ({ powerUps: true, powerUpKinds: [...kinds], powerUpAmount: amount });

const TWISTS: Record<TwistId, TwistDef> = {
  billiard: { slots: ['bounce', 'planets'], roll: (rng) => intRange(rng, 2, 3), apply: (n) => ({ bounce: true, maxPlanets: n }) },
  blind: { slots: ['sight'], classicOnly: true, harsh: true, apply: () => ({ invisiblePlanets: true }) },
  memory: { slots: ['sight'], harsh: true, apply: () => ({ hiddenAim: true, fadingTrails: 1 }) },
  precision: { slots: ['power'], harsh: true, roll: (rng) => 35 + 5 * intRange(rng, 0, 9), apply: (n) => ({ fixedPower: true, fixedPowerLevel: n, maxPower: 100 }) },
  shortBreath: { slots: ['power'], roll: (rng) => pick(rng, [30, 40, 50]), apply: (n) => ({ fixedPower: false, maxPower: n }) },
  crowded: { slots: ['planets'], apply: () => ({ maxPlanets: 8 }) },
  void: { slots: ['planets'], apply: () => ({ maxPlanets: 1 }) },
  pickupRain: { slots: ['pickups'], apply: () => pickups(POWER_UP_KINDS, 4) },
  heavyweights: { slots: ['pickups'], apply: () => pickups(['heavy', 'piercing'], 3) },
  gravityParty: { slots: ['pickups'], apply: () => pickups(['blackhole', 'polarity', 'planetkiller', 'nebula', 'wormhole'], 3) },
  fortress: { slots: ['pickups'], apply: () => pickups(['shield', 'defense'], 3) },
  teleportChaos: { slots: ['pickups'], apply: () => pickups(['teleport', 'wormhole', 'splitter'], 3) },
};

export const TWIST_IDS = Object.keys(TWISTS) as TwistId[];

/** One twist of a round, with the number it rolled (if it rolls one). */
export interface RoundTwist {
  id: TwistId;
  n?: number;
}

/** How a round plays: its twists (none = a quiet round), whether it is the last of the match, and whether its points count double. */
export interface MayhemRound {
  twists: RoundTwist[];
  finale: boolean;
  jackpot: boolean;
}

/** The rules of a round: the room's rules with the round's twists laid over them. */
export function applyTwists<S extends TwistRules>(base: S, round: { twists: readonly RoundTwist[] }): S {
  let rules: S = base;
  for (const { id, n } of round.twists) rules = { ...rules, ...TWISTS[id].apply(n ?? 0) };
  return rules;
}

const differs = (a: TwistRules, b: TwistRules): boolean => TWIST_RULE_KEYS.some((key) => JSON.stringify(a[key]) !== JSON.stringify(b[key]));

/** A twist's name in the language of the UI. */
export const twistName = (twist: RoundTwist): string => t(`mayhem.twist.${twist.id}` as Key);

/** What a round was about, in a line: its twists, and the finale or jackpot it was. */
export function roundTitle(round: MayhemRound): string {
  const parts = round.twists.map(twistName);
  if (!parts.length) parts.push(t('mayhem.quiet'));
  if (round.finale) parts.unshift(t('mayhem.finale'));
  if (round.jackpot) parts.push(t('mayhem.jackpot', { n: MAYHEM.JACKPOT_FACTOR }));
  return parts.join(' · ');
}

export interface DrawContext {
  /** The rules the room was set up with, `mayhem` among them. */
  base: Settings;
  mode: 'classic' | 'horizon';
  /** The round about to start (1-based), and how many the match has (0 = endless). */
  round: number;
  rounds: number;
}

/**
 * The deck of twists. Every twist comes up once before any comes up twice (a shuffled bag, like the themes
 * of the daily challenge), never the same one in two rounds in a row, and never one that would change nothing
 * because the room already plays that way.
 */
export class MayhemDeck {
  private readonly rng: Rng;
  private bag: TwistId[] = [];
  private previous: TwistId[] = [];

  constructor(seed: number) {
    this.rng = createRng(seed);
  }

  draw({ base, mode, round, rounds }: DrawContext): MayhemRound {
    const level = Math.min(3, Math.max(1, base.mayhem));
    const finale = rounds > 1 && round === rounds;
    // Mild gives a breather now and then; wild and insane add a twist now and then; a finale always stacks.
    const quiet = level === 1 && round > 1 && !finale && this.rng() < MAYHEM.QUIET_CHANCE;
    const wanted = quiet ? 0 : (level === 3 ? 2 : 1) + (level > 1 && this.rng() < MAYHEM.EXTRA_CHANCE ? 1 : 0);
    const count = finale ? Math.max(2, wanted) : wanted;
    const twists: RoundTwist[] = [];
    while (twists.length < count) {
      const next = this.take(base, mode, level, twists);
      if (!next) break;
      twists.push(next);
    }
    this.previous = twists.map((t) => t.id);
    const jackpot = round > 1 && this.rng() < (finale ? MAYHEM.FINALE_JACKPOT_CHANCE : MAYHEM.JACKPOT_CHANCE);
    return { twists, finale, jackpot };
  }

  /** The next twist from the bag that fits the round so far, or null when none does. */
  private take(base: Settings, mode: 'classic' | 'horizon', level: number, chosen: readonly RoundTwist[]): RoundTwist | null {
    // The second pass runs on a refilled bag: whatever the first one left did not fit.
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < this.bag.length; i++) {
        const id = this.bag[i];
        const def = TWISTS[id];
        if (this.previous.includes(id) || (def.classicOnly && mode !== 'classic') || (def.harsh && level === 1)) continue;
        if (chosen.some((c) => TWISTS[c.id].slots.some((slot) => def.slots.includes(slot)))) continue;
        const n = def.roll?.(this.rng);
        const laid = applyTwists(base, { twists: [...chosen, { id, n }] });
        if (!differs(laid, applyTwists(base, { twists: chosen }))) continue;
        this.bag.splice(i, 1);
        return n === undefined ? { id } : { id, n };
      }
      // What the first pass left stays in front; the twists already drawn this cycle go to the back, shuffled.
      if (pass === 0) this.bag = [...this.bag, ...shuffle(this.rng, TWIST_IDS.filter((id) => !this.bag.includes(id)))];
    }
    return null;
  }
}
