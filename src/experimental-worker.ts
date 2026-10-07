import {
  advanceExperimentalWorld, createExperimentalLearner, experimentalLearnerFit,
  observeExperimentalShot, snapshotExperimentalLearner, type ExperimentalLearner,
} from './experimental-ai';
import {
  EXPERIMENTAL_WORKER_VERSION, experimentalWorkerWorld,
  type ExperimentalWorkerRequest, type ExperimentalWorkerResponse,
} from './experimental-worker-protocol';

/** Same processor runs in the browser worker and in lifecycle/algorithm tests. */
export function createExperimentalWorkerProcessor(): (request: ExperimentalWorkerRequest) => ExperimentalWorkerResponse {
  const learners = new Map<number, { learner: ExperimentalLearner; generation: number }>();
  let generation = 0;
  let lastRequest = 0;
  return (request) => {
    const identity: { version: 1; generation: number; requestId: number } = {
      version: EXPERIMENTAL_WORKER_VERSION, generation: request.generation, requestId: request.requestId,
    };
    try {
      if (request.version !== EXPERIMENTAL_WORKER_VERSION) throw new Error('Unsupported experimental worker protocol version');
      if (!Number.isSafeInteger(request.requestId) || request.requestId <= lastRequest) throw new Error('Out-of-order experimental worker request');
      if (!Number.isSafeInteger(request.generation) || request.generation < 0) throw new Error('Invalid experimental worker generation');
      if (request.kind === 'reset') {
        if (request.generation <= generation) throw new Error('Stale experimental worker reset');
        lastRequest = request.requestId;
        generation = request.generation;
        learners.clear();
        return { ...identity, kind: 'reset' };
      }
      if (request.generation !== generation) throw new Error('Stale experimental worker generation');
      if (!Number.isSafeInteger(request.player) || request.player < 0
        || !Number.isSafeInteger(request.playerGeneration) || request.playerGeneration < 0) {
        throw new Error('Invalid experimental worker player identity');
      }
      if (request.kind !== 'observe' && request.kind !== 'advance') throw new Error('Unknown experimental worker command');
      const existing = learners.get(request.player);
      const previousGeneration = existing?.generation ?? 0;
      const expectedGeneration = previousGeneration + (request.kind === 'advance' ? 1 : 0);
      if (request.playerGeneration !== expectedGeneration) throw new Error('Stale experimental worker field generation');
      lastRequest = request.requestId;
      const learner = existing?.learner ?? createExperimentalLearner(request.startingKnowledge);
      if (existing && learner.startingKnowledge !== Math.max(0, Math.min(1, Number.isFinite(request.startingKnowledge) ? request.startingKnowledge : 0))) {
        throw new Error('Starting knowledge cannot change within a round');
      }
      const world = experimentalWorkerWorld(request.world);
      if (request.kind === 'observe') {
        observeExperimentalShot(learner, request.shot, world, request.learningRate);
      } else {
        if (!existing) experimentalLearnerFit(learner, experimentalWorkerWorld(request.previousWorld ?? request.world));
        advanceExperimentalWorld(learner, world, request.transition);
      }
      learners.set(request.player, { learner, generation: request.playerGeneration });
      return { ...identity, kind: 'result', player: request.player, playerGeneration: request.playerGeneration,
        snapshot: snapshotExperimentalLearner(learner) };
    } catch (error) {
      return { ...identity, kind: 'error', message: error instanceof Error ? error.message : String(error) };
    }
  };
}

// A module import in the main thread or Node exposes only the processor, never installs handlers.
const workerScope = globalThis as unknown as {
  document?: unknown;
  postMessage?: (response: ExperimentalWorkerResponse) => void;
  onmessage?: ((event: { data: ExperimentalWorkerRequest }) => void) | null;
};
if (workerScope.document === undefined && typeof workerScope.postMessage === 'function') {
  const process = createExperimentalWorkerProcessor();
  workerScope.onmessage = (event) => workerScope.postMessage!(process(event.data));
}
