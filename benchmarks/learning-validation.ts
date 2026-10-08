import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { FIELD, HORIZON, PHYSICS } from '../src/config';
import {
  advanceExperimentalWorld, createExperimentalLearner, experimentalLearnerFit, observeExperimentalShot, planExperimentalShot,
  type ExperimentalLearner, type ExperimentalShot, type ExperimentalWorld, type GravityFit,
} from '../src/experimental-ai';
import { Shot, type World } from '../src/physics';
import { createRng } from '../src/rng';
import { codeFingerprint } from './ai-matrix';
import { generateWorld } from '../src/world';

const VALIDATION_RATES = [0, 0.1, 0.35, 1] as const;
const VALIDATION_KNOWLEDGE = [0, 1] as const;
const HISTORY_BUDGETS = [0, 1, 2, 4, 8] as const;
const RULES = { bounce: false, timeLimit: 60 };
const TRAINING_ANGLES = [-6, 6, -14, 14, -22, 22, -32, 32];
const PROBES = [{ angle: -10, power: 72 }, { angle: 10, power: 68 }, { angle: -26, power: 76 }, { angle: 26, power: 74 }, { angle: -42, power: 78 }, { angle: 42, power: 70 }];

export function validationWorld(index = 0): World {
  const layouts = [
    [{ x: 600, y: 510, radius: 34, density: 0.76 }],
    [{ x: 700, y: 280, radius: 38, density: 1.29 }],
    [{ x: 480, y: 550, radius: 30, density: 1.27 }, { x: 830, y: 250, radius: 35, density: 0.77 }],
  ];
  return {
    ...FIELD, version: 0, hole: null,
    ships: [{ x: 100, y: 400, alive: true }, { x: 1180, y: 400, alive: false }],
    planets: layouts[index].map((p, id) => ({ x: p.x, y: p.y, radius: p.radius, mass: p.density * p.radius ** 3, seed: id + 1, style: 'rocky' as const, tint: '#fff' })),
  };
}

/** The learner receives public geometry, never the world's masses or density. */
export function visibleWorld(world: World, epoch = world.version): ExperimentalWorld {
  return {
    width: world.width, height: world.height, ships: world.ships.map((ship) => ({ ...ship })), shooter: 0,
    planetCount: world.planets.length,
    visiblePlanets: world.planets.map(({ seed, x, y, radius }) => ({ id: seed, x, y, radius })),
    hasHole: world.hole !== null, holeRadius: world.hole?.radius ?? 0,
    visibleHole: world.hole ? { x: world.hole.x, y: world.hole.y, radius: world.hole.radius } : undefined,
    mode: world.hole ? 'horizon' : 'classic', epoch, rules: { bounce: false }, shots: [],
  };
}

export function recordShot(world: World, angle: number, power: number, shotId: number): ExperimentalShot {
  const shot = new Shot(world, 0, angle, power, RULES);
  const points = [shot.x, shot.y];
  for (let step = 1; !shot.end && step <= Math.ceil(RULES.timeLimit / PHYSICS.DT); step++) {
    shot.step();
    if (step % 2 === 0) points.push(shot.x, shot.y);
  }
  return { points, angle, power, shotId };
}

function predictionWorld(world: World, fit: GravityFit): World {
  return {
    width: world.width, height: world.height, version: world.version,
    ships: world.ships.map((ship) => ({ ...ship })),
    planets: fit.planets.map((p, index) => {
      const geometry = world.planets.find((planet) => planet.seed === p.id) ?? world.planets[index];
      if (p.radius === undefined && !geometry) throw new Error('Missing public planet geometry for prediction');
      return { ...p, radius: p.radius ?? geometry.radius, seed: p.id ?? index + 1, style: 'rocky' as const, tint: '#fff' };
    }),
    hole: fit.hole && fit.holeMass !== null ? { ...fit.hole, mass: fit.holeMass } : null,
  };
}

interface PredictionError { angle: number; power: number; trailRms: number; endpointError: number; samples: number; outcomeAgreement: boolean }

/** Compare equal simulation times, including early predicted collisions as a stopped path. */
function predictionError(world: World, fit: GravityFit, angle: number, power: number): PredictionError {
  const actual = new Shot(world, 0, angle, power, RULES);
  const predicted = new Shot(predictionWorld(world, fit), 0, angle, power, RULES);
  let squared = 0;
  let samples = 0;
  for (let step = 1; !actual.end && step <= Math.ceil(RULES.timeLimit / PHYSICS.DT); step++) {
    actual.step();
    predicted.step();
    if (step % 2 === 0 || actual.end) {
      squared += (actual.x - predicted.x) ** 2 + (actual.y - predicted.y) ** 2;
      samples++;
    }
  }
  while (!predicted.end) predicted.step();
  return {
    angle, power,
    trailRms: Math.sqrt(squared / Math.max(1, samples)),
    endpointError: Math.hypot(actual.x - predicted.x, actual.y - predicted.y), samples,
    outcomeAgreement: actual.end?.kind === predicted.end?.kind,
  };
}

export function heldOutErrors(world: World, learner: ExperimentalLearner): PredictionError[] {
  const fit = experimentalLearnerFit(learner, visibleWorld(world));
  return PROBES.map(({ angle, power }) => predictionError(world, fit, angle, power));
}

export function trainLearner(world: World, rate: number, budget: number, startingKnowledge = 1): ExperimentalLearner {
  const learner = createExperimentalLearner(startingKnowledge);
  const visible = visibleWorld(world);
  experimentalLearnerFit(learner, visible);
  for (let index = 0; index < budget; index++) {
    observeExperimentalShot(learner, recordShot(world, TRAINING_ANGLES[index], 65 + index % 3 * 5, index + 1), visible, rate);
  }
  return learner;
}

interface ValidationCell {
  scenario: number; rate: number; startingKnowledge: number; budget: number; errors: PredictionError[];
  observedShots: number; learnedShots: number; retainedShots: number;
}
export function quantile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) throw new Error('Cannot summarize an empty validation suite');
  const position = fraction * (sorted.length - 1);
  const lower = Math.floor(position);
  return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower);
}

/** Fixed unequal densities do not share a fitted density multiplier. */
export function independentDensityWorld(index = 0): World {
  const world = validationWorld(2);
  const layouts = [
    [{ x: 455, y: 555, radius: 30, density: 0.81 }, { x: 840, y: 245, radius: 35, density: 1.26 }, { x: 710, y: 605, radius: 27, density: 0.94 }],
    [{ x: 505, y: 585, radius: 32, density: 1.28 }, { x: 885, y: 215, radius: 29, density: 0.78 }, { x: 755, y: 590, radius: 26, density: 1.12 }],
  ];
  world.planets = layouts[index % layouts.length].map((planet, id) => ({
    x: planet.x, y: planet.y, radius: planet.radius, mass: planet.density * planet.radius ** 3,
    seed: id + 1, style: 'rocky', tint: '#fff',
  }));
  if (index > 0) world.hole = { x: 643, y: 427, radius: HORIZON.START_RADIUS, mass: HORIZON.START_MASS };
  return world;
}

function actualShotLearningSmoke(world = validationWorld(), seed = 99540717, startingKnowledge = 1) {
  world = { ...world, ships: world.ships.map((ship) => ({ ...ship, alive: true })) };
  const visible = visibleWorld(world);
  const learner = createExperimentalLearner(startingKnowledge);
  const frozen = createExperimentalLearner(startingKnowledge);
  const startingErrors = heldOutErrors(world, frozen);
  const rng = createRng(seed);
  const shots: { angle: number; power: number; points: number; predictionRms: number | null }[] = [];
  for (let attempt = 0; attempt < 4; attempt++) {
    const planner = planExperimentalShot(visible, { learner, learningRate: 1, rules: RULES, attempt, fixedPower: null, rng }, () => {});
    let planned = planner.next();
    while (!planned.done) planned = planner.next();
    const observation = recordShot(world, planned.value.angle, planned.value.power, attempt + 1);
    // Both beliefs receive exactly the same AI-chosen observations. Only the update rate differs.
    observeExperimentalShot(learner, observation, visible, 1);
    observeExperimentalShot(frozen, observation, visible, 0);
    const fit = experimentalLearnerFit(learner, visible);
    shots.push({ angle: planned.value.angle, power: planned.value.power, points: observation.points.length / 2, predictionRms: fit.predictionRms });
  }
  const fit = experimentalLearnerFit(learner, visible);
  const learnedErrors = heldOutErrors(world, learner);
  const frozenErrors = heldOutErrors(world, frozen);
  const learnedMedian = quantile(learnedErrors.map((error) => error.trailRms), 0.5);
  const frozenMedian = quantile(frozenErrors.map((error) => error.trailRms), 0.5);
  return {
    seed, startingKnowledge, learningRate: 1, frozenLearningRate: 0, shots, observedShots: fit.observedShots, learnedShots: fit.learnedShots, predictionSamples: fit.predictionSamples,
    startingErrors, learnedErrors, frozenErrors, learnedMedian, frozenMedian,
    improvementFraction: 1 - learnedMedian / Math.max(frozenMedian, 1e-12),
    frozenUnchanged: JSON.stringify(startingErrors) === JSON.stringify(frozenErrors),
    probesExcluded: shots.every((shot) => !PROBES.some((probe) => probe.angle === shot.angle && probe.power === shot.power)),
  };
}

/** Complete boundary exits are real shots, but contain no usable interior observations. */
export function lowInformationLearningCheck() {
  const world = independentDensityWorld(1);
  world.ships[0] = { x: -PHYSICS.OUT_MARGIN + 5, y: 400, alive: true };
  const visible = visibleWorld(world);
  const learner = createExperimentalLearner();
  const initialErrors = heldOutErrors(world, learner);
  const lengths: number[] = [];
  for (let attempt = 0; attempt < 4; attempt++) {
    const observation = recordShot(world, 180, 100, attempt + 1);
    lengths.push(observation.points.length / 2);
    observeExperimentalShot(learner, observation, visible, 1);
  }
  const fit = experimentalLearnerFit(learner, visible);
  return {
    lengths, observedShots: fit.observedShots, learnedShots: fit.learnedShots, retainedShots: fit.retainedShots,
    predictionSamples: fit.predictionSamples, predictionRms: fit.predictionRms,
    predictionsUnchanged: JSON.stringify(initialErrors) === JSON.stringify(heldOutErrors(world, learner)),
  };
}

/** Tiny remote paths can fit closely without identifying each source's mass. */
export function shortShotConfidenceCheck() {
  const world = independentDensityWorld(1);
  const remoteWorld = { ...world, ships: [{ x: -245, y: 400, alive: true }, world.ships[1]] };
  // The deadline lies between steps five and six, avoiding floating-point deadline ambiguity.
  const shortRules = { bounce: false, timeLimit: 5.5 * PHYSICS.DT };
  const learner = createExperimentalLearner();
  const visible = visibleWorld(remoteWorld);
  const lengths: number[] = [];
  const observations: ExperimentalShot[] = [];
  for (let attempt = 0; attempt < 4; attempt++) {
    const shot = new Shot(remoteWorld, 0, 180, 100, shortRules);
    const points = [shot.x, shot.y];
    for (let step = 1; step <= 6; step++) {
      if (shot.end) throw new Error('Short confidence fixture ended before its six physical steps');
      shot.step();
      if (step % 2 === 0) points.push(shot.x, shot.y);
    }
    if (shot.end?.kind !== 'timeout') throw new Error('Short confidence fixture did not complete its controlled observation window');
    const observation = { points, angle: 180, power: 100, shotId: attempt + 1 };
    observations.push(observation);
    lengths.push(points.length / 2);
    observeExperimentalShot(learner, observation, visible, 1);
  }
  const fit = experimentalLearnerFit(learner, visible);
  return {
    lengths, observations, observationSteps: 6, observationSeconds: 6 * PHYSICS.DT,
    observedShots: fit.observedShots, predictionSamples: fit.predictionSamples, trainingRms: fit.rms,
    massUncertainty: fit.planets.map((planet) => planet.massUncertainty ?? null),
    heldOutMedian: quantile(heldOutErrors(world, learner).map((error) => error.trailRms), 0.5),
  };
}

export const RECOVERY_ANGLES = [0.4, 0.8, 1.2, 1.6, -30, 30, -50, 50] as const;
const RECOVERY_PROBES = [-35, -10, 20, 45] as const;
/** Measured pre-recovery reference from .scratch/recovery-before.ts: same seed, 12s maximum,
 * declared 300px exit boundary and pooled Euclidean probes; not today's match boundary. */
export const RECOVERY_BASELINE_RMS = 64.12803234206731;
export const RECOVERY_STUDY_EXIT_BOUNDARY = 300;
const RECOVERY_RULES = { bounce: false, timeLimit: 12 };

export function recoveryWorld(): World {
  const world = generateWorld(7139, { minPlanets: 7, maxPlanets: 7, players: 2, blackHole: false });
  world.ships[1].alive = false;
  return world;
}

export function recoveryVisibleWorld(world: World): ExperimentalWorld {
  return { ...visibleWorld(world), visiblePlanets: undefined };
}

/** Stop the historical study at its declared boundary without changing production physics. */
function stepRecoveryShot(shot: Shot, world: World, exitBoundary: number): void {
  shot.step();
  if (!shot.end && (shot.x < -exitBoundary || shot.x > world.width + exitBoundary
    || shot.y < -exitBoundary || shot.y > world.height + exitBoundary)) shot.terminate({ kind: 'lost' });
}

export function recordRecoveryShot(world: World, angle: number, power: number, shotId: number, exitBoundary: number = PHYSICS.OUT_MARGIN): ExperimentalShot {
  const shot = new Shot(world, 0, angle, power, RECOVERY_RULES);
  const points = [shot.x, shot.y];
  for (let step = 1; step <= Math.ceil(RECOVERY_RULES.timeLimit / PHYSICS.DT) && !shot.end; step++) {
    stepRecoveryShot(shot, world, exitBoundary);
    if (step % 2 === 0) points.push(shot.x, shot.y);
  }
  return { angle, power, shotId, points };
}

interface RecoveryProbeError { angle: number; power: number; squared: number; samples: number; trailRms: number }

/** Hidden predictions use estimated point sources, never true source positions or radii. */
export function recoveryPredictionErrors(world: World, fit: GravityFit, exitBoundary: number = PHYSICS.OUT_MARGIN): RecoveryProbeError[] {
  const belief: World = {
    width: world.width, height: world.height, version: world.version,
    ships: world.ships.map((ship) => ({ ...ship })), hole: null,
    planets: fit.planets.map((planet, index) => ({ ...planet, radius: 0, seed: index, style: 'rocky', tint: '#fff' })),
  };
  return RECOVERY_PROBES.map((angle) => {
    const actual = new Shot(world, 0, angle, 70, RECOVERY_RULES);
    const predicted = new Shot(belief, 0, angle, 70, RECOVERY_RULES);
    let squared = 0;
    let samples = 0;
    for (let step = 1; step <= Math.ceil(RECOVERY_RULES.timeLimit / PHYSICS.DT) && !actual.end; step++) {
      stepRecoveryShot(actual, world, exitBoundary);
      stepRecoveryShot(predicted, belief, exitBoundary);
      if (step % 2 === 0) {
        squared += (actual.x - predicted.x) ** 2 + (actual.y - predicted.y) ** 2;
        samples++;
      }
    }
    return { angle, power: 70, squared, samples, trailRms: Math.sqrt(squared / Math.max(1, samples)) };
  });
}

/** Historical 300px study by default; pass the current margin for the production-boundary proof. */
export function runHiddenRecoveryValidation(exitBoundary = RECOVERY_STUDY_EXIT_BOUNDARY) {
  const world = recoveryWorld();
  const visible = recoveryVisibleWorld(world);
  const learner = createExperimentalLearner(0.72);
  const frozen = createExperimentalLearner(0.72);
  const errors = (state: ExperimentalLearner) => recoveryPredictionErrors(world, experimentalLearnerFit(state, visible), exitBoundary);
  const aggregate = (probes: readonly RecoveryProbeError[]) => Math.sqrt(probes.reduce((sum, probe) => sum + probe.squared, 0)
    / Math.max(1, probes.reduce((sum, probe) => sum + probe.samples, 0)));
  const priorErrors = errors(learner);
  const stages = RECOVERY_ANGLES.map((angle, index) => {
    const observation = recordRecoveryShot(world, angle, 65, index + 1, exitBoundary);
    const before = experimentalLearnerFit(learner, visible);
    observeExperimentalShot(learner, observation, visible, 0.54);
    observeExperimentalShot(frozen, observation, visible, 0);
    const fit = experimentalLearnerFit(learner, visible);
    const probes = errors(learner);
    return { shotId: index + 1, angle, power: 65, points: observation.points.length / 2,
      errors: probes, heldOutRms: aggregate(probes), initialRms: fit.initialRms, beliefRms: fit.rms,
      improvement: fit.improvement, predictionRms: fit.predictionRms, observedShots: fit.observedShots,
      learnedShots: fit.learnedShots, learnedIncrement: fit.learnedShots - before.learnedShots,
      retainedShots: fit.retainedShots, recovery: fit.recovery };
  });
  const finalErrors = errors(learner);
  const frozenErrors = errors(frozen);
  const priorRms = aggregate(priorErrors);
  const finalRms = aggregate(finalErrors);
  const diagnosticsMeaningful = stages.every(({ recovery, initialRms, beliefRms, improvement, learnedIncrement }, index) =>
    recovery !== undefined && recovery.beliefBeforeRms !== null && recovery.beliefAfterRms !== null
    && recovery.optimizerInitialRms !== null && Number.isFinite(recovery.optimizerInitialRms)
    && recovery.optimizerFinalRms !== null && Number.isFinite(recovery.optimizerFinalRms)
    && initialRms !== null && beliefRms !== null
    && Number.isFinite(recovery.beliefBeforeRms) && Number.isFinite(recovery.beliefAfterRms)
    && initialRms === recovery.beliefBeforeRms && beliefRms === recovery.beliefAfterRms
    && improvement !== null && Math.abs(improvement - (initialRms - beliefRms)) < 1e-9
    && Math.abs(learnedIncrement - recovery.effectiveLearningRate) < 1e-9
    && recovery.sampleCounts.reduce((sum, count) => sum + count, 0) > 0
    && recovery.sampleCounts.every((count) => count > 0)
    && recovery.retainedShotIds.length === recovery.sampleCounts.length
    && (recovery.updateStatus === 'accepted' ? recovery.effectiveLearningRate === recovery.proposedLearningRate
      : recovery.updateStatus === 'reduced' ? recovery.effectiveLearningRate > 0 && recovery.effectiveLearningRate < recovery.proposedLearningRate
        : recovery.updateStatus === 'rejected' && recovery.effectiveLearningRate === 0)
    && (index === 0 ? recovery.candidateValidationRms === null && recovery.validationSamples === 0
      : recovery.candidateValidationRms !== null && Number.isFinite(recovery.candidateValidationRms)
        && recovery.previousValidationRms !== null && Number.isFinite(recovery.previousValidationRms) && recovery.validationSamples > 0));
  const updatesNonworsening = stages.every(({ recovery }) => recovery !== undefined
    && recovery.beliefBeforeRms !== null && recovery.beliefAfterRms !== null
    && recovery.beliefAfterRms <= recovery.beliefBeforeRms + 1e-7
    && recovery.effectiveLearningRate >= 0 && recovery.effectiveLearningRate <= recovery.proposedLearningRate);
  const baselineRms = exitBoundary === RECOVERY_STUDY_EXIT_BOUNDARY ? RECOVERY_BASELINE_RMS : null;
  const baselineNonregressing = baselineRms === null ? null : finalRms <= baselineRms;
  return { seed: 7139, planetCount: 7, startingKnowledge: 0.72, learningRate: 0.54,
    rules: { ...RECOVERY_RULES, exitBoundary },
    scenario: exitBoundary === RECOVERY_STUDY_EXIT_BOUNDARY ? 'historical-300px-study' : 'current-production-boundary',
    priorErrors, finalErrors, frozenErrors, priorRms, finalRms, improvementFraction: 1 - finalRms / priorRms, stages,
    baselineRms, baselineNonregressing, predictionMetric: 'pooled-sample-weighted-euclidean-trail-rms',
    baselineComparability: baselineRms === null ? 'The 64.128px historical reference used a 300px exit boundary; different truth and stopped-prediction sample horizons are not comparable.' : 'Identical 300px exit boundary, 12s maximum, seed, observations and excluded probes.',
    diagnosticsMeaningful, updatesNonworsening, frozenUnchanged: JSON.stringify(priorErrors) === JSON.stringify(frozenErrors),
    probesExcluded: RECOVERY_ANGLES.every((angle: number) => !RECOVERY_PROBES.some((probe) => probe === angle)) };
}

export function runLearningValidation() {
  const fingerprint = codeFingerprint();
  const cells: ValidationCell[] = [];
  for (let scenario = 0; scenario < 3; scenario++) {
    const world = validationWorld(scenario);
    for (const startingKnowledge of VALIDATION_KNOWLEDGE) for (const rate of VALIDATION_RATES) {
      for (const budget of HISTORY_BUDGETS) {
        const learner = trainLearner(world, rate, budget, startingKnowledge);
        const fit = experimentalLearnerFit(learner, visibleWorld(world));
        cells.push({ scenario, rate, startingKnowledge, budget, errors: heldOutErrors(world, learner), observedShots: fit.observedShots, learnedShots: fit.learnedShots, retainedShots: fit.retainedShots });
      }
    }
  }
  const subset = (rate: number, budget: number, startingKnowledge = 1) => cells.filter((cell) => cell.rate === rate && cell.budget === budget && cell.startingKnowledge === startingKnowledge).flatMap((cell) => cell.errors);
  const median = (rate: number, budget: number) => quantile(subset(rate, budget).map((error) => error.trailRms), 0.5);
  const best = subset(1, 8);
  const frozen = cells.filter((cell) => cell.rate === 0);
  const frozenUnchanged = frozen.every((cell) => {
    const baseline = cells.find((other) => other.scenario === cell.scenario && other.startingKnowledge === cell.startingKnowledge && other.rate === 0 && other.budget === 0)!;
    return cell.learnedShots === 0 && cell.errors.every((error, index) => Math.abs(error.trailRms - baseline.errors[index].trailRms) < 1e-9);
  });
  const finalRateMedians = VALIDATION_RATES.map((rate) => ({ rate, startingKnowledge: 1, trailRms: median(rate, 8) }));
  const zeroKnowledgeRateMedians = VALIDATION_RATES.map((rate) => ({ rate, startingKnowledge: 0, trailRms: quantile(subset(rate, 8, 0).map((error) => error.trailRms), 0.5) }));
  const equalStartingBeliefs = cells.filter((cell) => cell.budget === 0).every((cell) => {
    const baseline = cells.find((other) => other.scenario === cell.scenario && other.startingKnowledge === cell.startingKnowledge && other.rate === 0 && other.budget === 0)!;
    return JSON.stringify(cell.errors) === JSON.stringify(baseline.errors);
  });
  const duplicateWorld = validationWorld();
  const duplicateLearner = trainLearner(duplicateWorld, 1, 1);
  const duplicateBefore = experimentalLearnerFit(duplicateLearner, visibleWorld(duplicateWorld));
  const duplicatePredictions = heldOutErrors(duplicateWorld, duplicateLearner);
  observeExperimentalShot(duplicateLearner, recordShot(duplicateWorld, TRAINING_ANGLES[0], 65, 1), visibleWorld(duplicateWorld), 1);
  const duplicateAfter = experimentalLearnerFit(duplicateLearner, visibleWorld(duplicateWorld));
  const idempotent = duplicateAfter.observedShots === duplicateBefore.observedShots && duplicateAfter.learnedShots === duplicateBefore.learnedShots
    && JSON.stringify(heldOutErrors(duplicateWorld, duplicateLearner)) === JSON.stringify(duplicatePredictions);
  const horizonWorld = validationWorld(2);
  horizonWorld.hole = { x: 667, y: 382, radius: 16, mass: HORIZON.START_MASS };
  const horizonLearner = trainLearner(horizonWorld, 1, 4);
  const horizonFrozen = trainLearner(horizonWorld, 0, 4);
  const horizonBefore = experimentalLearnerFit(horizonLearner, visibleWorld(horizonWorld));
  const swallowed = horizonWorld.planets[0];
  const nextWorld: World = {
    ...horizonWorld, version: 1,
    planets: [{ ...horizonWorld.planets[1], x: horizonWorld.planets[1].x - 18, y: horizonWorld.planets[1].y + 12 }],
    hole: { ...horizonWorld.hole, radius: 23, mass: horizonWorld.hole.mass + HORIZON.MASS_PER_VOLLEY + HORIZON.FEED * swallowed.mass },
  };
  advanceExperimentalWorld(horizonLearner, visibleWorld(nextWorld), { holeMassGain: HORIZON.MASS_PER_VOLLEY, swallowedPlanetIds: [swallowed.seed], feed: HORIZON.FEED });
  advanceExperimentalWorld(horizonFrozen, visibleWorld(nextWorld), { holeMassGain: HORIZON.MASS_PER_VOLLEY, swallowedPlanetIds: [swallowed.seed], feed: HORIZON.FEED });
  const horizonAfter = experimentalLearnerFit(horizonLearner, visibleWorld(nextWorld));
  const transition = {
    retainedShots: horizonAfter.retainedShots,
    preservedEvidence: horizonAfter.observedShots === horizonBefore.observedShots && horizonAfter.learnedShots === horizonBefore.learnedShots,
    geometryMatches: horizonAfter.planets.length === 1 && horizonAfter.planets[0].x === nextWorld.planets[0].x && horizonAfter.planets[0].y === nextWorld.planets[0].y,
    learnedErrors: heldOutErrors(nextWorld, horizonLearner),
    frozenErrors: heldOutErrors(nextWorld, horizonFrozen),
  };
  const actualShots = actualShotLearningSmoke();
  const actualShotSuite = [actualShots, actualShotLearningSmoke(independentDensityWorld(), 99540718), actualShotLearningSmoke(independentDensityWorld(1), 99540719)];
  const actualLearnedMedian = quantile(actualShotSuite.flatMap((cell) => cell.learnedErrors.map((error) => error.trailRms)), 0.5);
  const actualFrozenMedian = quantile(actualShotSuite.flatMap((cell) => cell.frozenErrors.map((error) => error.trailRms)), 0.5);
  const zeroKnowledgeActualShotSuite = [actualShotLearningSmoke(validationWorld(), 99540717, 0), actualShotLearningSmoke(independentDensityWorld(), 99540718, 0), actualShotLearningSmoke(independentDensityWorld(1), 99540719, 0)];
  const zeroKnowledgeActualLearnedMedian = quantile(zeroKnowledgeActualShotSuite.flatMap((cell) => cell.learnedErrors.map((error) => error.trailRms)), 0.5);
  const zeroKnowledgeActualFrozenMedian = quantile(zeroKnowledgeActualShotSuite.flatMap((cell) => cell.frozenErrors.map((error) => error.trailRms)), 0.5);
  const lowInformation = lowInformationLearningCheck();
  const shortShotConfidence = shortShotConfidenceCheck();
  const hiddenRecovery = runHiddenRecoveryValidation();
  const productionRecovery = runHiddenRecoveryValidation(PHYSICS.OUT_MARGIN);
  const gates = [
    { name: 'hidden-recovery-honest-diagnostics', passed: hiddenRecovery.diagnosticsMeaningful, actual: hiddenRecovery.stages, target: 'finite optimizer and same-stage belief diagnostics, excluded-newest validation, effective accepted evidence' },
    { name: 'hidden-recovery-safe-updates', passed: hiddenRecovery.updatesNonworsening, actual: hiddenRecovery.stages, target: 'no accepted same-sample belief objective increase' },
    { name: 'hidden-recovery-held-out-decrease', passed: hiddenRecovery.probesExcluded && hiddenRecovery.frozenUnchanged && hiddenRecovery.finalRms <= hiddenRecovery.priorRms * 0.25, actual: { priorRms: hiddenRecovery.priorRms, finalRms: hiddenRecovery.finalRms, improvementFraction: hiddenRecovery.improvementFraction }, target: 'at least 75% lower excluded seven-hidden-source prediction error with frozen reference unchanged' },
    { name: 'hidden-recovery-baseline-nonregression', passed: hiddenRecovery.probesExcluded && hiddenRecovery.baselineNonregressing === true, actual: { finalRms: hiddenRecovery.finalRms, baselineRms: hiddenRecovery.baselineRms, exitBoundary: hiddenRecovery.rules.exitBoundary, metric: hiddenRecovery.predictionMetric }, target: `final pooled Euclidean trail RMS at most ${RECOVERY_BASELINE_RMS}px, the measured pre-recovery reference with identical 300px study boundary, observations and probes` },
    { name: 'production-hidden-recovery-held-out-decrease', passed: productionRecovery.probesExcluded && productionRecovery.frozenUnchanged && productionRecovery.diagnosticsMeaningful && productionRecovery.updatesNonworsening && productionRecovery.finalRms <= productionRecovery.priorRms * 0.5, actual: productionRecovery, target: 'at least 50% lower excluded seven-hidden-source pooled Euclidean trail RMS with current production boundary, frozen reference unchanged and nonworsening identical-sample updates' },
    { name: 'frozen-rate-zero', passed: frozenUnchanged, actual: frozenUnchanged, target: true },
    { name: 'rate-independent-starting-beliefs', passed: equalStartingBeliefs, actual: equalStartingBeliefs, target: true },
    { name: 'zero-knowledge-evidence-improves-held-out-median', passed: zeroKnowledgeRateMedians[3].trailRms <= zeroKnowledgeRateMedians[0].trailRms * 0.75, actual: zeroKnowledgeRateMedians, target: 'at least 25% improvement at rate1 against frozen rate0 with identical zero starting knowledge' },
    { name: 'zero-knowledge-aggregate-rate-order', passed: zeroKnowledgeRateMedians.every((cell, index) => index === 0 || cell.trailRms <= zeroKnowledgeRateMedians[index - 1].trailRms + 1e-7), actual: zeroKnowledgeRateMedians, target: 'non-increasing median error with the same starting knowledge' },
    { name: 'zero-knowledge-actual-planner-shot-learning', passed: zeroKnowledgeActualShotSuite.every((cell) => cell.observedShots === 4 && cell.learnedShots > 0 && cell.predictionSamples > 0 && cell.frozenUnchanged && cell.probesExcluded) && zeroKnowledgeActualShotSuite[0].improvementFraction >= 0.25 && zeroKnowledgeActualLearnedMedian <= zeroKnowledgeActualFrozenMedian * 0.75, actual: { scenarios: zeroKnowledgeActualShotSuite, aggregateRatio: zeroKnowledgeActualLearnedMedian / Math.max(zeroKnowledgeActualFrozenMedian, 1e-12) }, target: 'same zero-knowledge prior, observations and held-out probes improve at least 25%' },
    { name: 'repeat-observation-idempotent', passed: idempotent, actual: idempotent, target: true },
    { name: 'transition-does-not-pool-old-field', passed: transition.retainedShots === 0 && transition.preservedEvidence && transition.geometryMatches, actual: transition, target: 'zero old-field trails with preserved estimates and current geometry' },
    { name: 'transition-improves-held-out-median', passed: quantile(transition.learnedErrors.map((error) => error.trailRms), 0.5) < quantile(transition.frozenErrors.map((error) => error.trailRms), 0.5), actual: quantile(transition.learnedErrors.map((error) => error.trailRms), 0.5), target: quantile(transition.frozenErrors.map((error) => error.trailRms), 0.5) },
    { name: 'actual-planner-shot-learning', passed: actualShotSuite.every((cell) => cell.observedShots === 4 && cell.learnedShots > 0 && cell.predictionSamples > 0 && cell.frozenUnchanged && cell.probesExcluded && cell.shots.every((shot) => shot.predictionRms !== null && Number.isFinite(shot.predictionRms))) && actualShots.improvementFraction >= 0.25 && actualLearnedMedian <= actualFrozenMedian * 0.75, actual: { scenarios: actualShotSuite, aggregateRatio: actualLearnedMedian / Math.max(actualFrozenMedian, 1e-12) }, target: 'same held-out probes improve at least 25% in curated Classic and fixed-suite aggregate after four real AI-chosen observations' },
    { name: 'low-information-is-not-confidence', passed: lowInformation.observedShots === 4 && lowInformation.learnedShots === 0 && lowInformation.retainedShots === 0 && lowInformation.predictionSamples === 0 && lowInformation.predictionRms === null && lowInformation.predictionsUnchanged, actual: lowInformation, target: 'completed shots without usable samples do not learn or report prediction confidence' },
    { name: 'short-shot-fit-does-not-identify-masses', passed: shortShotConfidence.observedShots === 4 && shortShotConfidence.predictionSamples > 0 && shortShotConfidence.predictionSamples <= 16 && shortShotConfidence.trainingRms !== null && shortShotConfidence.trainingRms < 1 && shortShotConfidence.massUncertainty.every((uncertainty) => uncertainty !== null && uncertainty >= 0.05) && shortShotConfidence.heldOutMedian > 0.1, actual: shortShotConfidence, target: 'subpixel short-shot residual retains mass uncertainty and does not certify held-out accuracy' },
    { name: 'evidence-improves-held-out-median', passed: median(1, 8) <= median(0, 8) * 0.75, actual: median(1, 8) / Math.max(median(0, 8), 1e-12), target: 0.75 },
    { name: 'more-history-improves-held-out-median', passed: median(1, 8) < median(1, 1), actual: median(1, 8) - median(1, 1), target: 0 },
    { name: 'aggregate-rate-order', passed: finalRateMedians.every((cell, index) => index === 0 || cell.trailRms <= finalRateMedians[index - 1].trailRms + 1e-7), actual: finalRateMedians, target: 'non-increasing median error' },
    { name: 'future-trail-median-at-most-two-pixels', passed: median(1, 8) <= 2, actual: median(1, 8), target: 2 },
    { name: 'future-endpoint-p95-within-five-percent-diagonal', passed: quantile(best.map((error) => error.endpointError), 0.95) <= Math.hypot(FIELD.width, FIELD.height) * 0.05, actual: quantile(best.map((error) => error.endpointError), 0.95), target: Math.hypot(FIELD.width, FIELD.height) * 0.05 },
  ];
  return { suite: 'production-held-out-v3', codeFingerprint: fingerprint, rules: RULES, rates: VALIDATION_RATES, startingKnowledge: VALIDATION_KNOWLEDGE, historyBudgets: HISTORY_BUDGETS, gates, passed: gates.every((gate) => gate.passed), finalRateMedians, zeroKnowledgeRateMedians, cells, transition, actualShots, actualShotSuite, zeroKnowledgeActualShotSuite, lowInformation, shortShotConfidence, hiddenRecovery, productionRecovery, limitations: ['Visible geometry suite and one deterministic seven-hidden-source world studied at historical and production boundaries, not global hidden-map recovery.', 'Historical 64.128px reference applies only to the declared 300px study boundary; production-boundary samples have no comparable historical reference.', 'Held-out probes are excluded from all training.', 'Outcome agreement is shot termination agreement, not optimal planner-action agreement.', 'Map identifiability and global gravity recovery are not established by this suite.', 'Rates are compared at identical starting knowledge. Different starting-knowledge settings are never pooled.', 'Match-level strength requires the independent side-swapped benchmark matrix.'] };
}

function main() {
  const args = process.argv.slice(2);
  const jsonArgument = args.find((argument) => argument.startsWith('--json='));
  if (args.some((argument) => !argument.startsWith('--json=')) || args.filter((argument) => argument.startsWith('--json=')).length > 1 || jsonArgument === '--json=') {
    throw new Error('Usage: npm run bench:learning -- [--json=path]');
  }
  const report = runLearningValidation();
  if (jsonArgument) writeFileSync(jsonArgument.slice('--json='.length), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Learning validation: ${report.suite}; ${report.passed ? 'PASS' : 'FAIL'} (${report.gates.filter((gate) => gate.passed).length}/${report.gates.length} gates)`);
  console.log(`Code identity: ${report.codeFingerprint.algorithm}:${report.codeFingerprint.digest}; exact sources: ${report.codeFingerprint.sources.join(', ')}`);
  for (const gate of report.gates) {
    console.log(`  ${gate.passed ? 'PASS' : 'FAIL'} ${gate.name}`);
    if (!gate.passed && (typeof gate.actual === 'number' || typeof gate.actual === 'boolean')) console.log(`    actual=${gate.actual}; target=${JSON.stringify(gate.target)}`);
  }
  console.log('Held-out predictions (pixels; pooled fixed-layout probes, not independent match evidence):');
  for (const startingKnowledge of report.startingKnowledge) for (const rate of report.rates) {
    const errors = report.cells.filter((cell) => cell.rate === rate && cell.budget === 8 && cell.startingKnowledge === startingKnowledge).flatMap((cell) => cell.errors);
    console.log(`  rate=${rate} knowledge=${startingKnowledge} history=8: trail RMS p50/p95=${quantile(errors.map((error) => error.trailRms), 0.5).toFixed(3)}/${quantile(errors.map((error) => error.trailRms), 0.95).toFixed(3)}`);
  }
  const recovery = report.hiddenRecovery;
  console.log(`Hidden recovery ${recovery.scenario} seed=${recovery.seed}, sources=${recovery.planetCount}, exit boundary=${recovery.rules.exitBoundary}px: independent trail RMS ${recovery.priorRms.toFixed(3)} -> ${recovery.finalRms.toFixed(3)}px; improvement=${(recovery.improvementFraction * 100).toFixed(1)}%; safe updates=${recovery.updatesNonworsening}; baseline=${recovery.baselineRms?.toFixed(3)}px (${recovery.baselineNonregressing ? 'nonregressing' : 'REGRESSION'})`);
  for (const stage of recovery.stages) console.log(`  shot=${stage.shotId} angle=${stage.angle}: held-out=${stage.heldOutRms.toFixed(3)}px; belief=${stage.initialRms?.toFixed(3)} -> ${stage.beliefRms?.toFixed(3)}px; rate=${stage.recovery?.effectiveLearningRate}/${stage.recovery?.proposedLearningRate} ${stage.recovery?.updateStatus}; stalled=${stage.recovery?.stalled}`);
  const productionRecovery = report.productionRecovery;
  console.log(`Hidden recovery ${productionRecovery.scenario}, exit boundary=${productionRecovery.rules.exitBoundary}px: pooled Euclidean trail RMS ${productionRecovery.priorRms.toFixed(3)} -> ${productionRecovery.finalRms.toFixed(3)}px; improvement=${(productionRecovery.improvementFraction * 100).toFixed(1)}%; safe updates=${productionRecovery.updatesNonworsening}. ${productionRecovery.baselineComparability}`);
  console.log('Actual AI-chosen shots (same observations and held-out probes for learned/frozen beliefs):');
  for (const suite of [report.actualShotSuite, report.zeroKnowledgeActualShotSuite]) {
    for (const cell of suite) console.log(`  seed=${cell.seed} knowledge=${cell.startingKnowledge}: shots=${cell.shots.length}; observed/learned=${cell.observedShots}/${cell.learnedShots}; prediction samples=${cell.predictionSamples}; learned/frozen trail RMS p50=${cell.learnedMedian.toFixed(3)}/${cell.frozenMedian.toFixed(3)}; improvement=${(cell.improvementFraction * 100).toFixed(1)}%`);
    const learnedMedian = quantile(suite.flatMap((cell) => cell.learnedErrors.map((error) => error.trailRms)), 0.5);
    const frozenMedian = quantile(suite.flatMap((cell) => cell.frozenErrors.map((error) => error.trailRms)), 0.5);
    console.log(`  knowledge=${suite[0].startingKnowledge} fixed-suite learned/frozen trail RMS p50=${learnedMedian.toFixed(3)}/${frozenMedian.toFixed(3)}; improvement=${((1 - learnedMedian / Math.max(frozenMedian, 1e-12)) * 100).toFixed(1)}%`);
  }
  for (const limitation of report.limitations) console.log(`Limit: ${limitation}`);
  if (jsonArgument) console.log(`Complete raw report: ${jsonArgument.slice('--json='.length)}`);
  else console.log('Use --json=path to retain the complete raw report.');
  if (!report.passed) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
