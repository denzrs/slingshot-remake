import { AIM } from './config';
import { normalizeAngle, simulateShot, simulateStyledShot, type ShotRules, type StyledShotOutcome, type World } from './physics';
import { gaussian, type Rng } from './rng';

export type NormalCpuLevel = 'easy' | 'medium' | 'hard' | 'hawking';
export type NamedExperimentalCpuLevel = 'experimental-easy' | 'experimental-medium' | 'experimental-hard';
export type ExperimentalCpuLevel = 'experimental' | NamedExperimentalCpuLevel;
export type CpuLevel = NormalCpuLevel | ExperimentalCpuLevel;

export interface ExperimentalCpuConfig {
  learningRate: number;
  startingKnowledge: number;
}

export const EXPERIMENTAL_PRESETS: Readonly<Record<NamedExperimentalCpuLevel, Readonly<ExperimentalCpuConfig>>> = {
  'experimental-easy': { learningRate: 0.45, startingKnowledge: 0.5 },
  'experimental-medium': { learningRate: 0.54, startingKnowledge: 0.72 },
  'experimental-hard': { learningRate: 0.72, startingKnowledge: 0.9 },
};

export function isExperimentalCpu(level: CpuLevel | null): level is ExperimentalCpuLevel {
  return level === 'experimental' || level === 'experimental-easy' || level === 'experimental-medium' || level === 'experimental-hard';
}

export interface Aim {
  angle: number;
  power: number;
}

/** Aim error (1σ) on the first shot of a round and how fast it shrinks with every further shot. */
const ERROR: Record<Exclude<NormalCpuLevel, 'hawking'>, { angle: number; power: number; decay: number }> = {
  easy: { angle: 4, power: 4, decay: 0.8 },
  medium: { angle: 1.6, power: 1.6, decay: 0.65 },
  hard: { angle: 0.5, power: 0.5, decay: 0.45 },
};

export interface PlanOptions {
  rules: ShotRules;
  level: NormalCpuLevel;
  /** Shots the CPU already fired this round — it "learns" and aims tighter each time. */
  attempt: number;
  /** When set, only the angle is searched. */
  fixedPower: number | null;
  rng: Rng;
  /** Scales the search size (1 = full); lower it when several CPUs plan at once. */
  effort?: number;
  /** Seconds of flight the planner looks ahead (default 12; Hawking always uses the full shot limit). */
  lookahead?: number;
  friends?: readonly number[];
  /** Keep refining a valid hit to find the lowest hit power. */
  optimizeHitPower?: boolean;
  /** Return the searched aim without execution error (experimental belief planning). */
  noiseFree?: boolean;
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
  const hawking = opts.level === 'hawking';
  // Ordinary CPUs retain their cheap horizon; Hawking searches full-length trick shots.
  const planRules: ShotRules = { ...rules, timeLimit: hawking ? rules.timeLimit : Math.min(rules.timeLimit, opts.lookahead ?? 12) };
  const randomPower = () => fixedPower ?? 15 + rng() * 85;

  type Candidate = Aim & { cost: number; style?: StyledShotOutcome };
  const pool: Candidate[] = [];
  const self = world.ships[shooter];
  const friends = opts.friends ?? [];
  // Belief searches revisit grid centres and clamped powers. Cache exact launches
  // only for this generator; ordinary CPU planning retains its existing path.
  const costs = opts.noiseFree ? new Map<number, Map<number, number>>() : null;
  const evaluateAim = (aim: Aim): number => {
    if (!costs) return evaluate(world, shooter, aim, planRules, friends);
    let powers = costs.get(aim.angle);
    const cached = powers?.get(aim.power);
    if (cached !== undefined) return cached;
    const cost = evaluate(world, shooter, aim, planRules, friends);
    if (!powers) costs.set(aim.angle, powers = new Map());
    powers.set(aim.power, cost);
    return cost;
  };
  function* candidate(aim: Aim): Generator<void, Candidate> {
    if (!hawking) return { ...aim, cost: evaluateAim(aim) };
    const style = yield* simulateStyledShot(world, shooter, aim.angle, aim.power, planRules, friends);
    const friendlyHit = style.end.kind === 'ship' && (style.end.ship === shooter || friends.includes(style.end.ship));
    const risk = style.selfClosest < SELF_MARGIN ? (SELF_MARGIN - style.selfClosest) * 20 : 0;
    const cost = friendlyHit ? 1e6 : style.end.kind === 'ship' ? -1 + aim.power / 1000 + risk : style.closest + risk;
    return { ...aim, cost, style };
  }
  const compare = (a: Candidate, b: Candidate): number => {
    if (!hawking) return a.cost - b.cost;
    const sa = a.style!;
    const sb = b.style!;
    const safety = (s: StyledShotOutcome): number =>
      s.end.kind === 'ship' && (s.end.ship === shooter || friends.includes(s.end.ship)) ? 2 : s.selfClosest < SELF_MARGIN ? 1 : 0;
    const safetyDifference = safety(sa) - safety(sb);
    if (safetyDifference) return safetyDifference;
    // No amount of style can outweigh safety or an enemy hit.
    if (safety(sa) !== 0 && sa.selfClosest !== sb.selfClosest) return sb.selfClosest - sa.selfClosest;
    const hitDifference = Number(sb.end.kind === 'ship') - Number(sa.end.kind === 'ship');
    if (hitDifference) return hitDifference;
    return sb.swingbys - sa.swingbys || sb.flightTime - sa.flightTime || sb.pathLength - sa.pathLength || a.cost - b.cost;
  };
  const directs = world.ships
    .filter((s, i) => i !== shooter && s.alive && !friends.includes(i))
    .map((t) => normalizeAngle((Math.atan2(-(t.y - self.y), t.x - self.x) * 180) / Math.PI));
  if (directs.length === 0) return { angle: rng() * 360, power: randomPower() };
  const effort = opts.effort ?? 1;
  const samples = Math.round(260 * effort);
  // Precise belief planning gets target-centred seeds rather than depending on
  // random draws landing inside a narrow hit basin. Ordinary levels are unchanged.
  if (opts.noiseFree) {
    for (const direct of directs) {
      for (const power of fixedPower === null ? [30, 50, 70, 90, 100] : [fixedPower]) {
        for (const offset of [-16, -8, -4, 0, 4, 8, 16]) {
          const aim = { angle: normalizeAngle(direct + offset), power };
          pool.push(yield* candidate(aim));
        }
        yield;
      }
    }
  }

  for (let i = 0; i < samples; i++) {
    // Half the samples fan out around the direct line to some enemy, half anywhere.
    const direct = directs[i % directs.length];
    const angle = i % 2 === 0 ? normalizeAngle(direct + gaussian(rng) * 50) : rng() * 360;
    const aim = { angle, power: randomPower() };
    pool.push(yield* candidate(aim));
    // Small slices keep each frame's thinking within budget, even with many ships to check.
    if (i % 4 === 3) yield;
    if (!hawking && !opts.optimizeHitPower && i > samples * 0.4 && pool.filter((c) => c.cost < 0).length >= 3) break;
  }

  pool.sort(compare);
  let best = pool[0];
  for (const seed of pool.slice(0, Math.max(2, Math.round(5 * effort)))) {
    let local = seed;
    let spread = 6;
    for (let i = 0; i < 45 && (hawking || local.cost > -0.5 || (opts.optimizeHitPower && local.cost < 0)); i++) {
      const aim = {
        angle: normalizeAngle(local.angle + gaussian(rng) * spread),
        power: fixedPower ?? clampPower(local.power + gaussian(rng) * spread),
      };
      const proposed = yield* candidate(aim);
      if (compare(proposed, local) < 0) local = proposed;
      else spread = Math.max(0.05, spread * 0.93);
      if (i % 4 === 3) yield;
    }
    if (!hawking && !opts.optimizeHitPower && best.cost < 0) break;
    if (!hawking && opts.optimizeHitPower && fixedPower === null && local.cost < 0) {
      let lower = 5;
      let upper = local.power;
      for (let i = 0; i < 9 && upper - lower > 0.1; i++) {
        const power = (lower + upper) / 2;
        const cost = evaluateAim({ angle: local.angle, power });
        if (cost < 0) {
          local = { ...local, power, cost };
          upper = power;
        } else {
          lower = power;
        }
        if (i % 4 === 3) yield;
      }
    }
    if ((opts.noiseFree || hawking) && compare(local, best) < 0) best = local;
    if (opts.noiseFree) {
      for (const step of [2, 0.5, 0.12, 0.03]) {
        for (let pass = 0; pass < 4; pass++) {
          const center = local;
          for (const da of [-step, 0, step]) {
            for (const dp of fixedPower === null ? [-step * 2, 0, step * 2] : [0]) {
              const aim = { angle: normalizeAngle(center.angle + da), power: fixedPower ?? clampPower(center.power + dp) };
              const proposed = yield* candidate(aim);
              if (compare(proposed, local) < 0) local = proposed;
            }
          }
          yield;
          if (center === local) break;
        }
      }
      if (compare(local, best) < 0) best = local;
    }
  }

  if (opts.noiseFree) return { angle: best.angle, power: fixedPower ?? best.power };
  const err = ERROR[opts.level === 'hawking' ? 'hard' : opts.level];
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
