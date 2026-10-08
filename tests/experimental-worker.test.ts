import { describe, expect, it } from 'vitest';
import { advanceExperimentalWorld, createExperimentalLearner, experimentalLearnerFit, observeExperimentalShot } from '../src/experimental-ai';
import { ExperimentalWorkerCancelledError, ExperimentalWorkerClient } from '../src/experimental-worker-client';
import { createExperimentalWorkerProcessor } from '../src/experimental-worker';
import { EXPERIMENTAL_WORKER_VERSION, type ExperimentalWorkerRequest } from '../src/experimental-worker-protocol';
import { RECOVERY_ANGLES, recordRecoveryShot, recoveryVisibleWorld, recoveryWorld } from '../benchmarks/learning-validation';
import { ControlledWorker, describeLongShotEquivalence, fitWithoutTime, realShot, visible } from './experimental-worker-fixtures';

// The expensive long-shot cases of this check live in experimental-worker-long-*.test.ts, so they run in parallel.
describeLongShotEquivalence(0, 0);

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
