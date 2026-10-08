import { AIM, HORIZON, PHYSICS } from './config';
import { planShot, type Aim, type PlanOptions } from './ai';
import { Shot, aimDirection, normalizeAngle, simulateShot, type Planet, type ShotOutcome, type ShotRules, type World } from './physics';
import { balancedObservations, matchEstimatedSources, retainRepresentativeShots } from './experimental-evidence';

export interface ExperimentalShot {
  /** Flat [x0, y0, x1, y1, …] samples from this CPU's completed shot. */
  points: readonly number[];
  angle: number;
  power: number;
  shotId?: number;
}

export interface ExperimentalWorld {
  width: number;
  height: number;
  ships: World['ships'];
  shooter: number;
  planetCount: number;
  /** Public geometry only; stable IDs survive Horizon drift. */
  visiblePlanets?: readonly { id: number; x: number; y: number; radius: number }[];
  visibleHole?: { x: number; y: number; radius: number };
  mode?: 'classic' | 'horizon';
  epoch?: number;
  hasHole: boolean;
  holeRadius: number;
  rules: Pick<ShotRules, 'bounce'>;
  /** This CPU's completed shots only. */
  shots: readonly ExperimentalShot[];
}

export interface PlanetEstimate {
  x: number;
  y: number;
  mass: number;
  id?: number;
  radius?: number;
  /** Relative posterior standard deviation; independent planet densities are not pooled. */
  massUncertainty?: number;
  /** Absolute mass standard deviation, defined even for a gravity-free belief. */
  massStandardDeviation?: number;
}

export interface ExperimentalRecoveryDiagnostics {
  optimizerInitialRms: number | null;
  optimizerFinalRms: number | null;
  beliefBeforeRms: number | null;
  beliefAfterRms: number | null;
  candidateValidationRms: number | null;
  previousValidationRms: number | null;
  validationSamples: number;
  proposedLearningRate: number;
  effectiveLearningRate: number;
  updateStatus: 'accepted' | 'reduced' | 'rejected' | 'frozen' | 'unavailable';
  sampleCounts: number[];
  retainedShotIds: (number | null)[];
  stagnationCount: number;
  stalled: boolean;
  /** Additional separated starts for this observation; total starts are bounded at four. */
  recoveryStarts: number;
  matchedSources: number;
}

function emptyRecovery(): ExperimentalRecoveryDiagnostics {
  return { optimizerInitialRms: null, optimizerFinalRms: null, beliefBeforeRms: null, beliefAfterRms: null,
    candidateValidationRms: null, previousValidationRms: null, validationSamples: 0,
    proposedLearningRate: 0, effectiveLearningRate: 0, updateStatus: 'unavailable', sampleCounts: [],
    retainedShotIds: [], stagnationCount: 0, stalled: false, recoveryStarts: 0, matchedSources: 0 };
}

export interface GravityFit {
  planets: PlanetEstimate[];
  holeMass: number | null;
  samples: number;
  /** Current belief RMS on the same retained samples as rms (optimizer start for standalone fits). */
  initialRms: number | null;
  /** Position-residual RMS after forward refinement. */
  rms: number | null;
  improvement: number | null;
  /** RMS on newest complete trajectory, fitted without that trajectory. */
  validationRms: number | null;
  validationSamples: number;
  condition: number | null;
  fitMs: number;
  hole?: { x: number; y: number; radius: number };
  holeMassUncertainty?: number;
  holeMassStandardDeviation?: number;
  startingKnowledge?: number;
  observedShots?: number;
  learnedShots?: number;
  retainedShots?: number;
  learningRate?: number;
  predictionRms?: number | null;
  predictionSamples?: number;
  recovery?: ExperimentalRecoveryDiagnostics;
}

interface PlanetMatch {
  real: Planet;
  estimated: PlanetEstimate;
  positionError: number;
  massError: number;
}

interface ReconstructionQuality {
  planetMatches: PlanetMatch[];
  gravityRms: number;
  relativeGravityRms: number;
}

type AccelerationSample = { x: number; y: number; ax: number; ay: number };
type Observation = { shot: number; point: number };
type ForwardResult = { params: Float64Array; residuals: Float64Array; rms: number; condition: number | null };
type FitCandidate = { fit: GravityFit; params: Float64Array; local?: boolean };

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
const HYPOTHESIS_COUNT = 4;
const REFINED_FIT_SAMPLES = 96;

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
      const estimatedHole = fit.holeMass === null ? null : { x: fit.hole?.x ?? world.width / 2, y: fit.hole?.y ?? world.height / 2, mass: fit.holeMass };
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

type RetainedEvidence = { shot: ExperimentalShot };
type ExperimentalLearnerFit = GravityFit & Required<Pick<GravityFit,
  'observedShots' | 'learnedShots' | 'retainedShots' | 'learningRate' | 'startingKnowledge' | 'predictionRms' | 'predictionSamples'>>;

/** Each CPU owns this state for one round, independently of rendering trails. */
export interface ExperimentalLearner {
  readonly startingKnowledge: number;
  planets: PlanetEstimate[];
  /** Assimilated alternatives from the hidden-position fitter, never true sources. */
  hypotheses: GravityFit[];
  holeMass: number | null;
  hole?: { x: number; y: number; radius: number };
  holeMassUncertainty?: number;
  holeMassStandardDeviation?: number;
  evidence: RetainedEvidence[];
  /** Actual evidence count when trajectories are retained exclusively by the fit worker. */
  retainedShots?: number;
  /** Planner-only replica: observations must be assimilated by its owning worker. */
  evidenceOwnedByWorker?: true;
  seen: Set<string>;
  geometry: string | null;
  observedShots: number;
  learnedShots: number;
  learningRate: number;
  predictionRms: number | null;
  predictionSamples: number;
  samples: number;
  rms: number | null;
  initialRms: number | null;
  condition: number | null;
  fitMs: number;
  recovery: ExperimentalRecoveryDiagnostics;
  /** Actual pre-assimilation errors; compact state crosses to the planner worker. */
  predictionTrend: number[];
  lastRecoveryShot: number;
  probeHistory: { angle: number; power: number; x: number; y: number }[];
}

export function createExperimentalLearner(startingKnowledge = 1): ExperimentalLearner {
  const learner: ExperimentalLearner = {
    startingKnowledge: boundedRate(startingKnowledge),
    planets: [], hypotheses: [], holeMass: null, evidence: [], seen: new Set(), geometry: null,
    observedShots: 0, learnedShots: 0, learningRate: 1, predictionRms: null,
    predictionSamples: 0, samples: 0, rms: null, initialRms: null, condition: null, fitMs: 0,
    recovery: emptyRecovery(), predictionTrend: [], lastRecoveryShot: -3,
    probeHistory: [],
  };
  Object.defineProperty(learner, 'startingKnowledge', { writable: false, configurable: false });
  return learner;
}

/** Compact planner state; no trajectory history or deduplication strings cross threads. */
export type ExperimentalLearnerSnapshot = Omit<ExperimentalLearner, 'evidence' | 'seen' | 'evidenceOwnedByWorker' | 'retainedShots'> & {
  retainedShots: number;
};

export function snapshotExperimentalLearner(learner: ExperimentalLearner): ExperimentalLearnerSnapshot {
  const { evidence, seen: _seen, evidenceOwnedByWorker: _owner, retainedShots: _retained, ...belief } = learner;
  return {
    ...belief,
    planets: learner.planets.map((planet) => ({ ...planet })),
    hole: learner.hole && { ...learner.hole },
    hypotheses: learner.hypotheses.map((fit) => ({ ...fit, planets: fit.planets.map((planet) => ({ ...planet })),
      hole: fit.hole && { ...fit.hole } })),
    recovery: { ...learner.recovery, sampleCounts: [...learner.recovery.sampleCounts], retainedShotIds: [...learner.recovery.retainedShotIds] },
    predictionTrend: [...learner.predictionTrend],
    probeHistory: learner.probeHistory.map((shot) => ({ ...shot })),
    retainedShots: learner.retainedShots ?? evidence.length,
  };
}

export function restoreExperimentalLearnerSnapshot(snapshot: ExperimentalLearnerSnapshot): ExperimentalLearner {
  const { startingKnowledge, ...belief } = snapshot;
  const learner = createExperimentalLearner(startingKnowledge);
  Object.assign(learner, belief);
  learner.evidenceOwnedByWorker = true;
  return learner;
}

function boundedRate(rate: number): number {
  return Number.isFinite(rate) ? clamp(rate, 0, 1) : 0;
}

function massDeviation(planet: PlanetEstimate): number {
  return planet.massStandardDeviation ?? planet.mass * (planet.massUncertainty ?? 0.16);
}

function holeDeviation(fit: Pick<GravityFit, 'holeMass' | 'holeMassUncertainty' | 'holeMassStandardDeviation'>): number {
  return fit.holeMassStandardDeviation ?? (fit.holeMass ?? 0) * (fit.holeMassUncertainty ?? 0);
}

/** Mixture of weak gravity knowledge and the public density prior, not aim error. */
function startingMass(knownMass: number, knownRelativeDeviation: number, knowledge: number): { mass: number; deviation: number } {
  return {
    mass: knowledge * knownMass,
    deviation: Math.sqrt(knowledge * (knownMass * knownRelativeDeviation) ** 2
      + (1 - knowledge) * knownMass ** 2 + knowledge * (1 - knowledge) * knownMass ** 2),
  };
}

function syncGeometry(learner: ExperimentalLearner, visible: ExperimentalWorld, inferLostMass = true): void {
  const geometry = JSON.stringify([visible.width, visible.height, visible.visiblePlanets, visible.visibleHole,
    visible.planetCount, visible.hasHole, visible.holeRadius, visible.mode, visible.epoch]);
  if (geometry === learner.geometry) return;
  const known = new Map(learner.planets.map((planet) => [planet.id, planet]));
  if (visible.visiblePlanets !== undefined) {
    learner.planets = visible.visiblePlanets.map((planet) => {
      const previous = known.get(planet.id);
      const prior = startingMass(clamp(planet.radius ** 3 * 1.025, MIN_PLANET_MASS, MAX_PLANET_MASS),
        0.55 / Math.sqrt(12) / 1.025, learner.startingKnowledge);
      const mass = previous?.mass ?? prior.mass;
      const deviation = previous ? massDeviation(previous) : prior.deviation;
      return { ...planet, mass, massStandardDeviation: deviation, massUncertainty: deviation / Math.max(mass, 1) };
    });
  } else {
    const previous = learner.planets;
    const lost = Math.max(0, previous.length - visible.planetCount);
    if (inferLostMass && lost && visible.mode === 'horizon' && visible.hasHole) {
      transferAnonymousMass(learner, lost, HORIZON.FEED);
    }
    // Anonymous sources cannot be matched across drift or a changing source count.
    // Keep their exchangeable mass belief, not invented survivor identities/positions.
    const mean = previous.length ? previous.reduce((sum, planet) => sum + planet.mass, 0) / previous.length : null;
    const deviation = previous.length ? Math.sqrt(previous.reduce((sum, planet) => sum
      + (planet.mass - mean!) ** 2 + massDeviation(planet) ** 2, 0) / previous.length) : null;
    // Integrate the public radius draw r=16+44*u^1.4 and independent mean density.
    const expectedMass = 1.025 * (16 ** 3 + 3 * 16 ** 2 * 44 / 2.4 + 3 * 16 * 44 ** 2 / 3.8 + 44 ** 3 / 5.2);
    const prior = startingMass(expectedMass, 1, learner.startingKnowledge);
    learner.planets = fitGravity([], visible.planetCount, visible.width, visible.height, false).planets
      .map((planet) => ({ ...planet, mass: mean ?? prior.mass, massStandardDeviation: deviation ?? prior.deviation,
        massUncertainty: (deviation ?? prior.deviation) / Math.max(mean ?? prior.mass, 1) }));
  }
  learner.hypotheses = [];
  learner.hole = visible.hasHole ? { ...(visible.visibleHole ?? { x: visible.width / 2, y: visible.height / 2, radius: visible.holeRadius }) } : undefined;
  if (visible.hasHole && learner.holeMass === null) {
    const prior = startingMass(HORIZON.START_MASS, 0, learner.startingKnowledge);
    learner.holeMass = prior.mass;
    learner.holeMassStandardDeviation = prior.deviation;
    learner.holeMassUncertainty = prior.deviation / Math.max(prior.mass, 1);
  } else if (!visible.hasHole) {
    learner.holeMass = null;
    learner.holeMassUncertainty = undefined;
    learner.holeMassStandardDeviation = undefined;
  }
  // Historical paths belonged to the previous field; keep mass beliefs, not stale residuals.
  learner.evidence = [];
  if (learner.evidenceOwnedByWorker) learner.retainedShots = 0;
  learner.samples = 0;
  learner.rms = null;
  learner.initialRms = null;
  learner.condition = null;
  learner.predictionRms = null;
  learner.predictionSamples = 0;
  learner.fitMs = 0;
  learner.recovery = emptyRecovery();
  learner.predictionTrend = [];
  learner.probeHistory = [];
  learner.lastRecoveryShot = learner.observedShots - 3;
  learner.geometry = geometry;
}

/** A hidden count loss gives exchangeable mass evidence, not survivor IDs. */
function transferAnonymousMass(learner: ExperimentalLearner, lost: number, feed: number): void {
  const planets = learner.planets.filter((planet) => planet.id === undefined);
  if (!planets.length || learner.holeMass === null) return;
  const count = Math.min(lost, planets.length);
  const mean = planets.reduce((sum, planet) => sum + planet.mass, 0) / planets.length;
  const subsetVariance = planets.reduce((sum, planet) => sum + (planet.mass - mean) ** 2, 0) / planets.length;
  const measurementVariance = planets.reduce((sum, planet) => sum + massDeviation(planet) ** 2, 0) / planets.length;
  const variance = holeDeviation(learner) ** 2 + feed ** 2 * count
    * (measurementVariance + subsetVariance * (planets.length - count) / Math.max(1, planets.length - 1));
  learner.holeMass = clamp(learner.holeMass + count * mean * feed, 0, 4_000_000);
  learner.holeMassStandardDeviation = Math.sqrt(variance);
  learner.holeMassUncertainty = Math.sqrt(variance) / Math.max(learner.holeMass, 1);
}

/** Apply public collapse rules to estimated masses, then observe the new geometry. */
export function advanceExperimentalWorld(
  learner: ExperimentalLearner,
  observedWorld: ExperimentalWorld,
  transition: { holeMassGain: number; swallowedPlanetIds: readonly number[]; feed: number },
): void {
  const swallowed = new Set(transition.swallowedPlanetIds);
  let gain = transition.holeMassGain;
  let variance = holeDeviation(learner) ** 2;
  for (const planet of learner.planets) {
    if (planet.id !== undefined && swallowed.has(planet.id)) {
      gain += planet.mass * transition.feed;
      variance += (massDeviation(planet) * transition.feed) ** 2;
    }
  }
  if (learner.holeMass !== null) {
    learner.holeMass = clamp(learner.holeMass + gain, 0, 4_000_000);
    learner.holeMassStandardDeviation = Math.sqrt(variance);
    learner.holeMassUncertainty = Math.sqrt(variance) / Math.max(learner.holeMass, 1);
  }
  if (observedWorld.visiblePlanets === undefined) {
    transferAnonymousMass(learner, Math.max(0, learner.planets.length - observedWorld.planetCount), transition.feed);
  }
  learner.geometry = null;
  syncGeometry(learner, observedWorld, false);
}

/** Retrieve the current belief without searching an aim or assimilating a trajectory. */
export function experimentalLearnerFit(learner: ExperimentalLearner, visible: ExperimentalWorld): ExperimentalLearnerFit {
  syncGeometry(learner, visible);
  return {
    planets: learner.planets.map((planet) => ({ ...planet })), holeMass: learner.holeMass,
    hole: learner.hole && { ...learner.hole }, samples: learner.samples,
    holeMassUncertainty: learner.holeMassUncertainty,
    holeMassStandardDeviation: learner.holeMassStandardDeviation, startingKnowledge: learner.startingKnowledge,
    initialRms: learner.initialRms, rms: learner.rms,
    improvement: learner.rms === null || learner.initialRms === null ? null : learner.initialRms - learner.rms,
    validationRms: learner.recovery.candidateValidationRms, validationSamples: learner.recovery.validationSamples,
    condition: learner.condition, fitMs: learner.fitMs, observedShots: learner.observedShots,
    learnedShots: learner.learnedShots, retainedShots: learner.retainedShots ?? learner.evidence.length, learningRate: learner.learningRate,
    predictionRms: learner.predictionRms, predictionSamples: learner.predictionSamples,
    recovery: learner.recovery,
  };
}

function shotKey(shot: ExperimentalShot): string {
  if (shot.shotId !== undefined) return `id:${shot.shotId}`;
  // Full observed content prevents double-consumption after callers clone/prune trails.
  return `${shot.angle}:${shot.power}:${shot.points.join(',')}`;
}

export function observeExperimentalShot(
  learner: ExperimentalLearner, shot: ExperimentalShot, observedWorld: ExperimentalWorld, learningRate: number,
): void {
  if (learner.evidenceOwnedByWorker) throw new Error('Worker-owned evidence must be observed through ExperimentalWorkerClient');
  syncGeometry(learner, observedWorld);
  const key = shotKey(shot);
  if (learner.seen.has(key)) return;
  learner.seen.add(key);
  learner.observedShots++;
  const rate = boundedRate(learningRate);
  learner.learningRate = rate;
  learner.fitMs = 0;
  const observations = observationsOf([shot], REFINED_FIT_SAMPLES);
  const oldFit = experimentalLearnerFit(learner, observedWorld);
  learner.predictionSamples = observations.length;
  learner.predictionRms = observations.length ? rmsOf(observedResiduals(oldFit, [shot], observations, observedWorld)) : null;
  const valid = observations.length > 0 && shot.points.every(Number.isFinite)
    && Number.isFinite(shot.angle) && Number.isFinite(shot.power);
  if (valid && learner.predictionRms !== null) {
    learner.predictionTrend.push(learner.predictionRms);
    if (learner.predictionTrend.length > 4) learner.predictionTrend.shift();
  }
  const trend = learner.predictionTrend.slice(-3);
  const stalled = trend.length === 3 && trend.every((rms) => rms > 12)
    && (trend[2] >= trend[0] * 0.85 || trend.every((rms) => rms > 40));
  const stagnationCount = stalled ? learner.recovery.stagnationCount + 1 : 0;
  learner.recovery = { ...emptyRecovery(), proposedLearningRate: rate, stagnationCount, stalled,
    updateStatus: valid && !rate ? 'frozen' : 'unavailable' };
  if (valid) {
    const midpoint = Math.floor(shot.points.length / 4) * 2;
    learner.probeHistory.push({ angle: shot.angle, power: shot.power, x: shot.points[midpoint], y: shot.points[midpoint + 1] });
    if (learner.probeHistory.length > 12) learner.probeHistory.shift();
  }
  if (!rate || !valid) return;
  const started = performance.now();
  const retained = retainRepresentativeShots([...learner.evidence.map((entry) => entry.shot),
    { ...shot, points: [...shot.points] }], 12);
  learner.evidence = retained.map((entry) => ({ shot: entry }));
  const shots = retained;
  const samples = observationsOf(shots, REFINED_FIT_SAMPLES);
  const before = rmsOf(observedResiduals(oldFit, shots, samples, observedWorld));
  const recovery = observedWorld.visiblePlanets === undefined && learner.observedShots - learner.lastRecoveryShot >= 3
    && (stalled || learner.predictionRms! > 40);
  if (recovery) learner.lastRecoveryShot = learner.observedShots;
  const localProposals = new Set<GravityFit>();
  const fitEvidence = (data: readonly ExperimentalShot[], prior: GravityFit, recover: boolean): GravityFit[] =>
    observedWorld.visiblePlanets === undefined
      ? fitCandidates(data, observedWorld.planetCount, observedWorld.width, observedWorld.height,
        observedWorld.hasHole, observedWorld.rules, REFINED_FIT_SAMPLES, prior, recover).map((candidate) => {
        if (candidate.local) localProposals.add(candidate.fit);
        return candidate.fit;
      })
      : [fitVisibleMasses(prior, data, observedWorld)];
  // Validation candidates never see the newest trajectory. Only the subsequent refit may use it.
  let validationFit: GravityFit | null = null;
  let validationRms: number | null = null;
  if (shots.length >= 2) {
    validationFit = fitEvidence(shots.slice(0, -1), oldFit, false)[0];
    validationRms = rmsOf(observedResiduals(validationFit, [shot], observations, observedWorld));
  }
  const hypotheses = fitEvidence(shots, oldFit, recovery);
  const evidenceFit = hypotheses[0];
  let proposedRate = rate;
  if (validationRms !== null && validationRms > learner.predictionRms! + Math.max(12, learner.predictionRms! * 0.35)) {
    proposedRate *= 0.25;
  }
  // Missing uncertainty is not a certainty measurement. Alignment happens before every interpolation.
  const assimilate = (evidence: GravityFit, alpha: number): GravityFit => {
    const matched = localProposals.has(evidence) ? evidence.planets
      : matchEstimatedSources(oldFit.planets, evidence.planets, observedWorld.width, observedWorld.height);
    const evidenceDeviation = evidence.holeMassStandardDeviation === undefined && evidence.holeMassUncertainty === undefined
      ? holeDeviation(oldFit) : holeDeviation(evidence);
    const holeMass = oldFit.holeMass === null || evidence.holeMass === null ? null
      : oldFit.holeMass + alpha * (evidence.holeMass - oldFit.holeMass);
    const holeMassStandardDeviation = holeMass === null ? undefined
      : (1 - alpha) * holeDeviation(oldFit) + alpha * evidenceDeviation
        + alpha * (1 - alpha) * Math.abs(evidence.holeMass! - oldFit.holeMass!);
    return { ...evidence,
      planets: oldFit.planets.map((planet, index) => {
        const estimate = matched[index];
        if (!estimate) return { ...planet };
        const mass = planet.mass + alpha * (estimate.mass - planet.mass);
        const deviation = (1 - alpha) * massDeviation(planet) + alpha * massDeviation(estimate)
          + alpha * (1 - alpha) * Math.abs(estimate.mass - planet.mass);
        return { ...planet, x: planet.id === undefined ? planet.x + alpha * (estimate.x - planet.x) : planet.x,
          y: planet.id === undefined ? planet.y + alpha * (estimate.y - planet.y) : planet.y,
          mass, massStandardDeviation: deviation, massUncertainty: deviation / Math.max(mass, 1) };
      }), holeMass, holeMassStandardDeviation,
      holeMassUncertainty: holeMassStandardDeviation === undefined ? undefined : holeMassStandardDeviation / Math.max(holeMass!, 1),
    };
  };
  let updated: GravityFit = oldFit;
  let after = before;
  let effectiveRate = 0;
  let selectedEvidence = evidenceFit;
  for (let attempt = 0; attempt < 6; attempt++) {
    const alpha = proposedRate / 2 ** attempt;
    let accepted: GravityFit | null = null;
    let bestRms = before;
    for (const hypothesis of hypotheses) {
      const candidate = assimilate(hypothesis, alpha);
      const rms = rmsOf(observedResiduals(candidate, shots, samples, observedWorld));
      if (validationFit) {
        const newestRms = rmsOf(observedResiduals(candidate, [shot], observations, observedWorld));
        if (!Number.isFinite(newestRms) || newestRms > learner.predictionRms! + Math.max(12, learner.predictionRms! * 0.35)) continue;
      }
      if (Number.isFinite(rms) && rms <= bestRms && (!accepted || rms < bestRms)) {
        accepted = candidate; bestRms = rms; selectedEvidence = hypothesis;
      }
    }
    if (accepted) { updated = accepted; after = bestRms; effectiveRate = alpha; break; }
  }
  // Rejected minima remain alternative hypotheses, never silently replace the selected belief.
  learner.hypotheses = [{ ...updated }, ...hypotheses.filter((candidate) => !localProposals.has(candidate) &&
    parameterDistance(parametersFromFit(updated, observedWorld.width, observedWorld.height, observedWorld.hasHole),
      parametersFromFit(candidate, observedWorld.width, observedWorld.height, observedWorld.hasHole),
      observedWorld.width, observedWorld.height, observedWorld.hasHole) >= 12)].slice(0, HYPOTHESIS_COUNT);
  learner.planets = updated.planets;
  learner.holeMass = updated.holeMass;
  learner.holeMassUncertainty = updated.holeMassUncertainty;
  learner.holeMassStandardDeviation = updated.holeMassStandardDeviation;
  learner.learnedShots += effectiveRate;
  learner.initialRms = before;
  learner.rms = after;
  learner.condition = selectedEvidence.condition;
  learner.samples = samples.length;
  const sampleCounts = shots.map(() => 0);
  for (const sample of samples) sampleCounts[sample.shot]++;
  learner.recovery = { optimizerInitialRms: selectedEvidence.initialRms, optimizerFinalRms: selectedEvidence.rms,
    beliefBeforeRms: before, beliefAfterRms: after, candidateValidationRms: validationRms,
    previousValidationRms: validationFit ? learner.predictionRms : null,
    validationSamples: validationFit ? observations.length : 0, proposedLearningRate: rate, effectiveLearningRate: effectiveRate,
    updateStatus: !effectiveRate ? 'rejected' : effectiveRate < rate ? 'reduced' : 'accepted', sampleCounts,
    retainedShotIds: shots.map((entry) => entry.shotId ?? null), stagnationCount, stalled,
    recoveryStarts: recovery ? 2 : 0, matchedSources: Math.min(oldFit.planets.length, evidenceFit.planets.length) };
  learner.fitMs = performance.now() - started;
}

/** Replays through Shot itself: inference and game share gravity, bounce and Euler rules. */
function observedResiduals(fit: GravityFit, shots: readonly ExperimentalShot[], observations: readonly Observation[], visible: ExperimentalWorld): Float64Array {
  const residuals = new Float64Array(observations.length * 2);
  const world = estimatedWorld(visible, fit);
  // End collisions are excluded from observations; candidate fields must not truncate a replay.
  world.planets = world.planets.map((planet) => ({ ...planet, radius: 0 }));
  if (world.hole) world.hole = { ...world.hole, radius: 0 };
  let observation = 0;
  for (let index = 0; index < shots.length; index++) {
    const first = observation;
    while (observation < observations.length && observations[observation].shot === index) observation++;
    if (first === observation) continue;
    const data = shots[index];
    const dir = aimDirection(data.angle);
    world.ships = [{ x: data.points[0] - dir.x * PHYSICS.MUZZLE, y: data.points[1] - dir.y * PHYSICS.MUZZLE, alive: false }];
    const last = observations[observation - 1].point;
    const replay = new Shot(world, 0, data.angle, data.power, { bounce: visible.rules.bounce, timeLimit: (last * 2 + 1) * PHYSICS.DT });
    let wanted = first;
    for (let step = 1; step <= last * 2; step++) {
      replay.step();
      // Lost shots must still integrate until the observed last sample.
      replay.end = null;
      if (step % 2 === 0 && wanted < observation && observations[wanted].point === step / 2) {
        const offset = observations[wanted].point * 2;
        residuals[wanted * 2] = clamp(replay.x - data.points[offset], -1e6, 1e6);
        residuals[wanted * 2 + 1] = clamp(replay.y - data.points[offset + 1], -1e6, 1e6);
        if (!Number.isFinite(residuals[wanted * 2])) residuals[wanted * 2] = 1e6;
        if (!Number.isFinite(residuals[wanted * 2 + 1])) residuals[wanted * 2 + 1] = 1e6;
        wanted++;
      }
    }
  }
  return residuals;
}

/** Known visible positions remove 2K ill-conditioned coordinates from the inverse problem. */
function fitVisibleMasses(prior: GravityFit, shots: readonly ExperimentalShot[], visible: ExperimentalWorld): GravityFit {
  const count = prior.planets.length;
  const size = count + (prior.holeMass === null ? 0 : 1);
  const observations = observationsOf(shots, REFINED_FIT_SAMPLES);
  if (!size || !observations.length) {
    const rms = observations.length ? rmsOf(observedResiduals(prior, shots, observations, visible)) : null;
    return { ...prior, samples: observations.length, initialRms: rms, rms };
  }
  const lower = new Float64Array(size);
  const upper = new Float64Array(size);
  const start = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    const radius = prior.planets[i]?.radius;
    lower[i] = Math.log(i < count ? Math.max(MIN_PLANET_MASS, radius === undefined ? MIN_PLANET_MASS : radius ** 3 * 0.75) : 10_000);
    upper[i] = Math.log(i < count ? Math.min(MAX_PLANET_MASS, radius === undefined ? MAX_PLANET_MASS : radius ** 3 * 1.3) : 4_000_000);
    start[i] = clamp(Math.log(Math.max(1, i < count ? prior.planets[i].mass : prior.holeMass!)), lower[i], upper[i]);
  }
  const map = (params: Float64Array): GravityFit => ({ ...prior,
    planets: prior.planets.map((planet, i) => ({ ...planet, mass: Math.exp(params[i]) })),
    holeMass: prior.holeMass === null ? null : Math.exp(params[count]),
  });
  const residual = (params: Float64Array) => observedResiduals(map(params), shots, observations, visible);
  const initialRms = rmsOf(observedResiduals(prior, shots, observations, visible));
  let best = start;
  let bestRms = rmsOf(residual(start));
  let condition: number | null = null;
  for (let seed = 0; seed < 3; seed++) {
    const params = new Float64Array(start);
    if (seed) for (let i = 0; i < size; i++) params[i] = lower[i] + (upper[i] - lower[i]) * (seed === 1 ? 0.25 : 0.75);
    let errors = residual(params);
    let rms = rmsOf(errors);
    let damping = 1e-4;
    for (let iteration = 0; iteration < 14; iteration++) {
      const derivatives: Float64Array[] = [];
      for (let i = 0; i < size; i++) {
        const plus = new Float64Array(params);
        const minus = new Float64Array(params);
        plus[i] += 1e-4;
        minus[i] -= 1e-4;
        const a = residual(plus);
        const b = residual(minus);
        for (let row = 0; row < a.length; row++) a[row] = (a[row] - b[row]) / 2e-4;
        derivatives.push(a);
      }
      const normal = new Float64Array(size * size);
      const gradient = new Float64Array(size);
      let smallest = Infinity;
      let largest = 0;
      for (let i = 0; i < size; i++) {
        for (let row = 0; row < errors.length; row++) gradient[i] -= derivatives[i][row] * errors[row];
        for (let j = 0; j < size; j++) for (let row = 0; row < errors.length; row++) normal[i * size + j] += derivatives[i][row] * derivatives[j][row];
        const diagonal = normal[i * size + i];
        smallest = Math.min(smallest, diagonal);
        largest = Math.max(largest, diagonal);
        normal[i * size + i] += damping * Math.max(diagonal, 1e-8);
      }
      condition = smallest > 0 ? Math.min(1e15, largest / smallest) : 1e15;
      const delta = solve(normal, gradient, size);
      if (!delta) break;
      const candidate = new Float64Array(params);
      for (let i = 0; i < size; i++) candidate[i] = clamp(params[i] + clamp(delta[i], -0.4, 0.4), lower[i], upper[i]);
      const nextErrors = residual(candidate);
      const nextRms = rmsOf(nextErrors);
      if (nextRms < rms) {
        params.set(candidate); errors = nextErrors; rms = nextRms; damping = Math.max(1e-9, damping * 0.25);
        if (rms < 1e-5) break;
      } else damping = Math.min(1e8, damping * 10);
    }
    if (rms < bestRms) { best = params; bestRms = rms; }
    if (bestRms < 1e-5) break;
  }
  // Invert the full sensitivity matrix: nearby planets can trade mass and are not
  // independently identified merely because every diagonal is large.
  const errors = residual(best);
  const variance = Math.max(0.25, bestRms * bestRms);
  const derivatives: Float64Array[] = [];
  for (let i = 0; i < size; i++) {
    const plus = new Float64Array(best);
    const minus = new Float64Array(best);
    plus[i] += 1e-4;
    minus[i] -= 1e-4;
    const a = residual(plus);
    const b = residual(minus);
    for (let row = 0; row < a.length; row++) a[row] = (a[row] - b[row]) / 2e-4;
    derivatives.push(a);
  }
  const precision = new Float64Array(size * size);
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      for (let row = 0; row < errors.length; row++) precision[i * size + j] += derivatives[i][row] * derivatives[j][row] / variance;
    }
    const relativeDeviation = i < count ? Math.max(0.16, massDeviation(prior.planets[i]) / Math.exp(best[i])) : 1;
    precision[i * size + i] += 1 / (relativeDeviation * relativeDeviation);
  }
  const uncertainty = Array.from({ length: size }, (_, i) => {
    const unit = new Float64Array(size);
    unit[i] = 1;
    const inverseColumn = solve(precision, unit, size);
    return Math.sqrt(Math.max(0, inverseColumn?.[i] ?? (i < count ? 0.16 ** 2 : 1)));
  });
  const fitted = map(best);
  fitted.planets = fitted.planets.map((planet, i) => ({ ...planet, massUncertainty: uncertainty[i], massStandardDeviation: planet.mass * uncertainty[i] }));
  return { ...fitted, holeMassUncertainty: prior.holeMass === null ? undefined : uncertainty[count],
    holeMassStandardDeviation: fitted.holeMass === null ? undefined : fitted.holeMass * uncertainty[count],
    initialRms, rms: bestRms, samples: observations.length, condition };
}

/** Search precision is independent of the rate; only the retained gravity belief changes. */
export function* planExperimentalShot(
  visible: ExperimentalWorld,
  opts: Omit<PlanOptions, 'level'> & { learner?: ExperimentalLearner; learningRate?: number; startingKnowledge?: number },
  report: (fit: GravityFit, decision: ExperimentalDecision) => void,
): Generator<void, Aim> {
  const maxPower = opts.maxPower ?? AIM.MAX_POWER;
  opts = { ...opts, maxPower, fixedPower: opts.fixedPower === null ? null : Math.min(opts.fixedPower, maxPower) };
  const learner = opts.learner ?? createExperimentalLearner(opts.startingKnowledge);
  const rate = boundedRate(opts.learningRate ?? 1);
  if (!learner.evidenceOwnedByWorker) {
    for (const shot of visible.shots) observeExperimentalShot(learner, shot, visible, rate);
  }
  const fit = experimentalLearnerFit(learner, visible);
  learner.learningRate = rate;
  // Densities are independent, bounded public-distribution draws, not a common scale.
  const worlds = [estimatedWorld(visible, fit)];
  const uncertain = learner.recovery.stalled || fit.planets.some((planet) => (planet.massUncertainty ?? 0.16) > 1e-5) || (fit.holeMassUncertainty ?? 0) > 1e-5;
  for (let sample = 0; sample < (uncertain ? 8 : 0); sample++) {
    worlds.push(estimatedWorld(visible, {
      ...fit,
      planets: fit.planets.map((planet, i) => {
        const quantile = fract((sample + 1) * (0.75487766625 + i * 0.38196601125));
        const publicLower = planet.radius === undefined ? MIN_PLANET_MASS : Math.max(MIN_PLANET_MASS, planet.radius ** 3 * 0.75);
        const lower = Math.min(planet.mass, publicLower);
        const upper = planet.radius === undefined ? MAX_PLANET_MASS : Math.min(MAX_PLANET_MASS, planet.radius ** 3 * 1.3);
        const deviation = learner.recovery.stalled ? Math.max(massDeviation(planet), planet.mass * 0.35) : massDeviation(planet);
        return { ...planet, mass: clamp(planet.mass + (quantile - 0.5) * Math.sqrt(12) * deviation, lower, upper) };
      }),
      holeMass: fit.holeMass === null ? null : clamp(fit.holeMass + (fract((sample + 0.5) / 8 + 0.27) - 0.5)
        * Math.sqrt(12) * holeDeviation(fit), Math.min(fit.holeMass, 10_000), 4_000_000),
    }));
  }
  const alternativeStart = worlds.length;
  for (const hypothesis of learner.hypotheses.slice(1)) worlds.push(estimatedWorld(visible, hypothesis));
  // Exact launch outcomes are immutable for these belief worlds and rules.
  // Keep the cache inside one shot plan: never reuse it after new evidence.
  const outcomes = new Map<World, Map<number, Map<number, ShotOutcome>>>();
  const friends = opts.friends ?? [];
  const simulateAim = (world: World, angle: number, power: number): ShotOutcome => {
    let angles = outcomes.get(world);
    let powers = angles?.get(angle);
    const cached = powers?.get(power);
    if (cached) return cached;
    const outcome = simulateShot(world, visible.shooter, angle, power, opts.rules, friends);
    if (!angles) outcomes.set(world, angles = new Map());
    if (!powers) angles.set(angle, powers = new Map());
    powers.set(power, outcome);
    return outcome;
  };
  const candidates: Aim[] = [];
  // Preserve a full MAP search irrespective of uncertainty or assimilation rate.
  const searchIndices = [...(uncertain ? [0, 1, 3, 5, 7] : [0]),
    ...worlds.slice(alternativeStart).map((_, index) => alternativeStart + index)];
  for (const index of searchIndices) candidates.push(yield* planShot(worlds[index], visible.shooter, {
    ...opts, effort: Math.max(1, opts.effort ?? 1) * (index === 0 ? 1.5 : 0.5),
    level: 'hard', noiseFree: true, optimizeHitPower: true,
  }));
  let robust = bestRobustAim(candidates, worlds, visible.shooter, opts, simulateAim);
  for (const angleStep of [1, 0.25, 0.06]) {
    if (!robust) break;
    const center = robust.aim;
    const neighbours: Aim[] = [center];
    for (const angleOffset of [-2, -1, 0, 1, 2]) {
      for (const powerOffset of opts.fixedPower === null ? [-2, 0, 2] : [0]) {
        neighbours.push({ angle: normalizeAngle(center.angle + angleOffset * angleStep),
          power: opts.fixedPower ?? Math.min(maxPower, Math.max(5, center.power + powerOffset * angleStep)) });
      }
    }
    robust = bestRobustAim(neighbours, worlds, visible.shooter, opts, simulateAim) ?? robust;
    yield;
  }
  // Repeated actual prediction failures override hypothetical exploit hits, without relaxing safety.
  let probe = learner.recovery.stalled || !robust || robust.hitRate === 0
    ? coverageProbe(worlds, visible, opts, simulateAim, undefined, learner.probeHistory, learner.recovery.stalled) : null;
  let recoverySearch: ExperimentalDecision['recoverySearch'];
  if (learner.recovery.stalled && !probe) {
    // Offset the original angle grid and broaden power only when power is not fixed.
    // Six angles per slice bound uninterrupted production-physics work.
    const powers = opts.fixedPower === null ? [...new Set([20, 35, 55, 75, 95].map((power) => Math.min(power, maxPower)))] : [opts.fixedPower];
    let searched = 0;
    for (let start = 0; start < 72 && !probe; start += 6) {
      const angles = Array.from({ length: 6 }, (_, index) => (start + index) * 5 + 2.5);
      probe = coverageProbe(worlds, visible, opts, simulateAim, powers, learner.probeHistory, true, angles);
      searched += angles.length * powers.length;
      yield;
    }
    recoverySearch = { additionalCandidates: searched,
      outcome: probe ? 'expanded-probe' : 'no-safe-informative-launch' };
  }
  const probeResult = probe ? bestRobustAim([probe], worlds, visible.shooter, opts, simulateAim) : null;
  const useProbe = probeResult !== null && (learner.recovery.stalled || !robust || probeResult.hitRate > robust.hitRate
    || (robust.hitRate === 0 && probeResult.meanMiss < robust.meanMiss));
  if (useProbe) robust = probeResult;
  if (!robust) {
    const self = visible.ships[visible.shooter];
    const angles = Array.from({ length: 72 }, (_, index) => index * 5);
    for (const ship of visible.ships) {
      if (ship === self || !ship.alive) continue;
      angles.push(normalizeAngle(Math.atan2(ship.y - self.y, self.x - ship.x) * 180 / Math.PI));
    }
    const powers = opts.fixedPower === null ? [...new Set([5, 20, 50, 100].map((power) => Math.min(power, maxPower)))] : [opts.fixedPower];
    const escapes = angles.flatMap((angle) => powers.map((power) => ({ angle, power })));
    candidates.push(...escapes);
    robust = bestRobustAim(escapes, worlds, visible.shooter, opts, simulateAim);
    // If the searched launches all collide with self/friends, expose the least-risk
    // outcome rather than relabeling a previously rejected launch as safe.
    if (!robust) robust = bestRobustAim(candidates, worlds, visible.shooter, opts, simulateAim, true);
    yield;
  }
  const decision: ExperimentalDecision = {
    kind: useProbe ? (learner.observedShots ? 'probe' : 'initialProbe')
      : !learner.recovery.stalled && robust && robust.unsafeRate === 0 && robust.hitRate > 0 ? 'exploit' : 'fallback',
    hypothesisCount: worlds.length,
    hitRate: robust?.hitRate ?? 0,
    unsafeRate: robust?.unsafeRate ?? 1,
    worstMiss: Number.isFinite(robust?.worstMiss) ? robust!.worstMiss : Math.hypot(visible.width, visible.height),
    observedShots: learner.observedShots, learnedShots: learner.learnedShots, retainedShots: learner.retainedShots ?? learner.evidence.length,
    learningRate: rate, startingKnowledge: learner.startingKnowledge, predictionRms: learner.predictionRms, predictionSamples: learner.predictionSamples,
    recovery: learner.recovery,
    recoverySearch,
  };
  report({ ...fit, learningRate: rate }, decision);
  return robust!.aim;
}

export interface ExperimentalDecision {
  kind: 'exploit' | 'initialProbe' | 'probe' | 'fallback';
  hypothesisCount: number;
  hitRate: number;
  /** Fraction of plausible worlds where the selected shot hits self or a friend. */
  unsafeRate: number;
  worstMiss: number;
  observedShots: number;
  learnedShots: number;
  retainedShots: number;
  learningRate: number;
  startingKnowledge: number;
  predictionRms: number | null;
  predictionSamples: number;
  recovery?: ExperimentalRecoveryDiagnostics;
  /** Present only after the stalled learner exhausted its standard coverage grid. */
  recoverySearch?: { additionalCandidates: number; outcome: 'expanded-probe' | 'no-safe-informative-launch' };
}

function fitCandidates(shots: readonly ExperimentalShot[], count: number, width: number, height: number, hasHole: boolean, rules: Pick<ShotRules, 'bounce'>, sampleCap: number, prior?: GravityFit, recovery = false): FitCandidate[] {
  const seed = fitAccelerationSeed(shots, count, width, height, hasHole);
  const observations = observationsOf(shots, sampleCap);
  if (observations.length === 0) return [{ fit: seed, params: parametersFromFit(seed, width, height, hasHole) }];

  const baseParams = parametersFromFit(seed, width, height, hasHole);
  const starts = prior
    ? [parametersFromFit(prior, width, height, hasHole), baseParams]
    : Array.from({ length: FORWARD_STARTS }, (_, index) => perturbStart(baseParams, count, hasHole, index));
  if (recovery) for (let index = 2; index < 4; index++) {
    const separated = perturbStart(baseParams, count, hasHole, index);
    for (let source = 0; source < count; source++) {
      separated[source * 3] = fract(index * 0.61803398875 + source * 0.38196601125);
      separated[source * 3 + 1] = fract(index * 0.41421356237 + source * 0.75487766625);
    }
    starts.push(separated);
  }
  const candidates: FitCandidate[] = [];
  for (const [index, start] of starts.entries()) {
    const initialRms = rmsOf(forwardResiduals(start, shots, observations, count, width, height, hasHole, rules.bounce, prior?.hole));
    const optimized = optimizeForward(start, shots, observations, count, width, height, hasHole, rules.bounce, prior?.hole, prior !== undefined && index === 0);
    const fit = fitFromParameters(optimized.params, count, width, height, hasHole);
    const local = prior !== undefined && index === 0;
    // Keep warm-start source correspondence: rematching masses can swap nearby sources.
    if (local) {
      const ordered = [...prior.planets].sort((a, b) => a.x - b.x || a.y - b.y || a.mass - b.mass);
      fit.planets = prior.planets.map((planet) => fit.planets[ordered.indexOf(planet)]);
    }
    const holeMassStandardDeviation = hasHole
      ? hiddenHoleDeviation(optimized, shots, observations, count, width, height, rules.bounce, prior?.hole) : undefined;
    candidates.push({
      params: optimized.params,
      local,
      fit: {
        ...fit, hole: prior?.hole, samples: observations.length, initialRms, rms: optimized.rms, improvement: initialRms - optimized.rms,
        holeMassStandardDeviation,
        holeMassUncertainty: holeMassStandardDeviation === undefined ? undefined : holeMassStandardDeviation / Math.max(fit.holeMass!, 1),
        validationRms: null, validationSamples: 0, condition: optimized.condition, fitMs: 0,
      },
    });
  }
  const local = candidates.find((candidate) => candidate.local);
  candidates.sort((a, b) => a.fit.rms! - b.fit.rms!);
  const diverse = diverseCandidates(candidates.filter((candidate) => !candidate.local), width, height, hasHole);
  // Local interpolation proposals need not qualify as near-optimal uncertainty alternatives.
  return local ? [...diverse, local] : diverse;
}

/** Marginalize hidden positions and planet masses instead of reading one sensitivity diagonal. */
function hiddenHoleDeviation(
  optimized: ForwardResult, shots: readonly ExperimentalShot[], observations: readonly Observation[],
  count: number, width: number, height: number, bounce: boolean,
  holePosition?: { x: number; y: number },
): number | undefined {
  const { params, rms } = optimized;
  const size = params.length;
  const hole = size - 1;
  const mass = Math.exp(params[hole]);
  const variance = Math.max(0.25, rms * rms);
  const derivatives: Float64Array[] = [];
  for (let i = 0; i < size; i++) {
    const plus = new Float64Array(params);
    const minus = new Float64Array(params);
    plus[i] += 1e-4;
    minus[i] -= 1e-4;
    const a = forwardResiduals(plus, shots, observations, count, width, height, true, bounce, holePosition);
    const b = forwardResiduals(minus, shots, observations, count, width, height, true, bounce, holePosition);
    // Coordinates span the field, planet log-masses have a broad unit prior,
    // and hole mass uses the same absolute public prior as starting knowledge.
    const scale = i === hole ? HORIZON.START_MASS / mass : 1;
    for (let row = 0; row < a.length; row++) a[row] = (a[row] - b[row]) * scale / 2e-4;
    derivatives.push(a);
  }
  const precision = new Float64Array(size * size);
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      for (let row = 0; row < optimized.residuals.length; row++) {
        precision[i * size + j] += derivatives[i][row] * derivatives[j][row] / variance;
      }
    }
    // Prior regularization retains uncertainty when the trail cannot identify a source.
    precision[i * size + i] += 1;
  }
  const unit = new Float64Array(size);
  unit[hole] = 1;
  const inverseColumn = solve(precision, unit, size);
  const marginalVariance = inverseColumn?.[hole];
  return marginalVariance !== undefined && Number.isFinite(marginalVariance) && marginalVariance > 0
    ? HORIZON.START_MASS * Math.sqrt(Math.min(1, marginalVariance)) : undefined;
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
    if (!duplicate && candidate.fit.rms! <= candidates[0].fit.rms! + Math.max(4, candidates[0].fit.rms! * 0.35)) kept.push(candidate);
    if (kept.length === HYPOTHESIS_COUNT) break;
  }
  return kept.length ? kept : [candidates[0]];
}

function parameterDistance(a: Float64Array, b: Float64Array, width: number, height: number, hasHole: boolean): number {
  const count = Math.floor(a.length / 3);
  const previous = fitFromParameters(a, count, width, height, hasHole).planets;
  const matched = matchEstimatedSources(previous, fitFromParameters(b, count, width, height, hasHole).planets, width, height);
  let sum = 0;
  for (let i = 0; i < previous.length; i++) {
    const candidate = matched[i];
    if (!candidate) return Infinity;
    sum += Math.hypot(previous[i].x - candidate.x, previous[i].y - candidate.y)
      + Math.abs(Math.log(Math.max(previous[i].mass, 1) / Math.max(candidate.mass, 1))) * 30;
  }
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


function fract(value: number): number {
  return value - Math.floor(value);
}

function observationsOf(shots: readonly ExperimentalShot[], sampleCap = MAX_FIT_SAMPLES): Observation[] {
  return balancedObservations(shots, sampleCap);
}

function fitAccelerationSeed(shots: readonly ExperimentalShot[], count: number, width: number, height: number, hasHole: boolean): GravityFit {
  const samples: AccelerationSample[] = [];
  for (const observation of observationsOf(shots, MAX_FIT_SAMPLES)) {
    if (observation.point < 2) continue;
    const shot = shots[observation.shot];
    const j = observation.point * 2;
    samples.push({
      x: shot.points[j], y: shot.points[j + 1],
      ax: (shot.points[j + 2] - 2 * shot.points[j] + shot.points[j - 2]) / (POINT_INTERVAL * POINT_INTERVAL),
      ay: (shot.points[j + 3] - 2 * shot.points[j + 1] + shot.points[j - 1]) / (POINT_INTERVAL * POINT_INTERVAL),
    });
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
  // A hidden map is an unordered set; canonical coordinates also make finite differences permutation invariant.
  const planets = [...fit.planets].sort((a, b) => a.x - b.x || a.y - b.y || a.mass - b.mass);
  const params = new Float64Array(planets.length * 3 + (hasHole ? 1 : 0));
  for (let i = 0; i < planets.length; i++) {
    const planet = planets[i];
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
  holePosition?: { x: number; y: number },
  local = false,
): ForwardResult {
  const params = new Float64Array(start);
  let residuals = forwardResiduals(params, shots, observations, count, width, height, hasHole, bounce, holePosition);
  let rms = rmsOf(residuals);
  let damping = 1e-3;
  let condition: number | null = null;
  for (let iteration = 0; iteration < FORWARD_ITERATIONS; iteration++) {
    const parameterCount = params.length;
    const derivatives: Float64Array[] = [];
    for (let parameter = 0; parameter < parameterCount; parameter++) {
      const massParameter = parameter >= count * 3 || parameter % 3 === 2;
      const step = local ? (massParameter ? 0.001 : 0.0001) : (massParameter ? 0.04 : 0.004);
      const plus = new Float64Array(params);
      const minus = new Float64Array(params);
      plus[parameter] += step;
      minus[parameter] -= step;
      clampForwardParameters(plus, count, hasHole);
      clampForwardParameters(minus, count, hasHole);
      const plusResiduals = forwardResiduals(plus, shots, observations, count, width, height, hasHole, bounce, holePosition);
      const minusResiduals = forwardResiduals(minus, shots, observations, count, width, height, hasHole, bounce, holePosition);
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
    // A nearby warm start is an update direction, not a license to cross the field.
    let scale = 1;
    if (local) for (let i = 0; i < delta.length; i++) {
      const limit = i >= count * 3 || i % 3 === 2 ? 0.25 : 0.025;
      scale = Math.min(scale, limit / Math.max(limit, Math.abs(delta[i])));
    }
    const candidate = new Float64Array(params);
    let improved = false;
    for (let attempt = 0; attempt < 6; attempt++) {
      for (let i = 0; i < candidate.length; i++) candidate[i] = params[i] + delta[i] * scale / 2 ** attempt;
      clampForwardParameters(candidate, count, hasHole);
      const candidateResiduals = forwardResiduals(candidate, shots, observations, count, width, height, hasHole, bounce, holePosition);
      const candidateRms = rmsOf(candidateResiduals);
      if (Number.isFinite(candidateRms) && candidateRms < rms) {
        params.set(candidate);
        residuals = candidateResiduals;
        rms = candidateRms;
        improved = true;
        break;
      }
    }
    damping = improved ? Math.max(1e-8, damping * 0.3) : Math.min(1e8, damping * 10);
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
  holePosition?: { x: number; y: number },
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
      const field = fieldFromParameters(params, count, width, height, hasHole, x, y, holePosition);
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
          residuals[output++] = Number.isFinite(x) ? clamp(x - shot.points[offset], -1e6, 1e6) : 1e6;
          residuals[output++] = Number.isFinite(y) ? clamp(y - shot.points[offset + 1], -1e6, 1e6) : 1e6;
          wanted++;
        }
      }
    }
  }
  return residuals;
}

type RobustAim = { aim: Aim; hitRate: number; unsafeRate: number; worstMiss: number; meanMiss: number; centralHit: boolean };
type SimulateAim = (world: World, angle: number, power: number) => ShotOutcome;

function bestRobustAim(candidates: readonly Aim[], worlds: readonly World[], shooter: number,
  opts: Omit<PlanOptions, 'level'>, simulateAim: SimulateAim, allowUnsafe = false): RobustAim | null {
  const friends = opts.friends ?? [];
  let best: RobustAim | null = null;
  for (const aim of candidates) {
    let hits = 0;
    let worstMiss = 0;
    let meanMiss = 0;
    let centralHit = false;
    let unsafe = 0;
    for (const world of worlds) {
      const outcome = simulateAim(world, aim.angle, aim.power);
      const hit = outcome.end.kind === 'ship' && outcome.end.ship !== shooter && !friends.includes(outcome.end.ship);
      if (hit) hits++;
      if (world === worlds[0]) centralHit = hit;
      if (outcome.end.kind === 'ship' && (outcome.end.ship === shooter || friends.includes(outcome.end.ship))) unsafe++;
      worstMiss = Math.max(worstMiss, outcome.closest);
      meanMiss += hit ? 0 : Math.min(outcome.closest, Math.hypot(world.width, world.height));
    }
    if (unsafe && !allowUnsafe) continue;
    const candidate = { aim, hitRate: hits / worlds.length, unsafeRate: unsafe / worlds.length,
      worstMiss, meanMiss: meanMiss / worlds.length, centralHit };
    if (!best || candidate.unsafeRate < best.unsafeRate
      || (candidate.unsafeRate === best.unsafeRate && (candidate.hitRate > best.hitRate
        || (candidate.hitRate === best.hitRate && candidate.centralHit && !best.centralHit)
        || (candidate.hitRate === best.hitRate && candidate.centralHit === best.centralHit && candidate.meanMiss < best.meanMiss)))) best = candidate;
  }
  return best;
}

/** Pick a safe launch whose plausible trajectories disagree most at observed samples. */
function coverageProbe(
  worlds: readonly World[],
  visible: ExperimentalWorld,
  opts: Omit<PlanOptions, 'level'>,
  simulateAim: SimulateAim,
  probePowers?: readonly number[],
  history: readonly { angle: number; power: number; x: number; y: number }[] = [],
  stalled = false,
  probeAngles?: readonly number[],
): Aim | null {
  const self = worlds[0].ships[visible.shooter];
  const friends = opts.friends ?? [];
  const targets = worlds[0].ships.filter((ship, id) => id !== visible.shooter && ship.alive && !friends.includes(id));
  if (!targets.length) return null;
  const maxPower = opts.maxPower ?? AIM.MAX_POWER;
  const powers = opts.fixedPower === null
    ? [...new Set((probePowers ?? [35, 55, 75]).map((power) => Math.min(power, maxPower)))]
    : [Math.min(opts.fixedPower, maxPower)];
  let best: Aim | null = null;
  let bestScore = -Infinity;
  for (let turn = 0; turn < (probeAngles?.length ?? 20); turn++) {
    const target = targets[turn % targets.length];
    const direct = normalizeAngle((Math.atan2(-(target.y - self.y), target.x - self.x) * 180) / Math.PI);
    const angle = probeAngles?.[turn] ?? (turn < 16 ? normalizeAngle(direct + (turn - 7.5) * 15) : turn * 22.5);
    for (const power of powers) {
      const aimNovelty = history.length ? Math.min(...history.map((shot) =>
        Math.abs(((angle - shot.angle + 540) % 360) - 180) + Math.abs(power - shot.power) * 0.5)) : 90;
      if (stalled && aimNovelty < 8) continue;
      let unsafe = false;
      for (const world of worlds) {
        const outcome = simulateAim(world, angle, power);
        if (outcome.end.kind === 'ship' && (outcome.end.ship === visible.shooter || friends.includes(outcome.end.ship))) unsafe = true;
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
      let score = stalled ? aimNovelty * 3 : Math.max(0, 900 - Math.hypot(meanX - target.x, meanY - target.y));
      for (const path of paths) score += Math.hypot(path[middle][0] - meanX, path[middle][1] - meanY) * 4;
      if (history.length) score += Math.min(240, Math.min(...history.map((shot) =>
        Math.hypot(meanX - shot.x, meanY - shot.y)))) * 2;
      if (score > bestScore) {
        bestScore = score;
        best = { angle, power };
      }
    }
  }
  return best;
}

function probePath(world: World, shooter: number, angle: number, power: number, rules: ShotRules): [number, number][] {
  const shot = new Shot(world, shooter, angle, power, { ...rules, timeLimit: Math.min(rules.timeLimit, 5) });
  const path: [number, number][] = [];
  for (let step = 0; step < Math.round(Math.min(rules.timeLimit, 5) / PHYSICS.DT) && !shot.end; step++) {
    shot.step();
    if (step % 20 === 19 && !shot.end) path.push([shot.x, shot.y]);
  }
  return path;
}


function fieldFromParameters(params: Float64Array, count: number, width: number, height: number, hasHole: boolean, x: number, y: number, holePosition?: { x: number; y: number }): { ax: number; ay: number } {
  let ax = 0;
  let ay = 0;
  for (let i = 0; i < count; i++) {
    const dx = params[i * 3] * width - x;
    const dy = params[i * 3 + 1] * height - y;
    const d2 = dx * dx + dy * dy;
    const force = PHYSICS.G * Math.exp(params[i * 3 + 2]) / (d2 * Math.sqrt(d2));
    ax += force * dx;
    ay += force * dy;
  }
  if (hasHole) {
    const dx = (holePosition?.x ?? width / 2) - x;
    const dy = (holePosition?.y ?? height / 2) - y;
    const d2 = dx * dx + dy * dy;
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
    // Collision disks are observed geometry, never derived from inferred mass.
    planets: fit.planets.map((planet, i) => ({ ...planet, radius: planet.radius ?? 0, seed: planet.id ?? i, style: 'rocky', tint: '#ffffff' })),
    hole: fit.holeMass === null ? null : { x: fit.hole?.x ?? visible.visibleHole?.x ?? visible.width / 2, y: fit.hole?.y ?? visible.visibleHole?.y ?? visible.height / 2, radius: fit.hole?.radius ?? visible.holeRadius, mass: fit.holeMass },
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
