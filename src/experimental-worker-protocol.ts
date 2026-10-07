import type { ExperimentalLearnerSnapshot, ExperimentalShot, ExperimentalWorld } from './experimental-ai';

export const EXPERIMENTAL_WORKER_VERSION = 1;
export type ExperimentalWorldTransition = {
  holeMassGain: number;
  swallowedPlanetIds: readonly number[];
  feed: number;
};

type RequestIdentity = { version: 1; generation: number; requestId: number };
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
