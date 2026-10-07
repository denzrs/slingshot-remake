import { describe, expect, it } from 'vitest';
import { advanceExperimentalWorld, createExperimentalLearner, experimentalLearnerFit, observeExperimentalShot, planExperimentalShot, type ExperimentalDecision } from '../src/experimental-ai';
import { RECOVERY_BASELINE_RMS, recoveryPredictionErrors, recoveryVisibleWorld, recoveryWorld, recordRecoveryShot, recordShot, runHiddenRecoveryValidation, validationWorld, visibleWorld } from '../benchmarks/learning-validation';
import { PHYSICS } from '../src/config';
import { balancedObservations } from '../src/experimental-evidence';
import { Shot, aimDirection, simulateShot, type World } from '../src/physics';
import { createRng } from '../src/rng';

describe('experimental gravity recovery', () => {
  it('improves excluded seven-source probes after repeated then diverse production trajectories without unsafe updates', () => {
    const report = runHiddenRecoveryValidation();
    expect(report.frozenUnchanged).toBe(true);
    expect(report.probesExcluded).toBe(true);
    expect(report.diagnosticsMeaningful).toBe(true);
    expect(report.updatesNonworsening).toBe(true);
    expect(report.finalRms).toBeLessThanOrEqual(report.priorRms * 0.25);
    expect(report.finalRms).toBeLessThanOrEqual(RECOVERY_BASELINE_RMS);
    expect(report.baselineNonregressing).toBe(true);
    expect(report.stages).toHaveLength(8);
    expect(report.stages.every((stage) => stage.recovery!.recoveryStarts <= 4)).toBe(true);
    expect(report.stages.some((stage) => stage.recovery!.effectiveLearningRate > 0)).toBe(true);
  }, 120_000);

  it('rejects an interpolation that worsens an already correct gravity-free prior', () => {
    const world = validationWorld();
    world.planets[0].mass = 0;
    const visible = visibleWorld(world);
    const learner = createExperimentalLearner(0);
    const prior = experimentalLearnerFit(learner, visible);
    observeExperimentalShot(learner, recordRecoveryShot(world, 20, 65, 1), visible, 1);
    const fit = experimentalLearnerFit(learner, visible);
    expect(fit.recovery!.optimizerFinalRms).toBeGreaterThan(0);
    expect(fit.recovery!.proposedLearningRate).toBe(1);
    expect(fit.recovery!.effectiveLearningRate).toBe(0);
    expect(fit.recovery!.updateStatus).toBe('rejected');
    expect(fit.recovery!.beliefBeforeRms).toBe(0);
    expect(fit.recovery!.beliefAfterRms).toBe(0);
    expect(fit.planets).toEqual(prior.planets);
    expect(fit.learnedShots).toBe(0);
  });

  it('validates a novel trajectory against a fit of prior history rather than fitting that trajectory to itself', () => {
    const world = validationWorld();
    const visible = visibleWorld(world);
    const learner = createExperimentalLearner();
    observeExperimentalShot(learner, recordRecoveryShot(world, -6, 65, 1), visible, 1);
    const trained = experimentalLearnerFit(learner, visible);
    const changed: World = { ...world, planets: world.planets.map((planet) => ({ ...planet, mass: planet.radius ** 3 * 1.3 })) };
    const novel = recordRecoveryShot(changed, 20, 65, 2);
    const samples = balancedObservations([novel], 96);
    const direction = aimDirection(novel.angle);
    const replayWorld: World = { ...world, hole: null,
      ships: [{ x: novel.points[0] - direction.x * PHYSICS.MUZZLE, y: novel.points[1] - direction.y * PHYSICS.MUZZLE, alive: false }],
      planets: trained.planets.map((planet, index) => ({ ...planet, radius: 0, seed: index, style: 'rocky', tint: '#fff' })),
    };
    const replay = new Shot(replayWorld, 0, novel.angle, novel.power, { bounce: false, timeLimit: 12 });
    let squared = 0;
    let wanted = 0;
    for (let step = 1; step <= samples[samples.length - 1].point * 2; step++) {
      replay.step();
      replay.end = null;
      if (step === samples[wanted].point * 2) {
        const offset = samples[wanted].point * 2;
        squared += (replay.x - novel.points[offset]) ** 2 + (replay.y - novel.points[offset + 1]) ** 2;
        wanted++;
      }
    }
    const independentRms = Math.sqrt(squared / (samples.length * 2));
    observeExperimentalShot(learner, novel, visible, 1);
    const recovery = experimentalLearnerFit(learner, visible).recovery!;
    expect(recovery.validationSamples).toBe(samples.length);
    expect(recovery.previousValidationRms).toBeCloseTo(independentRms, 7);
    expect(recovery.candidateValidationRms).toBeCloseTo(independentRms, 3);
    expect(recovery.candidateValidationRms).toBeGreaterThan(1);
    expect(recovery.beliefAfterRms!).toBeLessThanOrEqual(recovery.beliefBeforeRms! + 1e-7);
  });

  it('does not change hidden-field predictions when anonymous source positions are permuted before assimilation', () => {
    const world = recoveryWorld();
    const visible = recoveryVisibleWorld(world);
    const learner = createExperimentalLearner(0.72);
    observeExperimentalShot(learner, recordRecoveryShot(world, 0.4, 65, 1), visible, 0.54);
    const permuted = structuredClone(learner);
    permuted.planets.reverse();
    permuted.hypotheses.forEach((fit) => fit.planets.reverse());
    const originalProbes = recoveryPredictionErrors(world, experimentalLearnerFit(learner, visible));
    const permutedProbes = recoveryPredictionErrors(world, experimentalLearnerFit(permuted, visible));
    for (let index = 0; index < originalProbes.length; index++) expect(permutedProbes[index].trailRms).toBeCloseTo(originalProbes[index].trailRms, 7);
    const observation = recordRecoveryShot(world, -30, 65, 2);
    observeExperimentalShot(learner, observation, visible, 0.54);
    observeExperimentalShot(permuted, observation, visible, 0.54);
    const after = recoveryPredictionErrors(world, experimentalLearnerFit(learner, visible));
    const permutedAfter = recoveryPredictionErrors(world, experimentalLearnerFit(permuted, visible));
    for (let index = 0; index < after.length; index++) expect(permutedAfter[index].trailRms).toBeCloseTo(after[index].trailRms, 5);
  }, 120_000);

  it('retains an informative old trajectory and represents it in the bounded fit after duplicate-path overflow', () => {
    const world = validationWorld(2);
    const visible = visibleWorld(world);
    const learner = createExperimentalLearner();
    const informative = recordShot(world, -32, 75, 1);
    observeExperimentalShot(learner, informative, visible, 0.35);
    const repeated = recordShot(world, 6, 65, 2);
    for (let id = 2; id <= 15; id++) observeExperimentalShot(learner, { ...repeated, shotId: id }, visible, 0.35);
    const fit = experimentalLearnerFit(learner, visible);
    expect(fit.retainedShots).toBe(12);
    expect(fit.observedShots).toBe(15);
    expect(fit.recovery!.retainedShotIds).toContain(1);
    expect(fit.recovery!.retainedShotIds).toContain(15);
    expect(fit.recovery!.sampleCounts).toHaveLength(12);
    expect(fit.recovery!.sampleCounts.every((count) => count > 0)).toBe(true);
    expect(fit.recovery!.sampleCounts.reduce((sum, count) => sum + count, 0)).toBe(fit.samples);
    expect(learner.evidence.find((entry) => entry.shot.shotId === 1)!.shot.points).toEqual(informative.points);
  }, 120_000);

  it('recognizes repeated prediction failure, selects a safe novel probe, and clears stagnation on a field change', () => {
    const world = validationWorld(2);
    world.ships = [{ x: 100, y: 400, alive: true }, { x: 160, y: 400, alive: true }, { x: 1100, y: 400, alive: true }];
    const visible = visibleWorld(world);
    const learner = createExperimentalLearner(0);
    // A slower pass between unequal sources bends appreciably; the old fast -14° path did not.
    const repeated = recordRecoveryShot({ ...world, ships: world.ships.map((ship) => ({ ...ship, alive: false })) }, 0, 35, 1);
    expect(repeated.points.length / 2).toBeGreaterThan(96);
    for (let id = 1; id <= 4; id++) {
      observeExperimentalShot(learner, { ...repeated, shotId: id }, visible, 0);
      const fit = experimentalLearnerFit(learner, visible);
      expect(fit.predictionSamples).toBe(96);
      expect(fit.predictionRms).not.toBeNull();
      expect(fit.predictionRms!).toBeGreaterThan(12);
      expect(fit.learnedShots).toBe(0);
      expect(fit.recovery!.updateStatus).toBe('frozen');
    }
    expect(learner.predictionTrend).toHaveLength(4);
    expect(learner.predictionTrend.every((rms) => rms > 12)).toBe(true);
    expect(learner.recovery.stalled).toBe(true);
    expect(learner.recovery.stagnationCount).toBeGreaterThanOrEqual(2);
    let decision: ExperimentalDecision | undefined;
    const rules = { bounce: false, timeLimit: 12 };
    const planner = planExperimentalShot({ ...visible, shots: [repeated] }, {
      learner, learningRate: 0.54, rules, attempt: 0, fixedPower: 65, friends: [1], rng: createRng(7139),
    }, (_, report) => { decision = report; });
    let planned = planner.next();
    while (!planned.done) planned = planner.next();
    expect(decision!.recovery!.stalled).toBe(true);
    expect(decision!.kind).toBe('probe');
    expect(decision!.unsafeRate).toBe(0);
    expect(Math.abs(planned.value.angle - repeated.angle)).toBeGreaterThan(1);
    const outcome = simulateShot(world, 0, planned.value.angle, planned.value.power, rules, [1]);
    expect(outcome.end.kind !== 'ship' || outcome.end.ship === 2).toBe(true);
    const next = { ...visible, epoch: 1 };
    advanceExperimentalWorld(learner, next, { holeMassGain: 0, swallowedPlanetIds: [], feed: 0 });
    expect(learner.recovery.stalled).toBe(false);
    expect(learner.recovery.stagnationCount).toBe(0);
    expect(learner.predictionTrend).toEqual([]);
  }, 120_000);

  for (const gap of [true, false]) {
    it(gap ? 'expands an exhausted probe grid to a novel safe production trajectory'
      : 'reports an honest fallback when every additional recovery launch is unsafe', () => {
      const world = validationWorld(2);
      // At distance 30 each friendly disk covers 25.7° on either side. Removing
      // the 30° disk leaves only a 25.7–34.3° corridor: none of the original
      // direct-target ±7.5°/15° grid or its cardinal additions can enter it.
      const friends = Array.from({ length: 12 }, (_, index) => index * 30)
        .filter((angle) => !gap || angle !== 30)
        .map((angle) => {
          const direction = aimDirection(angle);
          return { x: 100 + direction.x * 30, y: 400 + direction.y * 30, alive: true };
        });
      world.ships = [{ x: 100, y: 400, alive: true }, ...friends, { x: 1100, y: 400, alive: true }];
      const friendIds = friends.map((_, index) => index + 1);
      const enemyId = world.ships.length - 1;
      const visible = visibleWorld(world);
      const learner = createExperimentalLearner(0);
      const repeated = recordRecoveryShot({ ...world,
        ships: world.ships.map((ship) => ({ ...ship, alive: false })) }, 0, 35, 1);
      for (let shotId = 1; shotId <= 4; shotId++) {
        observeExperimentalShot(learner, { ...repeated, shotId }, visible, 0);
      }
      expect(learner.recovery.stalled).toBe(true);
      expect(learner.probeHistory).toHaveLength(4);
      const rules = { bounce: false, timeLimit: 12 };
      const central = { ...world, planets: world.planets.map((planet) => ({ ...planet, mass: 0 })) };
      const originalAngles = [...Array.from({ length: 16 }, (_, turn) => (turn - 7.5) * 15), 0, 22.5, 45, 67.5];
      for (const angle of originalAngles) {
        const outcome = simulateShot(central, 0, angle, 65, rules, friendIds);
        expect(outcome.end.kind === 'ship' && friendIds.includes(outcome.end.ship)).toBe(true);
      }
      if (gap) {
        const outcome = simulateShot(world, 0, 27.5, 65, rules, friendIds);
        expect(outcome.end.kind !== 'ship' || outcome.end.ship === enemyId).toBe(true);
        expect(recordRecoveryShot(world, 27.5, 65, 5).points.length).toBeGreaterThan(240);
      }
      const unchangedWorld = structuredClone(world);
      const unchangedBelief = structuredClone(learner.planets);
      let decision: ExperimentalDecision | undefined;
      const planner = planExperimentalShot(visible, { learner, learningRate: 0,
        rules, attempt: 0, fixedPower: 65, friends: friendIds, rng: createRng(7139) },
      (_, report) => { decision = report; });
      let planned = planner.next();
      while (!planned.done) planned = planner.next();
      expect(planned.value.power).toBe(65);
      expect(world).toEqual(unchangedWorld);
      expect(learner.planets).toEqual(unchangedBelief);
      expect(decision!.recoverySearch!.additionalCandidates).toBeGreaterThan(0);
      expect(decision!.recoverySearch!.additionalCandidates).toBeLessThanOrEqual(72);
      expect(decision!.recoverySearch!.outcome).toBe(gap ? 'expanded-probe' : 'no-safe-informative-launch');
      expect(decision!.kind).toBe(gap ? 'probe' : 'fallback');
      expect(decision!.unsafeRate).toBe(gap ? 0 : 1);
      if (gap) {
        const outcome = simulateShot(world, 0, planned.value.angle, planned.value.power, rules, friendIds);
        expect(outcome.end.kind !== 'ship' || outcome.end.ship === enemyId).toBe(true);
        expect(Math.abs(planned.value.angle - repeated.angle)).toBeGreaterThanOrEqual(8);
      }
    }, 120_000);
  }
});
