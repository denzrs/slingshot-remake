import type { ExperimentalLearnerSnapshot, ExperimentalShot, ExperimentalWorld } from './experimental-ai';

/** Version 2 requires the recovery state used by the planner replica. */
export const EXPERIMENTAL_WORKER_VERSION = 2;
export type ExperimentalWorldTransition = {
  holeMassGain: number;
  swallowedPlanetIds: readonly number[];
  feed: number;
};

type RequestIdentity = { version: typeof EXPERIMENTAL_WORKER_VERSION; generation: number; requestId: number };
type PlayerIdentity = { player: number; playerGeneration: number };
export type ExperimentalWorkerRequest = RequestIdentity & (
  | ({ kind: 'observe'; shot: ExperimentalShot; world: ExperimentalWorld; learningRate: number;
      startingKnowledge: number } & PlayerIdentity)
  | ({ kind: 'advance'; world: ExperimentalWorld; transition: ExperimentalWorldTransition;
      startingKnowledge: number; previousWorld?: ExperimentalWorld } & PlayerIdentity)
  | { kind: 'reset' }
);
export type ExperimentalWorkerResponse = RequestIdentity & (
  | ({ kind: 'result'; snapshot: ExperimentalLearnerSnapshot } & PlayerIdentity)
  | { kind: 'reset' }
  | { kind: 'error'; message: string }
);

/** Reject stale recovery schemas before restore can fill missing state with defaults. */
export function assertExperimentalWorkerSnapshot(snapshot: unknown): asserts snapshot is ExperimentalLearnerSnapshot {
  const invalid = () => { throw new Error('Invalid experimental worker recovery snapshot'); };
  if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) invalid();
  const state = snapshot as ExperimentalLearnerSnapshot;
  if (!('recovery' in state) || !('predictionTrend' in state)
    || !('probeHistory' in state) || !('lastRecoveryShot' in state)) invalid();
  const diagnostics = state.recovery;
  if (diagnostics === null || typeof diagnostics !== 'object' || Array.isArray(diagnostics)) invalid();
  for (const key of ['optimizerInitialRms', 'optimizerFinalRms', 'beliefBeforeRms', 'beliefAfterRms',
    'candidateValidationRms', 'previousValidationRms'] as const) {
    if (diagnostics[key] !== null && !isNonnegativeNumber(diagnostics[key])) invalid();
  }
  for (const key of ['validationSamples', 'stagnationCount', 'recoveryStarts', 'matchedSources'] as const) {
    if (!Number.isSafeInteger(diagnostics[key]) || diagnostics[key] < 0) invalid();
  }
  for (const key of ['proposedLearningRate', 'effectiveLearningRate'] as const) {
    if (!isNonnegativeNumber(diagnostics[key]) || diagnostics[key] > 1) invalid();
  }
  if (typeof diagnostics.stalled !== 'boolean'
    || !['accepted', 'reduced', 'rejected', 'frozen', 'unavailable'].includes(diagnostics.updateStatus)
    || !Array.isArray(diagnostics.sampleCounts)
    || !diagnostics.sampleCounts.every((count) => Number.isSafeInteger(count) && count >= 0)
    || !Array.isArray(diagnostics.retainedShotIds)
    || !diagnostics.retainedShotIds.every((id) => id === null || typeof id === 'number' && Number.isFinite(id))
    || diagnostics.sampleCounts.length !== diagnostics.retainedShotIds.length) invalid();
  if (!Array.isArray(state.predictionTrend) || !state.predictionTrend.every(isNonnegativeNumber)
    || !Number.isSafeInteger(state.lastRecoveryShot)
    || !Array.isArray(state.probeHistory)
    || !state.probeHistory.every((probe) => probe !== null && typeof probe === 'object' && !Array.isArray(probe)
      && (['angle', 'power', 'x', 'y'] as const).every((key) => typeof probe[key] === 'number' && Number.isFinite(probe[key])))) invalid();
}

function isNonnegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** Explicit whitelist prevents hidden masses and retained trails from reaching the worker. */
export function experimentalWorkerWorld(world: ExperimentalWorld): ExperimentalWorld {
  return {
    width: world.width, height: world.height,
    ships: world.ships.map((ship) => ({ x: ship.x, y: ship.y, alive: ship.alive })),
    shooter: world.shooter, planetCount: world.planetCount,
    visiblePlanets: world.visiblePlanets?.map((planet) => ({ id: planet.id, x: planet.x, y: planet.y, radius: planet.radius })),
    visibleHole: world.visibleHole && { x: world.visibleHole.x, y: world.visibleHole.y, radius: world.visibleHole.radius },
    mode: world.mode, epoch: world.epoch, hasHole: world.hasHole, holeRadius: world.holeRadius,
    rules: { bounce: world.rules.bounce }, shots: [],
  };
}
