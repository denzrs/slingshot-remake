import { AIM } from './config';
import { normalizeAngle, simulateShot, simulateStyledShot, type ShotEnd, type ShotRules, type StyledShotOutcome, type World } from './physics';
import { gaussian, type Rng } from './rng';

type NormalCpuLevel = 'easy' | 'medium' | 'hard' | 'hawking';
type NamedExperimentalCpuLevel = 'experimental-easy' | 'experimental-medium' | 'experimental-hard';
type ExperimentalCpuLevel = 'experimental' | NamedExperimentalCpuLevel;
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

/** How a CPU level aims, learns and picks its victims. */
interface CpuProfile {
  /** Aim error (1σ, in degrees / power units) on the first shot of a round. */
  angle: number;
  power: number;
  /** Every further shot of a round shrinks the aim error by this factor. */
  decay: number;
  /** Below this, a shot passing home or a teammate is too close — aim error could turn it into a friendly hit. */
  selfMargin: number;
  /** How much a hit's power is resented, in cost per unit of power. */
  powerFrugality: number;
  /** Keep refining a hit until its power is as low as the trajectory permits. */
  optimizeHitPower: boolean;
  /** Preference for the nearest enemy: distance in px added to a far enemy's miss cost. */
  distanceBias: number;
  /** Extra pull towards whoever hit this CPU most recently. */
  grudge: number;
}

export const CPU_PROFILES: Readonly<Record<Exclude<NormalCpuLevel, 'hawking'>, Readonly<CpuProfile>>> = {
  // Kepler: lazy and lucky. Goes for whoever is nearest, tolerates risk, learns slowly.
  easy: { angle: 4.5, power: 4.5, decay: 0.8, selfMargin: 20, powerFrugality: 0, optimizeHitPower: false, distanceBias: 0.25, grudge: 0 },
  // Newton: efficient. Wastes no power, keeps a level head.
  medium: { angle: 1.6, power: 1.6, decay: 0.6, selfMargin: 45, powerFrugality: 0.01, optimizeHitPower: true, distanceBias: 0, grudge: 0 },
  // Einstein: careful and precise, with a long memory for being shot at.
  hard: { angle: 0.5, power: 0.5, decay: 0.45, selfMargin: 60, powerFrugality: 0.002, optimizeHitPower: false, distanceBias: 0, grudge: 3 },
};
/** Planner result emitted for each menu CPU launch when AI decision logging is enabled. */
export interface CpuDecision {
  level: NormalCpuLevel;
  attempt: number;
  profile: Readonly<CpuProfile>;
  grudgeTarget: number | null;
  considered: number;
  hitCandidates: number;
  searched: (Aim & { cost: number }) | null;
  launch: Aim;
  predicted: { end: ShotEnd; closest: number; selfClosest: number };
}

type CpuDecisionReporter = (decision: CpuDecision) => void;


export interface PlanOptions {
  rules: ShotRules;
  level: NormalCpuLevel;
  /** Shots the CPU already fired this round — it "learns" and aims tighter each time. */
  attempt: number;
  /** When set, only the angle is searched. */
  fixedPower: number | null;
  /** The highest power the CPU may choose (default: no cap). */
  maxPower?: number;
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
  /** Enemy this CPU would like to see dead: whoever hit it most recently. */
  grudgeTarget?: number | null;
  /** Receives the selected candidate, launch perturbation, and predicted outcome. */
  onDecision?: CpuDecisionReporter;
}

/** Planning cost: 0 or below means a hit, lower power is slightly preferred among hits. */
function evaluate(world: World, shooter: number, aim: Aim, rules: ShotRules, friends: readonly number[], profile: Readonly<CpuProfile>): number {
  const { end, closest, selfClosest } = simulateShot(world, shooter, aim.angle, aim.power, rules, friends);
  if (end.kind === 'ship' && (end.ship === shooter || friends.includes(end.ship))) return 1e6;
  const risk = selfClosest < profile.selfMargin ? (profile.selfMargin - selfClosest) * 20 : 0;
  if (end.kind === 'ship') return -1 + aim.power * (1 / 1000 + profile.powerFrugality) + risk;
  return closest + risk;
}

/**
 * Searches for a shot that hits any opponent: coarse random sweep, then hill-climbing
 * around the best candidates. It's a generator so the game can spread the work over frames.
 */
export function* planShot(world: World, shooter: number, opts: PlanOptions): Generator<void, Aim> {
  const { rng, rules } = opts;
  const maxPower = opts.maxPower ?? AIM.MAX_POWER;
  const fixedPower = opts.fixedPower === null ? null : Math.min(opts.fixedPower, maxPower);
  const hawking = opts.level === 'hawking';
  const profile = CPU_PROFILES[opts.level === 'hawking' ? 'hard' : opts.level];
  const optimizeHitPower = opts.optimizeHitPower ?? profile.optimizeHitPower;
  // Ordinary CPUs retain their cheap horizon; Hawking searches full-length trick shots.
  const planRules: ShotRules = { ...rules, timeLimit: hawking ? rules.timeLimit : Math.min(rules.timeLimit, opts.lookahead ?? 12) };
  const randomPower = () => fixedPower ?? Math.min(maxPower, 15 + rng() * 85);

  type Candidate = Aim & { cost: number; style?: StyledShotOutcome };
  const pool: Candidate[] = [];
  const self = world.ships[shooter];
  function reportDecision(searched: Candidate | null, launch: Aim): void {
    if (!opts.onDecision) return;
    const predicted = simulateShot(world, shooter, launch.angle, launch.power, rules, friends);
    opts.onDecision({
      level: opts.level,
      attempt: opts.attempt,
      profile,
      grudgeTarget,
      considered: pool.length,
      hitCandidates: pool.filter((candidate) => candidate.cost < 0).length,
      searched: searched && { angle: searched.angle, power: searched.power, cost: searched.cost },
      launch,
      predicted,
    });
  }
  const friends = opts.friends ?? [];
  const grudgeTarget = opts.grudgeTarget ?? null;
  // Belief searches revisit grid centres and clamped powers. Cache exact launches
  // only for this generator; ordinary CPU planning retains its existing path.
  const costs = opts.noiseFree ? new Map<number, Map<number, number>>() : null;
  const evaluateAim = (aim: Aim): number => {
    if (!costs) return evaluate(world, shooter, aim, planRules, friends, profile);
    let powers = costs.get(aim.angle);
    const cached = powers?.get(aim.power);
    if (cached !== undefined) return cached;
    const cost = evaluate(world, shooter, aim, planRules, friends, profile);
    if (!powers) costs.set(aim.angle, powers = new Map());
    powers.set(aim.power, cost);
    return cost;
  };
  function* candidate(aim: Aim): Generator<void, Candidate> {
    if (!hawking) return { ...aim, cost: evaluateAim(aim) };
    const style = yield* simulateStyledShot(world, shooter, aim.angle, aim.power, planRules, friends);
    const friendlyHit = style.end.kind === 'ship' && (style.end.ship === shooter || friends.includes(style.end.ship));
    const risk = style.selfClosest < profile.selfMargin ? (profile.selfMargin - style.selfClosest) * 20 : 0;
    const cost = friendlyHit ? 1e6 : style.end.kind === 'ship' ? -1 + aim.power * (1 / 1000 + profile.powerFrugality) + risk : style.closest + risk;
    return { ...aim, cost, style };
  }
  const compare = (a: Candidate, b: Candidate): number => {
    if (!hawking) return a.cost - b.cost;
    const sa = a.style!;
    const sb = b.style!;
    const safety = (s: StyledShotOutcome): number =>
      s.end.kind === 'ship' && (s.end.ship === shooter || friends.includes(s.end.ship)) ? 2 : s.selfClosest < profile.selfMargin ? 1 : 0;
    const safetyDifference = safety(sa) - safety(sb);
    if (safetyDifference) return safetyDifference;
    // No amount of style can outweigh safety or an enemy hit.
    if (safety(sa) !== 0 && sa.selfClosest !== sb.selfClosest) return sb.selfClosest - sa.selfClosest;
    const hitDifference = Number(sb.end.kind === 'ship') - Number(sa.end.kind === 'ship');
    if (hitDifference) return hitDifference;
    return sb.swingbys - sa.swingbys || sb.flightTime - sa.flightTime || sb.pathLength - sa.pathLength || a.cost - b.cost;
  };
  const directs = world.ships
    .flatMap((t, i) => (i === shooter || !t.alive || friends.includes(i)) ? [] : [{
      angle: normalizeAngle((Math.atan2(-(t.y - self.y), t.x - self.x) * 180) / Math.PI),
      // Personality weight for the sweep: 1 for a plain enemy, less the farther away (Kepler
      // is lazy), and a fixed premium for whoever hit this CPU last (Einstein holds grudges).
      weight: Math.max(0.1, 1 - profile.distanceBias * Math.hypot(t.x - self.x, t.y - self.y) / 100)
        + (grudgeTarget === i ? profile.grudge : 0),
    }])
  if (directs.length === 0) {
    const launch = { angle: rng() * 360, power: randomPower() };
    reportDecision(null, launch);
    return launch;
  }
  const effort = opts.effort ?? 1;
  const samples = Math.round(260 * effort);
  // Precise belief planning gets target-centred seeds rather than depending on
  // random draws landing inside a narrow hit basin. Ordinary levels are unchanged.
  if (opts.noiseFree) {
    for (const direct of directs) {
      for (const power of fixedPower === null ? [...new Set([30, 50, 70, 90, 100].map((p) => Math.min(p, maxPower)))] : [fixedPower]) {
        for (const offset of [-16, -8, -4, 0, 4, 8, 16]) {
          const aim = { angle: normalizeAngle(direct.angle + offset), power };
          pool.push(yield* candidate(aim));
        }
        yield;
      }
    }
  }

  // The sweep picks its targets by personality: near ones for Kepler, grudged ones for Einstein.
  // Uniform weights cycle through the enemies exactly like the original sweep, keeping the
  // planner's random stream — and thus its seeded results — unchanged when nobody stands out.
  const uniform = directs.every((d) => d.weight === directs[0].weight);
  const totalWeight = uniform ? 0 : directs.reduce((sum, d) => sum + Math.max(d.weight, 0), 0);
  const pickDirect = (i: number): number => {
    if (uniform) return i % directs.length;
    if (totalWeight <= 0) return Math.floor(rng() * directs.length);
    let draw = rng() * totalWeight;
    for (let k = 0; k < directs.length; k++) {
      draw -= Math.max(directs[k].weight, 0);
      if (draw < 0) return k;
    }
    return directs.length - 1;
  };
  for (let i = 0; i < samples; i++) {
    // Half the samples fan out around the direct line to some enemy, half anywhere.
    const direct = directs[pickDirect(i)].angle;
    const angle = i % 2 === 0 ? normalizeAngle(direct + gaussian(rng) * 50) : rng() * 360;
    const aim = { angle, power: randomPower() };
    pool.push(yield* candidate(aim));
    // Small slices keep each frame's thinking within budget, even with many ships to check.
    if (i % 4 === 3) yield;
    if (!hawking && !optimizeHitPower && i > samples * 0.4 && pool.filter((c) => c.cost < 0).length >= 3) break;
  }

  pool.sort(compare);
  let best = pool[0];
  for (const seed of pool.slice(0, Math.max(2, Math.round(5 * effort)))) {
    let local = seed;
    let spread = 6;
    for (let i = 0; i < 45 && (hawking || local.cost > -0.5 || (optimizeHitPower && local.cost < 0)); i++) {
      const aim = {
        angle: normalizeAngle(local.angle + gaussian(rng) * spread),
        power: fixedPower ?? clampPower(local.power + gaussian(rng) * spread, maxPower),
      };
      const proposed = yield* candidate(aim);
      if (compare(proposed, local) < 0) local = proposed;
      else spread = Math.max(0.05, spread * 0.93);
      if (i % 4 === 3) yield;
    }
    if (!hawking && !optimizeHitPower && best.cost < 0) break;
    if (!hawking && optimizeHitPower && fixedPower === null && local.cost < 0) {
      let lower = Math.min(5, maxPower);
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
              const aim = { angle: normalizeAngle(center.angle + da), power: fixedPower ?? clampPower(center.power + dp, maxPower) };
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

  if (opts.noiseFree) {
    const launch = { angle: best.angle, power: fixedPower ?? best.power };
    reportDecision(best, launch);
    return launch;
  }
  const err = CPU_PROFILES[opts.level === 'hawking' ? 'hard' : opts.level];
  const scale = Math.pow(err.decay, opts.attempt);
  const launch = {
    angle: normalizeAngle(best.angle + gaussian(rng) * err.angle * scale),
    power: fixedPower ?? clampPower(best.power + gaussian(rng) * err.power * scale, maxPower),
  };
  reportDecision(best, launch);
  return launch;
}

function clampPower(p: number, max: number): number {
  return Math.min(max, Math.max(5, p));
}
