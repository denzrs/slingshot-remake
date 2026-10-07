import {
  restoreExperimentalLearnerSnapshot, type ExperimentalLearner, type ExperimentalShot, type ExperimentalWorld,
} from './experimental-ai';
import {
  EXPERIMENTAL_WORKER_VERSION, experimentalWorkerWorld,
  type ExperimentalWorkerRequest, type ExperimentalWorkerResponse, type ExperimentalWorldTransition,
} from './experimental-worker-protocol';

export interface ExperimentalWorkerPort {
  postMessage(request: ExperimentalWorkerRequest): void;
  terminate(): void;
  onmessage: ((event: { data: ExperimentalWorkerResponse }) => void) | null;
  onerror: ((event: { message: string }) => void) | null;
  onmessageerror: (() => void) | null;
}

export class ExperimentalWorkerCancelledError extends Error {
  constructor(message = 'Experimental fitting was cancelled') {
    super(message);
    this.name = 'ExperimentalWorkerCancelledError';
  }
}

type Pending = {
  request: ExperimentalWorkerRequest;
  resolve: (learner: ExperimentalLearner) => void;
  reject: (error: Error) => void;
};

/** One lazily-created worker owns all experimental CPUs' retained evidence for a match. */
export class ExperimentalWorkerClient {
  private worker: ExperimentalWorkerPort | null = null;
  private generation = 0;
  private requestId = 0;
  private readonly playerGenerations = new Map<number, number>();
  private readonly startingKnowledge = new Map<number, number>();
  private readonly pending = new Map<number, Pending>();
  private readonly resetRequests = new Set<number>();
  private readonly cancelledRequests = new Set<number>();
  private failure: Error | null = null;
  private disposed = false;

  constructor(private readonly factory: () => ExperimentalWorkerPort = () =>
    new Worker(new URL('./experimental-worker.ts', import.meta.url), { type: 'module' }) as unknown as ExperimentalWorkerPort) {}

  submit(player: number, shot: ExperimentalShot, observedWorld: ExperimentalWorld,
    learningRate: number, startingKnowledge: number): Promise<ExperimentalLearner> {
    this.startingKnowledge.set(player, startingKnowledge);
    return this.send({ ...this.identity(), kind: 'observe', player,
      playerGeneration: this.playerGenerations.get(player) ?? 0,
      shot: { angle: shot.angle, power: shot.power, shotId: shot.shotId, points: [...shot.points] },
      world: experimentalWorkerWorld(observedWorld), learningRate, startingKnowledge });
  }

  advance(player: number, observedWorld: ExperimentalWorld, transition: ExperimentalWorldTransition,
    startingKnowledge = this.startingKnowledge.get(player) ?? 1, previousWorld?: ExperimentalWorld): Promise<ExperimentalLearner> {
    const playerGeneration = (this.playerGenerations.get(player) ?? 0) + 1;
    this.playerGenerations.set(player, playerGeneration);
    this.startingKnowledge.set(player, startingKnowledge);
    for (const [id, pending] of this.pending) {
      if (pending.request.kind !== 'reset' && pending.request.player === player) {
        this.cancelledRequests.add(id);
        pending.reject(new ExperimentalWorkerCancelledError('Experimental field changed'));
        this.pending.delete(id);
      }
    }
    return this.send({ ...this.identity(), kind: 'advance', player, playerGeneration,
      world: experimentalWorkerWorld(observedWorld), startingKnowledge,
      previousWorld: previousWorld && experimentalWorkerWorld(previousWorld),
      transition: { holeMassGain: transition.holeMassGain, feed: transition.feed,
        swallowedPlanetIds: [...transition.swallowedPlanetIds] } });
  }

  reset(): void {
    if (this.disposed) return;
    this.generation++;
    this.cancelPending(new ExperimentalWorkerCancelledError('Experimental round reset'));
    this.playerGenerations.clear();
    this.startingKnowledge.clear();
    this.resetRequests.clear();
    this.cancelledRequests.clear();
    if (!this.worker || this.failure) return;
    const request: ExperimentalWorkerRequest = { ...this.identity(), kind: 'reset' };
    this.resetRequests.add(request.requestId);
    try { this.worker.postMessage(request); } catch (error) { this.fail(asError(error)); }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelPending(new ExperimentalWorkerCancelledError('Experimental worker disposed'));
    this.resetRequests.clear();
    this.cancelledRequests.clear();
    if (this.worker) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.onmessageerror = null;
      this.worker.terminate();
      this.worker = null;
    }
  }

  private identity(): { version: 1; generation: number; requestId: number } {
    return { version: EXPERIMENTAL_WORKER_VERSION, generation: this.generation, requestId: ++this.requestId };
  }

  private send(request: ExperimentalWorkerRequest): Promise<ExperimentalLearner> {
    return new Promise((resolve, reject) => {
      if (this.disposed) { reject(new ExperimentalWorkerCancelledError('Experimental worker disposed')); return; }
      if (this.failure) { reject(this.failure); return; }
      try {
        if (!this.worker) {
          this.worker = this.factory();
          this.worker.onmessage = (event) => this.receive(event.data);
          this.worker.onerror = (event) => this.fail(new Error(event.message || 'Experimental worker failed'));
          this.worker.onmessageerror = () => this.fail(new Error('Experimental worker response could not be decoded'));
          // Resets before lazy creation must still establish the processor's round generation.
          if (this.generation > 0) {
            const reset: ExperimentalWorkerRequest = { version: EXPERIMENTAL_WORKER_VERSION,
              generation: this.generation, requestId: request.requestId, kind: 'reset' };
            this.resetRequests.add(reset.requestId);
            this.worker.postMessage(reset);
            request = { ...request, requestId: ++this.requestId };
          }
        }
        this.pending.set(request.requestId, { request, resolve, reject });
        this.worker.postMessage(request);
      } catch (error) {
        reject(asError(error));
        this.fail(asError(error));
      }
    });
  }

  private receive(response: ExperimentalWorkerResponse): void {
    if (this.disposed || this.failure) return;
    if (response.version !== EXPERIMENTAL_WORKER_VERSION) {
      this.fail(new Error('Unsupported experimental worker response version')); return;
    }
    if (response.generation < this.generation) return;
    if (response.generation !== this.generation) {
      this.fail(new Error('Invalid experimental worker response generation')); return;
    }
    if (this.resetRequests.delete(response.requestId)) {
      if (response.kind !== 'reset') this.fail(new Error(response.kind === 'error' ? response.message : 'Invalid experimental worker reset response'));
      return;
    }
    const pending = this.pending.get(response.requestId);
    if (!pending) {
      // A field transition cancels its prior requests, which may still finish in the worker.
      if (this.cancelledRequests.delete(response.requestId)) return;
      this.fail(new Error('Unknown experimental worker response request')); return;
    }
    if (this.pending.keys().next().value !== response.requestId) {
      this.fail(new Error('Out-of-order experimental worker response')); return;
    }
    this.pending.delete(response.requestId);
    if (response.kind === 'error') {
      const error = new Error(response.message);
      pending.reject(error);
      this.fail(error);
      return;
    }
    const request = pending.request;
    if (response.kind !== 'result' || request.kind === 'reset'
      || response.player !== request.player || response.playerGeneration !== request.playerGeneration) {
      const error = new Error('Invalid experimental worker response identity');
      pending.reject(error);
      this.fail(error);
      return;
    }
    try { pending.resolve(restoreExperimentalLearnerSnapshot(response.snapshot)); }
    catch (error) { pending.reject(asError(error)); }
  }

  private cancelPending(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  private fail(error: Error): void {
    this.failure = error;
    this.cancelPending(error);
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
