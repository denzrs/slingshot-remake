import { AIM } from './config';
import { normalizeAngle, simulateShot, type ShotRules, type World } from './physics';
import { gaussian, type Rng } from './rng';

export type CpuLevel = 'easy' | 'medium' | 'hard';

export interface Aim {
  angle: number;
  power: number;
}

/** Aim error (1σ) on the first shot of a round and how fast it shrinks with every further shot. */
const ERROR: Record<CpuLevel, { angle: number; power: number; decay: number }> = {
  easy: { angle: 4, power: 4, decay: 0.8 },
  medium: { angle: 1.6, power: 1.6, decay: 0.65 },
  hard: { angle: 0.5, power: 0.5, decay: 0.45 },
};

export interface PlanOptions {
  rules: ShotRules;
  level: CpuLevel;
  /** Shots the CPU already fired this round — it "learns" and aims tighter each time. */
  attempt: number;
  /** When set, only the angle is searched. */
  fixedPower: number | null;
  rng: Rng;
  /** Scales the search size (1 = full); lower it when several CPUs plan at once. */
  effort?: number;
  /** Seconds of flight the planner looks ahead (default 12). */
  lookahead?: number;
  /** Teammates: never targeted, and the planner keeps its shots away from them. */
  friends?: readonly number[];
}

/** Below this, a shot passing home or a teammate is too close — aim error could turn it into a friendly hit. */
const SELF_MARGIN = 45;

/** Planning cost: 0 or below means a hit, lower power is slightly preferred among hits. */
function evaluate(world: World, shooter: number, aim: Aim, rules: ShotRules, friends: readonly number[]): number {
  const { end, closest, selfClosest } = simulateShot(world, shooter, aim.angle, aim.power, rules, friends);
  if (end.kind === 'ship' && (end.ship === shooter || friends.includes(end.ship))) return 1e6;
  const risk = selfClosest < SELF_MARGIN ? (SELF_MARGIN - selfClosest) * 20 : 0;
  if (end.kind === 'ship') return -1 + aim.power / 1000 + risk;
  return closest + risk;
}

/**
 * Searches for a shot that hits any opponent: coarse random sweep, then hill-climbing
 * around the best candidates. It's a generator so the game can spread the work over frames.
 */
export function* planShot(world: World, shooter: number, opts: PlanOptions): Generator<void, Aim> {
  const { rng, rules, fixedPower } = opts;
  // Planning with a shorter horizon keeps the search cheap; long orbits rarely make good shots anyway.
  const planRules: ShotRules = { ...rules, timeLimit: Math.min(rules.timeLimit, opts.lookahead ?? 12) };
  const randomPower = () => fixedPower ?? 15 + rng() * 85;

  type Candidate = Aim & { cost: number };
  const pool: Candidate[] = [];
  const self = world.ships[shooter];
  const friends = opts.friends ?? [];
  const directs = world.ships
    .filter((s, i) => i !== shooter && s.alive && !friends.includes(i))
    .map((t) => normalizeAngle((Math.atan2(-(t.y - self.y), t.x - self.x) * 180) / Math.PI));
  if (directs.length === 0) return { angle: rng() * 360, power: randomPower() };
  const effort = opts.effort ?? 1;
  const samples = Math.round(260 * effort);

  for (let i = 0; i < samples; i++) {
    // Half the samples fan out around the direct line to some enemy, half anywhere.
    const direct = directs[i % directs.length];
    const angle = i % 2 === 0 ? normalizeAngle(direct + gaussian(rng) * 50) : rng() * 360;
    const aim = { angle, power: randomPower() };
    pool.push({ ...aim, cost: evaluate(world, shooter, aim, planRules, friends) });
    // Small slices keep each frame's thinking within budget, even with many ships to check.
    if (i % 4 === 3) yield;
    // Enough hits found already — no need to keep sweeping.
    if (i > samples * 0.4 && pool.filter((c) => c.cost < 0).length >= 3) break;
  }

  pool.sort((a, b) => a.cost - b.cost);
  let best = pool[0];
  for (const seed of pool.slice(0, Math.max(2, Math.round(5 * effort)))) {
    let local = seed;
    let spread = 6;
    for (let i = 0; i < 45 && local.cost > -0.5; i++) {
      const aim = {
        angle: normalizeAngle(local.angle + gaussian(rng) * spread),
        power: fixedPower ?? clampPower(local.power + gaussian(rng) * spread),
      };
      const cost = evaluate(world, shooter, aim, planRules, friends);
      if (cost < local.cost) local = { ...aim, cost };
      else spread = Math.max(0.05, spread * 0.93);
      if (i % 4 === 3) yield;
    }
    if (local.cost < best.cost) best = local;
    if (best.cost < 0) break;
  }

  const err = ERROR[opts.level];
  const scale = Math.pow(err.decay, opts.attempt);
  return {
    angle: normalizeAngle(best.angle + gaussian(rng) * err.angle * scale),
    power: fixedPower ?? clampPower(best.power + gaussian(rng) * err.power * scale),
  };
}

function clampPower(p: number): number {
  return Math.min(AIM.MAX_POWER, Math.max(5, p));
}

/** Run a planner to completion synchronously (tests, tooling). */
export function planShotNow(world: World, shooter: number, opts: PlanOptions): Aim {
  const it = planShot(world, shooter, opts);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}
