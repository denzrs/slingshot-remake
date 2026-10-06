import { HORIZON, PHYSICS } from './config';
import { planShot, type Aim, type PlanOptions } from './ai';
import { aimDirection, normalizeAngle, simulateShot, type Planet, type ShotRules, type World } from './physics';

export interface ExperimentalShot {
  /** Flat [x0, y0, x1, y1, …] samples from this CPU's completed shot. */
  points: readonly number[];
  angle: number;
  power: number;
}

export interface ExperimentalWorld {
  width: number;
  height: number;
  ships: World['ships'];
  shooter: number;
  planetCount: number;
  hasHole: boolean;
  holeRadius: number;
  rules: Pick<ShotRules, 'bounce'>;
  /** Set only by the benchmark low-power opening-probe experiment. */
  openingProbePowers?: readonly number[];
  /** This CPU's completed shots only. */
  shots: readonly ExperimentalShot[];
}

export interface PlanetEstimate {
  x: number;
  y: number;
  mass: number;
}

export interface GravityFit {
  planets: PlanetEstimate[];
  holeMass: number | null;
  samples: number;
  /** Position-residual RMS before forward refinement. */
  initialRms: number | null;
  /** Position-residual RMS after forward refinement. */
  rms: number | null;
  improvement: number | null;
  /** RMS on newest complete trajectory, fitted without that trajectory. */
  validationRms: number | null;
  validationSamples: number;
  condition: number | null;
  fitMs: number;
}

export interface PlanetMatch {
  real: Planet;
  estimated: PlanetEstimate;
  positionError: number;
  massError: number;
}

export interface ReconstructionQuality {
  planetMatches: PlanetMatch[];
  gravityRms: number;
  relativeGravityRms: number;
}

type AccelerationSample = { x: number; y: number; ax: number; ay: number };
type Observation = { shot: number; point: number };
type ForwardResult = { params: Float64Array; residuals: Float64Array; rms: number; condition: number | null };
type FitCandidate = { fit: GravityFit; params: Float64Array };

const POINT_INTERVAL = PHYSICS.DT * 2;
const COORD_SCALE = 100;
const MASS_SCALE = 10_000;
const HOLE_MASS_SCALE = 100_000;
const MIN_PLANET_MASS = 1_000;
const MAX_PLANET_MASS = 400_000;
const MAX_FIT_SAMPLES = 500;
const ACCELERATION_ITERATIONS = 12;
const FORWARD_ITERATIONS = 6;
const FORWARD_STARTS = 2;
const HYPOTHESIS_COUNT = 2;
const INTERACTIVE_FIT_SAMPLES = 24;
const REFINED_FIT_SAMPLES = 96;
const LONG_TRAIL_POINTS = 240;
const USABLE_VALIDATION_RMS = 30;
const MAX_PLANET_RADIUS = 60;

/** Compare the fitted map to the actual world for diagnostics only, never planner input. */
export function measureReconstruction(world: World, fit: GravityFit): ReconstructionQuality {
  const count = Math.min(world.planets.length, fit.planets.length);
  const states = 1 << count;
  const costs = new Float64Array(states);
  const choices = new Int8Array(states);
  costs.fill(Infinity);
  choices.fill(-1);
  costs[0] = 0;
  for (let mask = 0; mask < states; mask++) {
    let assigned = 0;
    for (let bits = mask; bits; bits &= bits - 1) assigned++;
    if (assigned >= count) continue;
    const real = world.planets[assigned];
    for (let estimate = 0; estimate < count; estimate++) {
      const bit = 1 << estimate;
      if (mask & bit) continue;
      const predicted = fit.planets[estimate];
      const dx = real.x - predicted.x;
      const dy = real.y - predicted.y;
      const next = mask | bit;
      const cost = costs[mask] + dx * dx + dy * dy;
      if (cost < costs[next]) {
        costs[next] = cost;
        choices[next] = estimate;
      }
    }
  }

  const pairs = new Int8Array(count);
  let mask = states - 1;
  for (let assigned = count - 1; assigned >= 0; assigned--) {
    const estimate = choices[mask];
    pairs[assigned] = estimate;
    mask ^= 1 << estimate;
  }
  const planetMatches: PlanetMatch[] = [];
  for (let i = 0; i < count; i++) {
    const real = world.planets[i];
    const estimated = fit.planets[pairs[i]];
    planetMatches.push({
      real,
      estimated,
      positionError: Math.hypot(real.x - estimated.x, real.y - estimated.y),
      massError: Math.abs(estimated.mass - real.mass),
    });
  }

  let error2 = 0;
  let actual2 = 0;
  let samples = 0;
  for (let row = 1; row <= 5; row++) {
    const y = (world.height * row) / 6;
    for (let col = 1; col <= 7; col++) {
      const x = (world.width * col) / 8;
      const actual = fieldAt(world.planets, world.hole, x, y);
      const estimatedHole = fit.holeMass === null ? null : { x: world.width / 2, y: world.height / 2, mass: fit.holeMass };
      const predicted = fieldAt(fit.planets, estimatedHole, x, y);
      error2 += (actual.ax - predicted.ax) ** 2 + (actual.ay - predicted.ay) ** 2;
      actual2 += actual.ax ** 2 + actual.ay ** 2;
      samples++;
    }
  }
  const gravityRms = Math.sqrt(error2 / (samples * 2));
  return { planetMatches, gravityRms, relativeGravityRms: Math.sqrt(error2 / Math.max(actual2, 1e-12)) };
}

/** Fit launch-state trajectory positions through production semi-implicit Euler update. */
export function fitGravity(shots: readonly ExperimentalShot[], count: number, width: number, height: number, hasHole: boolean, rules: Pick<ShotRules, 'bounce'> = { bounce: false }): GravityFit {
  return fitGravityHypotheses(shots, count, width, height, hasHole, rules)[0];
}

/**
 * Keep several near-optimal maps. Sparse trails can support materially different gravity fields,
 * so planning must not mistake one least-squares minimum for ground truth.
 */
export function fitGravityHypotheses(
  shots: readonly ExperimentalShot[],
  count: number,
  width: number,
  height: number,
  hasHole: boolean,
  rules: Pick<ShotRules, 'bounce'> = { bounce: false },
  sampleCap = MAX_FIT_SAMPLES,
): GravityFit[] {
  const started = performance.now();
  const candidates = fitCandidates(shots, count, width, height, hasHole, rules, sampleCap);
  const validation = validateNewestShot(shots, count, width, height, hasHole, rules, sampleCap);
  const fitMs = performance.now() - started;
  return candidates.slice(0, HYPOTHESIS_COUNT).map(({ fit }) => ({
    ...fit,
    validationRms: validation.rms,
    validationSamples: validation.samples,
    fitMs,
  }));
}

/** Fit own trajectories, use medium perturbation, and allow one coverage probe only after a miss. */
export function* planExperimentalShot(
  visible: ExperimentalWorld,
  opts: Omit<PlanOptions, 'level'>,
  report: (fit: GravityFit, decision: ExperimentalDecision) => void,
): Generator<void, Aim> {
  const sampleCap = interactiveSampleCap(visible.shots);
  const fits = fitGravityHypotheses(visible.shots, visible.planetCount, visible.width, visible.height, visible.hasHole, visible.rules, sampleCap);
  const worlds = fits.map((fit) => estimatedWorld(visible, fit));
  if (visible.shots.length === 0) {
    if (visible.openingProbePowers) {
      const probe = coverageProbe(worlds, visible, opts, visible.openingProbePowers);
      if (probe) {
        report(fits[0], { kind: 'initialProbe', hypothesisCount: fits.length, hitRate: 0, worstMiss: Infinity });
        return probe;
      }
    }
    const aim = yield* planShot(worlds[0], visible.shooter, { ...opts, level: 'medium', optimizeHitPower: true });
    report(fits[0], { kind: 'exploit', hypothesisCount: fits.length, hitRate: 0, worstMiss: Infinity });
    return aim;
  }

  const candidates: Aim[] = [];
  for (const world of worlds) candidates.push(yield* planShot(world, visible.shooter, { ...opts, effort: (opts.effort ?? 1) / worlds.length, level: 'medium', optimizeHitPower: true }));
  const robust = bestRobustAim(candidates, worlds, visible.shooter, opts);
  const validationAcceptsHit = fits[0].validationRms === null || fits[0].validationRms < USABLE_VALIDATION_RMS;
  const stableHit = robust !== null && validationAcceptsHit && robust.worstMiss < PHYSICS.SHIP_RADIUS * 2;
  if (stableHit) {
    const decision = { kind: 'exploit', hypothesisCount: fits.length, hitRate: robust.hitRate, worstMiss: robust.worstMiss } as const;
    report(fits[0], decision);
    return robust.aim;
  }

  const probe = visible.shots.length === 1 ? coverageProbe(worlds, visible, opts) : null;
  const decision = {
    kind: probe ? 'probe' : 'fallback',
    hypothesisCount: fits.length,
    hitRate: robust?.hitRate ?? 0,
    worstMiss: robust?.worstMiss ?? Infinity,
  } as const;
  report(fits[0], decision);
  return probe ?? robust?.aim ?? candidates[0];
}

export interface ExperimentalDecision {
  kind: 'exploit' | 'initialProbe' | 'probe' | 'fallback';
  hypothesisCount: number;
  /** Fraction of plausible maps that predict an enemy hit. */
  hitRate: number;
  /** Worst predicted enemy miss distance across plausible maps. */
  worstMiss: number;
}

function fitCandidates(shots: readonly ExperimentalShot[], count: number, width: number, height: number, hasHole: boolean, rules: Pick<ShotRules, 'bounce'>, sampleCap: number): FitCandidate[] {
  const seed = fitAccelerationSeed(shots, count, width, height, hasHole);
  const observations = observationsOf(shots, sampleCap);
  if (observations.length === 0) return [{ fit: seed, params: parametersFromFit(seed, width, height, hasHole) }];

  const baseParams = parametersFromFit(seed, width, height, hasHole);
  const initialRms = rmsOf(forwardResiduals(baseParams, shots, observations, count, width, height, hasHole, rules.bounce));
  const candidates: FitCandidate[] = [];
  for (let start = 0; start < FORWARD_STARTS; start++) {
    const optimized = optimizeForward(perturbStart(baseParams, count, hasHole, start), shots, observations, count, width, height, hasHole, rules.bounce);
    const fit = fitFromParameters(optimized.params, count, width, height, hasHole);
    candidates.push({
      params: optimized.params,
      fit: {
        ...fit, samples: observations.length, initialRms, rms: optimized.rms, improvement: initialRms - optimized.rms,
        validationRms: null, validationSamples: 0, condition: optimized.condition, fitMs: 0,
      },
    });
  }
  candidates.sort((a, b) => a.fit.rms! - b.fit.rms!);
  return diverseCandidates(candidates, width, height, hasHole);
}

function perturbStart(base: Float64Array, count: number, hasHole: boolean, start: number): Float64Array {
  const candidate = new Float64Array(base);
  if (start === 0) return candidate;
  const phase = start * 0.61803398875;
  for (let i = 0; i < count; i++) {
    const x = fract(phase + (i + 1) * 0.38196601125);
    const y = fract(phase + (i + 1) * 0.75487766625);
    candidate[i * 3] = clamp(candidate[i * 3] + (x - 0.5) * 0.2, 0, 1);
    candidate[i * 3 + 1] = clamp(candidate[i * 3 + 1] + (y - 0.5) * 0.16, 0, 1);
    candidate[i * 3 + 2] += (fract(phase + i * 0.5) - 0.5) * 0.7;
  }
  if (hasHole) candidate[candidate.length - 1] += (fract(phase * 1.7) - 0.5) * 0.8;
  clampForwardParameters(candidate, count, hasHole);
  return candidate;
}

function diverseCandidates(candidates: readonly FitCandidate[], width: number, height: number, hasHole: boolean): FitCandidate[] {
  const kept: FitCandidate[] = [];
  for (const candidate of candidates) {
    const duplicate = kept.some(({ params }) => parameterDistance(params, candidate.params, width, height, hasHole) < 12);
    if (!duplicate || kept.length < 2) kept.push(candidate);
    if (kept.length === HYPOTHESIS_COUNT) break;
  }
  return kept.length ? kept : [candidates[0]];
}

function parameterDistance(a: Float64Array, b: Float64Array, width: number, height: number, hasHole: boolean): number {
  let sum = 0;
  const end = hasHole ? a.length - 1 : a.length;
  for (let i = 0; i < end; i += 3) sum += Math.hypot((a[i] - b[i]) * width, (a[i + 1] - b[i + 1]) * height) + Math.abs(a[i + 2] - b[i + 2]) * 30;
  if (hasHole) sum += Math.abs(a[a.length - 1] - b[b.length - 1]) * 30;
  return sum;
}

function validateNewestShot(shots: readonly ExperimentalShot[], count: number, width: number, height: number, hasHole: boolean, rules: Pick<ShotRules, 'bounce'>, sampleCap: number): { rms: number | null; samples: number } {
  if (shots.length < 2) return { rms: null, samples: 0 };
  const heldOut = shots[shots.length - 1];
  const train = shots.slice(0, -1);
  const candidate = fitCandidates(train, count, width, height, hasHole, rules, sampleCap)[0];
  const observations = observationsOf([heldOut], sampleCap);
  if (!observations.length) return { rms: null, samples: 0 };
  return { rms: rmsOf(forwardResiduals(candidate.params, [heldOut], observations, count, width, height, hasHole, rules.bounce)), samples: observations.length };
}

function interactiveSampleCap(shots: readonly ExperimentalShot[]): number {
  const informativeTrails = shots.filter((shot) => shot.points.length / 2 >= LONG_TRAIL_POINTS).length;
  return informativeTrails >= 2 ? REFINED_FIT_SAMPLES : INTERACTIVE_FIT_SAMPLES;
}

function fract(value: number): number {
  return value - Math.floor(value);
}

function observationsOf(shots: readonly ExperimentalShot[], sampleCap = MAX_FIT_SAMPLES): Observation[] {
  const all: Observation[] = [];
  for (let shot = 0; shot < shots.length; shot++) {
    const count = Math.floor(shots[shot].points.length / 2);
    for (let point = 1; point < count - 2; point++) all.push({ shot, point });
  }
  if (all.length <= sampleCap) return all;
  const selected: Observation[] = [];
  for (let i = 0; i < sampleCap; i++) selected.push(all[Math.floor((i * all.length) / sampleCap)]);
  return selected;
}

function fitAccelerationSeed(shots: readonly ExperimentalShot[], count: number, width: number, height: number, hasHole: boolean): GravityFit {
  const samples: AccelerationSample[] = [];
  for (const shot of shots) {
    const length = Math.floor(shot.points.length / 2);
    for (let i = 2; i < length - 2; i++) {
      const j = i * 2;
      samples.push({
        x: shot.points[j],
        y: shot.points[j + 1],
        ax: (shot.points[j + 2] - 2 * shot.points[j] + shot.points[j - 2]) / (POINT_INTERVAL * POINT_INTERVAL),
        ay: (shot.points[j + 3] - 2 * shot.points[j + 1] + shot.points[j - 1]) / (POINT_INTERVAL * POINT_INTERVAL),
      });
    }
  }
  if (samples.length > MAX_FIT_SAMPLES) {
    const reduced: AccelerationSample[] = [];
    for (let i = 0; i < MAX_FIT_SAMPLES; i++) reduced.push(samples[Math.floor((i * samples.length) / MAX_FIT_SAMPLES)]);
    samples.splice(0, samples.length, ...reduced);
  }

  const planetCount = Math.max(0, Math.floor(count));
  const parameterCount = planetCount * 3 + (hasHole ? 1 : 0);
  const params = new Float64Array(parameterCount);
  if (hasHole) params[parameterCount - 1] = HORIZON.START_MASS / HOLE_MASS_SCALE;
  for (let i = 0; i < planetCount; i++) {
    params[i * 3] = width * (i + 1) / ((planetCount + 1) * COORD_SCALE);
    params[i * 3 + 1] = height * (i % 2 === 0 ? 0.36 : 0.66) / COORD_SCALE;
  }
  if (samples.length === 0) return {
    ...fitFromAccelerationParameters(params, planetCount, hasHole), samples: 0, initialRms: null, rms: null, improvement: null,
    validationRms: null, validationSamples: 0, condition: null, fitMs: 0,
  };

  const residualX = new Float64Array(samples.length);
  const residualY = new Float64Array(samples.length);
  for (let i = 0; i < planetCount; i++) {
    let baseError = 0;
    for (let j = 0; j < samples.length; j++) {
      const sample = samples[j];
      const known = gravityAtAcceleration(sample.x, sample.y, params, i, width, height, hasHole);
      residualX[j] = sample.ax - known.ax;
      residualY[j] = sample.ay - known.ay;
      baseError += residualX[j] ** 2 + residualY[j] ** 2;
    }
    let bestError = baseError;
    let bestX = params[i * 3] * COORD_SCALE;
    let bestY = params[i * 3 + 1] * COORD_SCALE;
    let bestMass = MIN_PLANET_MASS;
    for (let x = 16; x < width; x += 32) {
      for (let y = 16; y < height; y += 32) {
        let overlaps = false;
        for (let previous = 0; previous < i; previous++) {
          if (Math.hypot(x - params[previous * 3] * COORD_SCALE, y - params[previous * 3 + 1] * COORD_SCALE) < 48) {
            overlaps = true;
            break;
          }
        }
        if (overlaps) continue;
        let dot = 0;
        let norm = 0;
        for (let j = 0; j < samples.length; j++) {
          const dx = x - samples[j].x;
          const dy = y - samples[j].y;
          const d2 = Math.max(25, dx * dx + dy * dy);
          const unitX = PHYSICS.G * dx / (d2 * Math.sqrt(d2));
          const unitY = PHYSICS.G * dy / (d2 * Math.sqrt(d2));
          dot += residualX[j] * unitX + residualY[j] * unitY;
          norm += unitX * unitX + unitY * unitY;
        }
        if (norm === 0) continue;
        const mass = clamp(dot / norm, 0, MAX_PLANET_MASS);
        const error = baseError - 2 * mass * dot + mass * mass * norm;
        if (error < bestError) {
          bestError = error;
          bestX = x;
          bestY = y;
          bestMass = mass;
        }
      }
    }
    params[i * 3] = bestX / COORD_SCALE;
    params[i * 3 + 1] = bestY / COORD_SCALE;
    params[i * 3 + 2] = Math.max(MIN_PLANET_MASS, bestMass) / MASS_SCALE;
  }

  let damping = 1e-3;
  let bestRms = accelerationRms(samples, params, planetCount, width, height, hasHole);
  for (let iteration = 0; iteration < ACCELERATION_ITERATIONS; iteration++) {
    const normal = new Float64Array(parameterCount * parameterCount);
    const gradient = new Float64Array(parameterCount);
    const jx = new Float64Array(parameterCount);
    const jy = new Float64Array(parameterCount);
    for (const sample of samples) accumulateAcceleration(sample, params, planetCount, width, height, hasHole, normal, gradient, jx, jy);
    for (let i = 0; i < parameterCount; i++) normal[i * parameterCount + i] += damping * Math.max(1, normal[i * parameterCount + i]);
    const step = solve(normal, gradient, parameterCount);
    if (!step) break;
    const candidate = new Float64Array(params);
    for (let i = 0; i < parameterCount; i++) candidate[i] += step[i];
    clampAccelerationParameters(candidate, planetCount, width, height, hasHole);
    const rms = accelerationRms(samples, candidate, planetCount, width, height, hasHole);
    if (rms < bestRms) {
      params.set(candidate);
      bestRms = rms;
      damping = Math.max(1e-8, damping * 0.3);
    } else {
      damping = Math.min(1e8, damping * 10);
    }
  }
  return {
    ...fitFromAccelerationParameters(params, planetCount, hasHole), samples: samples.length, initialRms: bestRms, rms: bestRms, improvement: 0,
    validationRms: null, validationSamples: 0, condition: null, fitMs: 0,
  };
}

function parametersFromFit(fit: GravityFit, width: number, height: number, hasHole: boolean): Float64Array {
  const params = new Float64Array(fit.planets.length * 3 + (hasHole ? 1 : 0));
  for (let i = 0; i < fit.planets.length; i++) {
    const planet = fit.planets[i];
    params[i * 3] = clamp(planet.x / width, 0, 1);
    params[i * 3 + 1] = clamp(planet.y / height, 0, 1);
    params[i * 3 + 2] = Math.log(Math.max(MIN_PLANET_MASS, planet.mass));
  }
  if (hasHole) params[params.length - 1] = Math.log(Math.max(1, fit.holeMass ?? HORIZON.START_MASS));
  return params;
}

function optimizeForward(
  start: Float64Array,
  shots: readonly ExperimentalShot[],
  observations: readonly Observation[],
  count: number,
  width: number,
  height: number,
  hasHole: boolean,
  bounce: boolean,
): ForwardResult {
  const params = new Float64Array(start);
  let residuals = forwardResiduals(params, shots, observations, count, width, height, hasHole, bounce);
  let rms = rmsOf(residuals);
  let damping = 1e-3;
  let condition: number | null = null;
  for (let iteration = 0; iteration < FORWARD_ITERATIONS; iteration++) {
    const parameterCount = params.length;
    const derivatives: Float64Array[] = [];
    for (let parameter = 0; parameter < parameterCount; parameter++) {
      const step = parameter % 3 === 2 ? 0.04 : 0.004;
      const plus = new Float64Array(params);
      const minus = new Float64Array(params);
      plus[parameter] += step;
      minus[parameter] -= step;
      clampForwardParameters(plus, count, hasHole);
      clampForwardParameters(minus, count, hasHole);
      const plusResiduals = forwardResiduals(plus, shots, observations, count, width, height, hasHole, bounce);
      const minusResiduals = forwardResiduals(minus, shots, observations, count, width, height, hasHole, bounce);
      const derivative = new Float64Array(residuals.length);
      for (let i = 0; i < derivative.length; i++) derivative[i] = (plusResiduals[i] - minusResiduals[i]) / (2 * step);
      derivatives.push(derivative);
    }

    const normal = new Float64Array(parameterCount * parameterCount);
    const gradient = new Float64Array(parameterCount);
    let smallest = Infinity;
    let largest = 0;
    for (let row = 0; row < parameterCount; row++) {
      for (let i = 0; i < residuals.length; i++) gradient[row] -= derivatives[row][i] * residuals[i];
      for (let col = 0; col < parameterCount; col++) {
        let value = 0;
        for (let i = 0; i < residuals.length; i++) value += derivatives[row][i] * derivatives[col][i];
        normal[row * parameterCount + col] = value;
      }
      const diagonal = normal[row * parameterCount + row];
      smallest = Math.min(smallest, diagonal);
      largest = Math.max(largest, diagonal);
      normal[row * parameterCount + row] += damping * Math.max(1, diagonal);
    }
    condition = smallest > 0 ? largest / smallest : Infinity;
    const delta = solve(normal, gradient, parameterCount);
    if (!delta) break;
    const candidate = new Float64Array(params);
    for (let i = 0; i < candidate.length; i++) candidate[i] += delta[i];
    clampForwardParameters(candidate, count, hasHole);
    const candidateResiduals = forwardResiduals(candidate, shots, observations, count, width, height, hasHole, bounce);
    const candidateRms = rmsOf(candidateResiduals);
    if (candidateRms < rms) {
      params.set(candidate);
      residuals = candidateResiduals;
      rms = candidateRms;
      damping = Math.max(1e-8, damping * 0.3);
    } else {
      damping = Math.min(1e8, damping * 10);
    }
  }
  return { params, residuals, rms, condition };
}

function forwardResiduals(
  params: Float64Array,
  shots: readonly ExperimentalShot[],
  observations: readonly Observation[],
  count: number,
  width: number,
  height: number,
  hasHole: boolean,
  bounce: boolean,
): Float64Array {
  const residuals = new Float64Array(observations.length * 2);
  let output = 0;
  let observation = 0;
  for (let shotIndex = 0; shotIndex < shots.length; shotIndex++) {
    const first = observation;
    while (observation < observations.length && observations[observation].shot === shotIndex) observation++;
    if (first === observation) continue;
    const shot = shots[shotIndex];
    let x = shot.points[0];
    let y = shot.points[1];
    const direction = aimDirection(shot.angle);
    let vx = direction.x * shot.power * PHYSICS.SPEED_PER_POWER;
    let vy = direction.y * shot.power * PHYSICS.SPEED_PER_POWER;
    const lastPoint = observations[observation - 1].point;
    let wanted = first;
    for (let step = 1; step <= lastPoint * 2; step++) {
      const field = fieldFromParameters(params, count, width, height, hasHole, x, y);
      vx += field.ax * PHYSICS.DT;
      vy += field.ay * PHYSICS.DT;
      x += vx * PHYSICS.DT;
      y += vy * PHYSICS.DT;
      if (bounce && x < 0) { x = -x; vx = -vx; }
      else if (bounce && x > width) { x = 2 * width - x; vx = -vx; }
      if (bounce && y < 0) { y = -y; vy = -vy; }
      else if (bounce && y > height) { y = 2 * height - y; vy = -vy; }
      if (step % 2 === 0) {
        const point = step / 2;
        while (wanted < observation && observations[wanted].point === point) {
          const offset = observations[wanted].point * 2;
          residuals[output++] = x - shot.points[offset];
          residuals[output++] = y - shot.points[offset + 1];
          wanted++;
        }
      }
    }
  }
  return residuals;
}

type RobustAim = { aim: Aim; hitRate: number; worstMiss: number };

function bestRobustAim(candidates: readonly Aim[], worlds: readonly World[], shooter: number, opts: Omit<PlanOptions, 'level'>): RobustAim | null {
  const friends = opts.friends ?? [];
  let best: RobustAim | null = null;
  for (const aim of candidates) {
    let hits = 0;
    let worstMiss = 0;
    let unsafe = false;
    for (const world of worlds) {
      const outcome = simulateShot(world, shooter, aim.angle, aim.power, opts.rules, friends);
      if (outcome.end.kind === 'ship' && outcome.end.ship !== shooter && !friends.includes(outcome.end.ship)) hits++;
      if (outcome.end.kind === 'ship' && (outcome.end.ship === shooter || friends.includes(outcome.end.ship))) unsafe = true;
      worstMiss = Math.max(worstMiss, outcome.closest);
      if (crossesEstimatedBody(world, shooter, aim, opts.rules)) unsafe = true;
    }
    if (unsafe) continue;
    const candidate = { aim, hitRate: hits / worlds.length, worstMiss };
    if (!best || candidate.worstMiss < best.worstMiss || (candidate.worstMiss === best.worstMiss && candidate.hitRate > best.hitRate)) best = candidate;
  }
  return best;
}

/** Pick a safe launch whose plausible trajectories disagree most at observed samples. */
function coverageProbe(
  worlds: readonly World[],
  visible: ExperimentalWorld,
  opts: Omit<PlanOptions, 'level'>,
  probePowers?: readonly number[],
): Aim | null {
  const self = worlds[0].ships[visible.shooter];
  const friends = opts.friends ?? [];
  const targets = worlds[0].ships.filter((ship, id) => id !== visible.shooter && ship.alive && !friends.includes(id));
  if (!targets.length) return null;
  const history = visible.shots.flatMap((shot) => shot.points);
  const powers = probePowers ?? (opts.fixedPower === null ? [35, 55, 75] : [opts.fixedPower]);
  let best: Aim | null = null;
  let bestScore = -Infinity;
  for (let turn = 0; turn < 20; turn++) {
    const target = targets[turn % targets.length];
    const direct = normalizeAngle((Math.atan2(-(target.y - self.y), target.x - self.x) * 180) / Math.PI);
    const angle = turn < 16 ? normalizeAngle(direct + (turn - 7.5) * 15) : turn * 22.5;
    for (const power of powers) {
      let unsafe = false;
      for (const world of worlds) {
        const outcome = simulateShot(world, visible.shooter, angle, power, opts.rules, friends);
        if (outcome.end.kind === 'ship' && (outcome.end.ship === visible.shooter || friends.includes(outcome.end.ship))) unsafe = true;
        if (crossesEstimatedBody(world, visible.shooter, { angle, power }, opts.rules)) unsafe = true;
      }
      if (unsafe) continue;
      const paths = worlds.map((world) => probePath(world, visible.shooter, angle, power, opts.rules));
      const samples = Math.min(...paths.map((path) => path.length));
      if (samples < 12) continue;
      const middle = Math.floor(samples / 2);
      let meanX = 0;
      let meanY = 0;
      for (const path of paths) {
        meanX += path[middle][0];
        meanY += path[middle][1];
      }
      meanX /= paths.length;
      meanY /= paths.length;
      let score = Math.max(0, 900 - Math.hypot(meanX - target.x, meanY - target.y));
      for (const path of paths) score += Math.hypot(path[middle][0] - meanX, path[middle][1] - meanY) * 4;
      for (let i = 0; i < history.length; i += 20) score += Math.min(80, Math.hypot(meanX - history[i], meanY - history[i + 1])) * 0.02;
      if (score > bestScore) {
        bestScore = score;
        best = { angle, power };
      }
    }
  }
  return best;
}

function probePath(world: World, shooter: number, angle: number, power: number, rules: ShotRules): [number, number][] {
  const direction = aimDirection(angle);
  let x = world.ships[shooter].x + direction.x * PHYSICS.MUZZLE;
  let y = world.ships[shooter].y + direction.y * PHYSICS.MUZZLE;
  let vx = direction.x * power * PHYSICS.SPEED_PER_POWER;
  let vy = direction.y * power * PHYSICS.SPEED_PER_POWER;
  const path: [number, number][] = [];
  for (let step = 0; step < Math.round(Math.min(rules.timeLimit, 5) / PHYSICS.DT); step++) {
    const field = fieldAt(world.planets, world.hole, x, y);
    vx += field.ax * PHYSICS.DT;
    vy += field.ay * PHYSICS.DT;
    x += vx * PHYSICS.DT;
    y += vy * PHYSICS.DT;
    if (rules.bounce) {
      if (x < 0) { x = -x; vx = -vx; }
      else if (x > world.width) { x = 2 * world.width - x; vx = -vx; }
      if (y < 0) { y = -y; vy = -vy; }
      else if (y > world.height) { y = 2 * world.height - y; vy = -vy; }
    }
    if (step % 20 === 19) path.push([x, y]);
  }
  return path;
}

function crossesEstimatedBody(world: World, shooter: number, aim: Aim, rules: ShotRules): boolean {
  const direction = aimDirection(aim.angle);
  let x = world.ships[shooter].x + direction.x * PHYSICS.MUZZLE;
  let y = world.ships[shooter].y + direction.y * PHYSICS.MUZZLE;
  let vx = direction.x * aim.power * PHYSICS.SPEED_PER_POWER;
  let vy = direction.y * aim.power * PHYSICS.SPEED_PER_POWER;
  for (let step = 0; step < Math.round(Math.min(rules.timeLimit, 8) / PHYSICS.DT); step++) {
    const field = fieldAt(world.planets, world.hole, x, y);
    vx += field.ax * PHYSICS.DT;
    vy += field.ay * PHYSICS.DT;
    x += vx * PHYSICS.DT;
    y += vy * PHYSICS.DT;
    for (const planet of world.planets) if (Math.hypot(x - planet.x, y - planet.y) < MAX_PLANET_RADIUS + PHYSICS.SHIP_RADIUS) return true;
    if (!rules.bounce && (x < -PHYSICS.OUT_MARGIN || x > world.width + PHYSICS.OUT_MARGIN || y < -PHYSICS.OUT_MARGIN || y > world.height + PHYSICS.OUT_MARGIN)) break;
  }
  return false;
}

function fieldFromParameters(params: Float64Array, count: number, width: number, height: number, hasHole: boolean, x: number, y: number): { ax: number; ay: number } {
  let ax = 0;
  let ay = 0;
  for (let i = 0; i < count; i++) {
    const dx = params[i * 3] * width - x;
    const dy = params[i * 3 + 1] * height - y;
    const d2 = Math.max(25, dx * dx + dy * dy);
    const force = PHYSICS.G * Math.exp(params[i * 3 + 2]) / (d2 * Math.sqrt(d2));
    ax += force * dx;
    ay += force * dy;
  }
  if (hasHole) {
    const dx = width / 2 - x;
    const dy = height / 2 - y;
    const d2 = Math.max(25, dx * dx + dy * dy);
    const force = PHYSICS.G * Math.exp(params[params.length - 1]) / (d2 * Math.sqrt(d2));
    ax += force * dx;
    ay += force * dy;
  }
  return { ax, ay };
}

function fitFromParameters(params: Float64Array, count: number, width: number, height: number, hasHole: boolean): Pick<GravityFit, 'planets' | 'holeMass'> {
  const planets = Array.from({ length: count }, (_, i) => ({ x: params[i * 3] * width, y: params[i * 3 + 1] * height, mass: Math.exp(params[i * 3 + 2]) }));
  const holeMass = hasHole ? Math.exp(params[params.length - 1]) : null;
  return { planets, holeMass };
}

function estimatedWorld(visible: ExperimentalWorld, fit: GravityFit): World {
  return {
    width: visible.width,
    height: visible.height,
    ships: visible.ships,
    // Position and mass are inferred; radius is not. Do not turn mass into a fake collision disk.
    planets: fit.planets.map((planet, i) => ({ ...planet, radius: 0, seed: i, style: 'rocky', tint: '#ffffff' })),
    hole: fit.holeMass === null ? null : { x: visible.width / 2, y: visible.height / 2, radius: visible.holeRadius, mass: fit.holeMass },
    version: 0,
  };
}

function clampForwardParameters(params: Float64Array, count: number, hasHole: boolean): void {
  for (let i = 0; i < count; i++) {
    params[i * 3] = clamp(params[i * 3], 0, 1);
    params[i * 3 + 1] = clamp(params[i * 3 + 1], 0, 1);
    params[i * 3 + 2] = clamp(params[i * 3 + 2], Math.log(MIN_PLANET_MASS), Math.log(MAX_PLANET_MASS));
  }
  if (hasHole) params[params.length - 1] = clamp(params[params.length - 1], Math.log(10_000), Math.log(4_000_000));
}

function fitFromAccelerationParameters(params: Float64Array, count: number, hasHole: boolean): Pick<GravityFit, 'planets' | 'holeMass'> {
  const planets = Array.from({ length: count }, (_, i) => ({ x: params[i * 3] * COORD_SCALE, y: params[i * 3 + 1] * COORD_SCALE, mass: params[i * 3 + 2] * MASS_SCALE }));
  const holeMass = hasHole ? params[params.length - 1] * HOLE_MASS_SCALE : null;
  return { planets, holeMass };
}

function clampAccelerationParameters(params: Float64Array, count: number, width: number, height: number, hasHole: boolean): void {
  for (let i = 0; i < count; i++) {
    params[i * 3] = clamp(params[i * 3], 0, width / COORD_SCALE);
    params[i * 3 + 1] = clamp(params[i * 3 + 1], 0, height / COORD_SCALE);
    params[i * 3 + 2] = clamp(params[i * 3 + 2], MIN_PLANET_MASS / MASS_SCALE, MAX_PLANET_MASS / MASS_SCALE);
  }
  if (hasHole) params[params.length - 1] = clamp(params[params.length - 1], 0.1, 40);
}

function accumulateAcceleration(
  sample: AccelerationSample,
  params: Float64Array,
  count: number,
  width: number,
  height: number,
  hasHole: boolean,
  normal: Float64Array,
  gradient: Float64Array,
  jx: Float64Array,
  jy: Float64Array,
): void {
  const n = params.length;
  const predicted = gravityAtAcceleration(sample.x, sample.y, params, count, width, height, hasHole, jx, jy);
  const rx = sample.ax - predicted.ax;
  const ry = sample.ay - predicted.ay;
  for (let row = 0; row < n; row++) {
    gradient[row] += jx[row] * rx + jy[row] * ry;
    for (let col = 0; col < n; col++) normal[row * n + col] += jx[row] * jx[col] + jy[row] * jy[col];
  }
}

function accelerationRms(samples: readonly AccelerationSample[], params: Float64Array, count: number, width: number, height: number, hasHole: boolean): number {
  let sum = 0;
  for (const sample of samples) {
    const predicted = gravityAtAcceleration(sample.x, sample.y, params, count, width, height, hasHole);
    sum += (sample.ax - predicted.ax) ** 2 + (sample.ay - predicted.ay) ** 2;
  }
  return Math.sqrt(sum / (samples.length * 2));
}

function gravityAtAcceleration(
  x: number,
  y: number,
  params: Float64Array,
  count: number,
  width: number,
  height: number,
  hasHole: boolean,
  jx?: Float64Array,
  jy?: Float64Array,
): { ax: number; ay: number } {
  let ax = 0;
  let ay = 0;
  if (jx) jx.fill(0);
  if (jy) jy.fill(0);
  for (let i = 0; i < count; i++) {
    const offset = i * 3;
    const dx = params[offset] * COORD_SCALE - x;
    const dy = params[offset + 1] * COORD_SCALE - y;
    const mass = params[offset + 2] * MASS_SCALE;
    const d2 = Math.max(25, dx * dx + dy * dy);
    const invD3 = 1 / (d2 * Math.sqrt(d2));
    const factor = PHYSICS.G * mass * invD3;
    ax += factor * dx;
    ay += factor * dy;
    if (jx && jy) {
      const invD5 = invD3 / d2;
      jx[offset] = PHYSICS.G * mass * (invD3 - 3 * dx * dx * invD5) * COORD_SCALE;
      jx[offset + 1] = -PHYSICS.G * mass * 3 * dx * dy * invD5 * COORD_SCALE;
      jx[offset + 2] = PHYSICS.G * MASS_SCALE * dx * invD3;
      jy[offset] = -PHYSICS.G * mass * 3 * dx * dy * invD5 * COORD_SCALE;
      jy[offset + 1] = PHYSICS.G * mass * (invD3 - 3 * dy * dy * invD5) * COORD_SCALE;
      jy[offset + 2] = PHYSICS.G * MASS_SCALE * dy * invD3;
    }
  }
  if (hasHole) {
    const holeIndex = params.length - 1;
    const dx = width / 2 - x;
    const dy = height / 2 - y;
    const d2 = Math.max(25, dx * dx + dy * dy);
    const invD3 = 1 / (d2 * Math.sqrt(d2));
    const mass = params[holeIndex] * HOLE_MASS_SCALE;
    ax += PHYSICS.G * mass * dx * invD3;
    ay += PHYSICS.G * mass * dy * invD3;
    if (jx && jy) {
      jx[holeIndex] = PHYSICS.G * HOLE_MASS_SCALE * dx * invD3;
      jy[holeIndex] = PHYSICS.G * HOLE_MASS_SCALE * dy * invD3;
    }
  }
  return { ax, ay };
}

function fieldAt(planets: readonly Pick<Planet, 'x' | 'y' | 'mass'>[] | readonly PlanetEstimate[], hole: { x: number; y: number; mass: number } | null, x: number, y: number): { ax: number; ay: number } {
  let ax = 0;
  let ay = 0;
  for (const body of planets) {
    const dx = body.x - x;
    const dy = body.y - y;
    const d2 = Math.max(25, dx * dx + dy * dy);
    const force = PHYSICS.G * body.mass / (d2 * Math.sqrt(d2));
    ax += force * dx;
    ay += force * dy;
  }
  if (hole) {
    const dx = hole.x - x;
    const dy = hole.y - y;
    const d2 = Math.max(25, dx * dx + dy * dy);
    const force = PHYSICS.G * hole.mass / (d2 * Math.sqrt(d2));
    ax += force * dx;
    ay += force * dy;
  }
  return { ax, ay };
}

function rmsOf(residuals: Float64Array): number {
  let sum = 0;
  for (const residual of residuals) sum += residual * residual;
  return Math.sqrt(sum / residuals.length);
}

function solve(matrix: Float64Array, rhs: Float64Array, size: number): Float64Array | null {
  const a = new Float64Array(matrix);
  const b = new Float64Array(rhs);
  for (let col = 0; col < size; col++) {
    let pivot = col;
    for (let row = col + 1; row < size; row++) if (Math.abs(a[row * size + col]) > Math.abs(a[pivot * size + col])) pivot = row;
    if (Math.abs(a[pivot * size + col]) < 1e-14) return null;
    if (pivot !== col) {
      for (let k = col; k < size; k++) [a[col * size + k], a[pivot * size + k]] = [a[pivot * size + k], a[col * size + k]];
      [b[col], b[pivot]] = [b[pivot], b[col]];
    }
    const divisor = a[col * size + col];
    for (let k = col; k < size; k++) a[col * size + k] /= divisor;
    b[col] /= divisor;
    for (let row = 0; row < size; row++) {
      if (row === col) continue;
      const factor = a[row * size + col];
      for (let k = col; k < size; k++) a[row * size + k] -= factor * a[col * size + k];
      b[row] -= factor * b[col];
    }
  }
  return b;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
