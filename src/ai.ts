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
}

/** Planning cost: 0 or below means a hit, lower power is slightly preferred among hits. */
function evaluate(world: World, shooter: number, aim: Aim, rules: ShotRules): number {
  const { end, closest } = simulateShot(world, shooter, aim.angle, aim.power, rules);
  if (end.kind === 'ship') return end.ship === shooter ? 1e6 : -1 + aim.power / 1000;
  return closest;
}

/**
 * Searches for a shot that hits the opponent: coarse random sweep, then hill-climbing
 * around the best candidates. It's a generator so the game can spread the work over frames.
 */
export function* planShot(world: World, shooter: number, opts: PlanOptions): Generator<void, Aim> {
  const { rng, rules, fixedPower } = opts;
  // Planning with a shorter horizon keeps the search cheap; long orbits rarely make good shots anyway.
  const planRules: ShotRules = { ...rules, timeLimit: Math.min(rules.timeLimit, 12) };
  const randomPower = () => fixedPower ?? 15 + rng() * 85;

  type Candidate = Aim & { cost: number };
  const pool: Candidate[] = [];
  let target = world.ships[shooter === 0 ? 1 : 0];
  let targetDistance = Infinity;
  for (let i = 0; i < world.ships.length; i++) {
    if (i === shooter) continue;
    const dx = world.ships[i].x - world.ships[shooter].x;
    const dy = world.ships[i].y - world.ships[shooter].y;
    const distance = dx * dx + dy * dy;
    if (distance < targetDistance) {
      targetDistance = distance;
      target = world.ships[i];
    }
  }
  const self = world.ships[shooter];
  const direct = normalizeAngle((Math.atan2(-(target.y - self.y), target.x - self.x) * 180) / Math.PI);

  for (let i = 0; i < 260; i++) {
    // Half the samples fan out around the direct line, half anywhere.
    const angle = i % 2 === 0 ? normalizeAngle(direct + gaussian(rng) * 50) : rng() * 360;
    const aim = { angle, power: randomPower() };
    pool.push({ ...aim, cost: evaluate(world, shooter, aim, planRules) });
    if (i % 12 === 11) yield;
  }

  pool.sort((a, b) => a.cost - b.cost);
  let best = pool[0];
  for (const seed of pool.slice(0, 5)) {
    let local = seed;
    let spread = 6;
    for (let i = 0; i < 45 && local.cost > -0.5; i++) {
      const aim = {
        angle: normalizeAngle(local.angle + gaussian(rng) * spread),
        power: fixedPower ?? clampPower(local.power + gaussian(rng) * spread),
      };
      const cost = evaluate(world, shooter, aim, planRules);
      if (cost < local.cost) local = { ...aim, cost };
      else spread = Math.max(0.05, spread * 0.93);
      if (i % 12 === 11) yield;
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
