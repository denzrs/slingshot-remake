import { describe, expect, it } from 'vitest';
import { FIELD, PHYSICS } from '../src/config';
import { advanceExperimentalWorld, createExperimentalLearner, experimentalLearnerFit, observeExperimentalShot, type ExperimentalLearner, type ExperimentalShot, type ExperimentalWorld } from '../src/experimental-ai';
import { ExperimentalWorkerCancelledError, ExperimentalWorkerClient, type ExperimentalWorkerPort } from '../src/experimental-worker-client';
import { createExperimentalWorkerProcessor } from '../src/experimental-worker';
import { EXPERIMENTAL_WORKER_VERSION, type ExperimentalWorkerRequest, type ExperimentalWorkerResponse } from '../src/experimental-worker-protocol';
import { Shot, type World } from '../src/physics';
import { RECOVERY_ANGLES, recordRecoveryShot, recoveryVisibleWorld, recoveryWorld } from '../benchmarks/learning-validation';

class ControlledWorker implements ExperimentalWorkerPort {
  onmessage: ExperimentalWorkerPort['onmessage'] = null;
  onerror: ExperimentalWorkerPort['onerror'] = null;
  onmessageerror: ExperimentalWorkerPort['onmessageerror'] = null;
  requests: ExperimentalWorkerRequest[] = [];
  responses: ExperimentalWorkerResponse[] = [];
  terminated = false;
  private process = createExperimentalWorkerProcessor();
  postMessage(request: ExperimentalWorkerRequest): void {
    this.requests.push(structuredClone(request));
  }
  processNext(): void {
    const request = this.requests.shift();
    if (!request) throw new Error('No worker request');
    this.responses.push(structuredClone(this.process(request)));
  }
  deliverNext(): void {
    const response = this.responses.shift();
    if (!response) throw new Error('No worker response');
    this.onmessage?.({ data: response });
  }
  flush(): void {
    while (this.requests.length) this.processNext();
    while (this.responses.length) this.deliverNext();
  }
  terminate(): void { this.terminated = true; }
}

const truth: World = {
  ...FIELD, version: 0,
  ships: [{ x: 100, y: 400, alive: false }],
  planets: [{ x: 640, y: 520, radius: 25, mass: 18_000, seed: 1, style: 'rocky', tint: '#fff' }],
  hole: null,
};
const visible: ExperimentalWorld = {
  ...FIELD, ships: truth.ships, shooter: 0, planetCount: 1,
  visiblePlanets: [{ id: 1, x: 640, y: 520, radius: 25 }],
  hasHole: false, holeRadius: 0, rules: { bounce: true }, shots: [], mode: 'classic', epoch: 0,
};

function realShot(shotId: number, timeLimit = 60): ExperimentalShot {
  const angle = shotId * 17;
  const power = 65 + shotId % 4;
  const shot = new Shot(truth, 0, angle, power, { bounce: true, timeLimit });
  const points = [shot.x, shot.y];
  for (let step = 1; !shot.end && step <= Math.ceil(timeLimit / PHYSICS.DT) + 1; step++) {
    shot.step();
    if (step % 2 === 0) points.push(shot.x, shot.y);
  }
  expect(shot.end).not.toBeNull();
  return { points, angle, power, shotId };
}

function fitWithoutTime(learner: ExperimentalLearner, world = visible) {
  const { fitMs: _fitMs, ...fit } = experimentalLearnerFit(learner, world);
  return fit;
}

describe('experimental worker protocol', () => {
  it('matches synchronous hidden recovery diagnostics while keeping all production trajectories in the worker', async () => {
    const world = recoveryWorld();
    const hidden = recoveryVisibleWorld(world);
    const worker = new ControlledWorker();
    const client = new ExperimentalWorkerClient(() => worker);
    const sync = createExperimentalLearner(0.72);
    let previousLearned = 0;
    for (let index = 0; index < RECOVERY_ANGLES.length; index++) {
      const shot = recordRecoveryShot(world, RECOVERY_ANGLES[index], 65, index + 1);
      observeExperimentalShot(sync, shot, hidden, 0.54);
      const pending = client.submit(0, shot, hidden, 0.54, 0.72);
      worker.flush();
      const replica = await pending;
      const fit = experimentalLearnerFit(replica, hidden);
      expect(fitWithoutTime(replica, hidden)).toEqual(fitWithoutTime(sync, hidden));
      expect(fit.recovery).toEqual(sync.recovery);
      expect(replica.evidence).toEqual([]);
      expect(replica.seen.size).toBe(0);
      expect(replica.recovery.retainedShotIds).toHaveLength(index + 1);
      expect(replica.recovery.sampleCounts).toHaveLength(index + 1);
      expect(fit.learnedShots - previousLearned).toBeCloseTo(replica.recovery.effectiveLearningRate, 12);
      previousLearned = fit.learnedShots;
      expect(replica.recovery).not.toHaveProperty('points');
      expect(replica.recovery).not.toHaveProperty('shots');
      expect(replica.hypotheses.length).toBeLessThanOrEqual(4);
    }
    client.dispose();
  }, 120_000);

  it.each([[0, 0], [0.35, 0.5], [0.72, 0.9], [1, 1]])(
    'matches the synchronous learner for 12 long production shots at rate %s and knowledge %s', async (rate, knowledge) => {
      const worker = new ControlledWorker();
      const client = new ExperimentalWorkerClient(() => worker);
      const synchronous = createExperimentalLearner(knowledge);
      let result = createExperimentalLearner(knowledge);
      let acceptedLearning = 0;
      let longestTrajectory = 0;
      for (let id = 1; id <= 12; id++) {
        const shot = realShot(id);
        longestTrajectory = Math.max(longestTrajectory, shot.points.length);
        observeExperimentalShot(synchronous, shot, visible, rate);
        const pending = client.submit(0, shot, visible, rate, knowledge);
        expect(worker.requests).toHaveLength(1);
        expect(worker.requests[0]).toMatchObject({ kind: 'observe', player: 0, shot });
        worker.flush();
        result = await pending;
        const completedFit = experimentalLearnerFit(result, visible);
        acceptedLearning += result.recovery.effectiveLearningRate;
        expect(result.recovery.effectiveLearningRate).toBeGreaterThanOrEqual(0);
        expect(result.recovery.effectiveLearningRate).toBeLessThanOrEqual(rate);
        expect(completedFit.learnedShots).toBeCloseTo(acceptedLearning, 12);
        expect(completedFit.learnedShots).toBeCloseTo(synchronous.learnedShots, 12);
        expect(completedFit.learnedShots).toBeLessThanOrEqual(id * rate);
        expect(fitWithoutTime(result)).toEqual(fitWithoutTime(synchronous));
        expect(result.evidence).toHaveLength(0);
        expect(result.seen.size).toBe(0);
        expect(Reflect.set(result, 'startingKnowledge', 0.123)).toBe(false);
      }
      const fit = experimentalLearnerFit(result, visible);
      expect(fit).toMatchObject({ observedShots: 12, retainedShots: rate === 0 ? 0 : 12, startingKnowledge: knowledge });
      expect(fit.learnedShots).toBeCloseTo(acceptedLearning, 12);
      expect(fit.learnedShots).toBeLessThanOrEqual(12 * rate);
      expect(longestTrajectory).toBeGreaterThan(10_000);
      expect(fit.predictionSamples).toBe(96);
      expect(fit.samples).toBe(rate === 0 ? 0 : 96);
      expect(Number.isFinite(fit.predictionRms)).toBe(true);
      expect(Number.isFinite(fit.fitMs)).toBe(true);
      const duplicate = client.submit(0, realShot(12), visible, rate, knowledge);
      worker.flush();
      expect(fitWithoutTime(await duplicate)).toEqual(fitWithoutTime(result));
      const next = realShot(13);
      observeExperimentalShot(synchronous, next, visible, rate);
      const overflow = client.submit(0, next, visible, rate, knowledge);
      worker.flush();
      const afterOverflow = await overflow;
      acceptedLearning += afterOverflow.recovery.effectiveLearningRate;
      expect(afterOverflow.recovery.effectiveLearningRate).toBeGreaterThanOrEqual(0);
      expect(afterOverflow.recovery.effectiveLearningRate).toBeLessThanOrEqual(rate);
      expect(afterOverflow.learnedShots).toBeCloseTo(acceptedLearning, 12);
      expect(afterOverflow.learnedShots).toBeLessThanOrEqual(13 * rate);
      expect(fitWithoutTime(afterOverflow)).toEqual(fitWithoutTime(synchronous));
      expect(experimentalLearnerFit(afterOverflow, visible)).toMatchObject({ observedShots: 13, retainedShots: rate === 0 ? 0 : 12 });
      client.dispose();
      expect(worker.terminated).toBe(true);
    },
    60_000,
  );

  it('keeps ordered updates and each player history independent', async () => {
    const worker = new ControlledWorker();
    const client = new ExperimentalWorkerClient(() => worker);
    const sync = createExperimentalLearner(0.5);
    const first = realShot(1, 0.25);
    const second = realShot(2, 0.25);
    const a = client.submit(0, first, visible, 0.35, 0.5);
    const b = client.submit(0, second, visible, 0.35, 0.5);
    const other = client.submit(1, first, { ...visible, shooter: 0 }, 0, 0);
    worker.flush();
    observeExperimentalShot(sync, first, visible, 0.35);
    expect(fitWithoutTime(await a)).toEqual(fitWithoutTime(sync));
    observeExperimentalShot(sync, second, visible, 0.35);
    expect(fitWithoutTime(await b)).toEqual(fitWithoutTime(sync));
    expect(experimentalLearnerFit(await other, visible)).toMatchObject({ observedShots: 1, learnedShots: 0, retainedShots: 0, startingKnowledge: 0 });
    client.dispose();
  });

  it('rejects a pending reset update and ignores its stale result', async () => {
    const worker = new ControlledWorker();
    const client = new ExperimentalWorkerClient(() => worker);
    const pending = client.submit(0, realShot(1, 0.25), visible, 1, 0.5);
    const rejected = expect(pending).rejects.toBeInstanceOf(ExperimentalWorkerCancelledError);
    worker.processNext();
    client.reset();
    await rejected;
    const current = client.submit(0, realShot(2, 0.25), visible, 0.35, 0.9);
    worker.flush();
    expect(experimentalLearnerFit(await current, visible)).toMatchObject({ observedShots: 1, learnedShots: 0.35, retainedShots: 1, startingKnowledge: 0.9 });
    client.dispose();
  });

  it('applies public field transitions in order without stale diagnostics or counters', async () => {
    const worker = new ControlledWorker();
    const client = new ExperimentalWorkerClient(() => worker);
    const sync = createExperimentalLearner(0.5);
    const shot = realShot(1, 0.25);
    const pending = client.submit(0, shot, visible, 0.35, 0.5);
    worker.flush();
    await pending;
    observeExperimentalShot(sync, shot, visible, 0.35);
    const changed = { ...visible, epoch: 1, visiblePlanets: [{ id: 1, x: 645, y: 520, radius: 25 }] };
    const transition = { holeMassGain: 0, swallowedPlanetIds: [], feed: 0 };
    const advanced = client.advance(0, changed, transition);
    worker.flush();
    advanceExperimentalWorld(sync, changed, transition);
    const result = await advanced;
    expect(fitWithoutTime(result, changed)).toEqual(fitWithoutTime(sync, changed));
    expect(experimentalLearnerFit(result, changed)).toMatchObject({ observedShots: 1, learnedShots: 0.35, retainedShots: 0, predictionSamples: 0, predictionRms: null });
    client.dispose();
  });

  it('surfaces processor errors and rejects later work instead of returning stale knowledge', async () => {
    const worker = new ControlledWorker();
    const client = new ExperimentalWorkerClient(() => worker);
    const invalid = client.submit(0, realShot(1, 0.25), visible, 1, 0.5);
    const rejected = expect(invalid).rejects.toThrow();
    Object.assign(worker.requests[0], { version: 99 });
    worker.flush();
    await rejected;
    await expect(client.submit(0, realShot(2, 0.25), visible, 1, 0.5)).rejects.toThrow('Unsupported experimental worker protocol version');
    client.dispose();
  });

  it.each(['recovery', 'predictionTrend', 'probeHistory', 'lastRecoveryShot'] as const)(
    'rejects current-version snapshots missing %s and permanently rejects queued and later work', async (field) => {
      const worker = new ControlledWorker();
      const client = new ExperimentalWorkerClient(() => worker);
      const first = client.submit(0, realShot(1, 0.25), visible, 0.35, 0.5);
      const queued = client.submit(0, realShot(2, 0.25), visible, 0.35, 0.5);
      const firstRejected = expect(first).rejects.toThrow('Invalid experimental worker recovery snapshot');
      const queuedRejected = expect(queued).rejects.toThrow('Invalid experimental worker recovery snapshot');
      worker.processNext();
      const response = worker.responses[0];
      expect(response.version).toBe(EXPERIMENTAL_WORKER_VERSION);
      if (response.kind !== 'result') throw new Error('Expected real processor result');
      Reflect.deleteProperty(response.snapshot, field);
      worker.deliverNext();
      await firstRejected;
      await queuedRejected;
      // A subsequent valid reply cannot resume a client that lost required recovery state.
      worker.flush();
      await expect(client.submit(0, realShot(3, 0.25), visible, 0.35, 0.5))
        .rejects.toThrow('Invalid experimental worker recovery snapshot');
      expect(worker.requests).toHaveLength(0);
      client.dispose();
    },
  );

  it('rejects incomplete recovery diagnostics instead of restoring a falsely healthy planner', async () => {
    const worker = new ControlledWorker();
    const client = new ExperimentalWorkerClient(() => worker);
    const pending = client.submit(0, realShot(1, 0.25), visible, 0.35, 0.5);
    const rejected = expect(pending).rejects.toThrow('Invalid experimental worker recovery snapshot');
    worker.processNext();
    const response = worker.responses[0];
    if (response.kind !== 'result') throw new Error('Expected real processor result');
    Reflect.deleteProperty(response.snapshot.recovery, 'stalled');
    worker.deliverNext();
    await rejected;
    client.dispose();
  });

  it('rejects version-one requests in the real processor without accepting their evidence', () => {
    const process = createExperimentalWorkerProcessor();
    const request: ExperimentalWorkerRequest = {
      version: EXPERIMENTAL_WORKER_VERSION, generation: 0, requestId: 1,
      kind: 'observe', player: 0, playerGeneration: 0, shot: realShot(1, 0.25),
      world: visible, learningRate: 0.35, startingKnowledge: 0.5,
    };
    const obsolete = structuredClone(request);
    Object.assign(obsolete, { version: 1 });
    expect(process(obsolete)).toMatchObject({ version: EXPERIMENTAL_WORKER_VERSION, kind: 'error',
      message: 'Unsupported experimental worker protocol version' });
    const accepted = process(request);
    if (accepted.kind !== 'result') throw new Error('Expected real processor result');
    expect(accepted.snapshot.observedShots).toBe(1);
    expect(accepted.snapshot.recovery.retainedShotIds).toEqual([1]);
  });

  it('rejects version-one responses even when the real processor supplied a complete snapshot', async () => {
    const worker = new ControlledWorker();
    const client = new ExperimentalWorkerClient(() => worker);
    const pending = client.submit(0, realShot(1, 0.25), visible, 0.35, 0.5);
    const rejected = expect(pending).rejects.toThrow('Unsupported experimental worker response version');
    worker.processNext();
    Object.assign(worker.responses[0], { version: 1 });
    worker.deliverNext();
    await rejected;
    await expect(client.submit(0, realShot(2, 0.25), visible, 0.35, 0.5))
      .rejects.toThrow('Unsupported experimental worker response version');
    expect(worker.requests).toHaveLength(0);
    client.dispose();
  });

  it('surfaces transport errors', async () => {
    const worker = new ControlledWorker();
    const client = new ExperimentalWorkerClient(() => worker);
    const pending = client.submit(0, realShot(1, 0.25), visible, 1, 0.5);
    const rejected = expect(pending).rejects.toThrow('worker transport failed');
    worker.onerror?.({ message: 'worker transport failed' });
    await rejected;
    client.dispose();
  });

  it('rejects reordered real responses before applying a later belief', async () => {
    const worker = new ControlledWorker();
    const client = new ExperimentalWorkerClient(() => worker);
    const first = client.submit(0, realShot(1, 0.25), visible, 1, 0.5);
    const second = client.submit(0, realShot(2, 0.25), visible, 1, 0.5);
    const firstRejected = expect(first).rejects.toThrow('Out-of-order experimental worker response');
    const secondRejected = expect(second).rejects.toThrow('Out-of-order experimental worker response');
    worker.processNext();
    worker.processNext();
    worker.responses.reverse();
    worker.deliverNext();
    await firstRejected;
    await secondRejected;
    client.dispose();
  });

  it('sends only public geometry and the new shot, never retained trails or true masses', async () => {
    const worker = new ControlledWorker();
    const client = new ExperimentalWorkerClient(() => worker);
    const planet = { ...visible.visiblePlanets![0] };
    Object.defineProperty(planet, 'mass', { enumerable: true, get() { throw new Error('private mass read'); } });
    const oldShot = realShot(1, 0.25);
    const pending = client.submit(0, realShot(2, 0.25), { ...visible, visiblePlanets: [planet], shots: [oldShot] }, 0.35, 0.5);
    expect(worker.requests[0]).toMatchObject({ kind: 'observe', world: { shots: [], visiblePlanets: [{ id: 1, x: 640, y: 520, radius: 25 }] } });
    worker.flush();
    expect(experimentalLearnerFit(await pending, visible).observedShots).toBe(1);
    client.dispose();
  });

  it('cancels pending work when disposed', async () => {
    const worker = new ControlledWorker();
    const client = new ExperimentalWorkerClient(() => worker);
    const pending = client.submit(0, realShot(1, 0.25), visible, 1, 1);
    const rejected = expect(pending).rejects.toBeInstanceOf(ExperimentalWorkerCancelledError);
    client.dispose();
    await rejected;
    expect(worker.terminated).toBe(true);
  });
});

describe('experimental worker evidence lifecycle', () => {
  it('ignores a canceled old-field reply but retains its real assimilation before the field transition', async () => {
    const worker = new ControlledWorker();
    const client = new ExperimentalWorkerClient(() => worker);
    const sync = createExperimentalLearner(0.5);
    const shot = realShot(1, 0.25);
    const pending = client.submit(0, shot, visible, 0.35, 0.5);
    const rejected = expect(pending).rejects.toBeInstanceOf(ExperimentalWorkerCancelledError);
    const changed = { ...visible, epoch: 1, visiblePlanets: [{ id: 1, x: 645, y: 520, radius: 25 }] };
    const transition = { holeMassGain: 0, swallowedPlanetIds: [], feed: 0 };
    const advanced = client.advance(0, changed, transition);
    await rejected;
    worker.flush();
    observeExperimentalShot(sync, shot, visible, 0.35);
    advanceExperimentalWorld(sync, changed, transition);
    expect(fitWithoutTime(await advanced, changed)).toEqual(fitWithoutTime(sync, changed));
    client.dispose();
  });

  it('preserves counters and clears current prediction diagnostics for a sample-free observation', async () => {
    const worker = new ControlledWorker();
    const client = new ExperimentalWorkerClient(() => worker);
    const first = client.submit(0, realShot(1, 0.25), visible, 0.35, 0.5);
    worker.flush();
    await first;
    const empty = client.submit(0, { angle: 0, power: 50, points: [], shotId: 2 }, visible, 0.35, 0.5);
    worker.flush();
    expect(experimentalLearnerFit(await empty, visible)).toMatchObject({ observedShots: 2, learnedShots: 0.35, retainedShots: 1, predictionSamples: 0, predictionRms: null, fitMs: 0 });
    client.dispose();
  });
});
