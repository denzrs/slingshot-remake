/**
 * What a CPU says about how a shot went: a taunt for a near miss, a kill, its own death or an own goal.
 * Each level has its own voice (Kepler cheery, Newton a sore loser, Einstein smug, Hawking dry), with the
 * odd line from the namesake themselves. The lines live in the language files as `banter.<level>.<kind>.<n>`.
 */
import type { CpuLevel } from '../sim/ai';
import type { Rng } from '../sim/rng';
import { t, type Key } from '../platform/i18n';

export type BanterKind = 'nearMiss' | 'kill' | 'died' | 'ownGoal';

/** Something a CPU might remark on: `player` is the CPU, `other` the enemy it concerns (null for an own goal). */
export interface BanterCue {
  kind: BanterKind;
  player: number;
  other: number | null;
}

/** A shot that passes an enemy hull this close (px from its edge) is a near miss worth a remark. */
export const NEAR_MISS_GAP = 45;

/** Lines each level has for each kind of cue. */
export const BANTER_LINES = 5;

/** How likely a CPU is to say something about a cue: an own goal is always worth a word, a near miss only often. */
const CHANCE: Readonly<Record<BanterKind, number>> = { nearMiss: 0.55, kill: 0.6, died: 0.6, ownGoal: 1 };

/** Quiet time after anybody spoke, and after the same CPU did (ms): a chat full of robots helps nobody. */
const ANYONE_COOLDOWN = 4000;
const SPEAKER_COOLDOWN = 15000;

export class Banter {
  private lastAny = -Infinity;
  private readonly lastBy = new Map<number, number>();
  private readonly lastLine = new Map<string, number>();

  constructor(private readonly rng: Rng = Math.random) {}

  /** The line the CPU says for this cue at time `now` (ms), or null when it keeps quiet. */
  line(level: CpuLevel, cue: BanterCue, name: string, now: number): string | null {
    if (now - this.lastAny < ANYONE_COOLDOWN) return null;
    if (now - (this.lastBy.get(cue.player) ?? -Infinity) < SPEAKER_COOLDOWN) return null;
    if (this.rng() >= CHANCE[cue.kind]) return null;
    // Never the line it said last time, for the same kind of remark.
    const pool = `${level}.${cue.kind}`;
    const previous = this.lastLine.get(pool);
    let n = Math.floor(this.rng() * BANTER_LINES);
    if (n === previous) n = (n + 1) % BANTER_LINES;
    this.lastLine.set(pool, n);
    this.lastAny = now;
    this.lastBy.set(cue.player, now);
    return t(`banter.${pool}.${n}` as Key, { name });
  }
}
