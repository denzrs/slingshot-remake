import { describe, expect, it } from 'vitest';
import { FIELD, PHYSICS } from '../src/config';
import { createExperimentalLearner, experimentalLearnerFit, observeExperimentalShot, type ExperimentalLearner, type ExperimentalShot, type ExperimentalWorld } from '../src/experimental-ai';
import { ExperimentalWorkerClient, type ExperimentalWorkerPort } from '../src/experimental-worker-client';
import { createExperimentalWorkerProcessor } from '../src/experimental-worker';
import type { ExperimentalWorkerRequest, ExperimentalWorkerResponse } from '../src/experimental-worker-protocol';
import { Shot, type World } from '../src/physics';

export class ControlledWorker implements ExperimentalWorkerPort {
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

export const truth: World = {
  ...FIELD, version: 0,
  ships: [{ x: 100, y: 400, alive: false }],
  planets: [{ x: 640, y: 520, radius: 25, mass: 18_000, seed: 1, style: 'rocky', tint: '#fff' }],
  hole: null,
};
export const visible: ExperimentalWorld = {
  ...FIELD, ships: truth.ships, shooter: 0, planetCount: 1,
  visiblePlanets: [{ id: 1, x: 640, y: 520, radius: 25 }],
  hasHole: false, holeRadius: 0, rules: { bounce: true }, shots: [], mode: 'classic', epoch: 0,
};

export function realShot(shotId: number, timeLimit = 60): ExperimentalShot {
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

export function fitWithoutTime(learner: ExperimentalLearner, world = visible) {
  const { fitMs: _fitMs, ...fit } = experimentalLearnerFit(learner, world);
  return fit;
}

/**
 * The worker must reproduce the synchronous learner exactly. The long-shot cases are expensive, so each
 * parameter pair lives in its own test file and the files run in parallel.
 */
export function describeLongShotEquivalence(rate: number, knowledge: number): void {
  describe('experimental worker protocol', () => {
    it(
      `matches the synchronous learner for 12 long production shots at rate ${rate} and knowledge ${knowledge}`, async () => {
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
  });
}
