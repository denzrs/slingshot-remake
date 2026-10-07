import { describe, expect, it } from 'vitest';
import { HORIZON } from '../src/config';
import { advanceExperimentalWorld, createExperimentalLearner, experimentalLearnerFit, observeExperimentalShot, planExperimentalShot, type ExperimentalDecision } from '../src/experimental-ai';
import { heldOutErrors, independentDensityWorld, lowInformationLearningCheck, quantile, recordShot, runLearningValidation, shortShotConfidenceCheck, trainLearner, validationWorld, visibleWorld } from '../benchmarks/learning-validation';
import { simulateShot } from '../src/physics';
import { createRng } from '../src/rng';

describe('production trajectory learning', () => {
  it('keeps a frozen baseline despite completed own-shot evidence', () => {
    const world = validationWorld();
    const initial = trainLearner(world, 0, 0);
    const frozen = trainLearner(world, 0, 8);
    expect(heldOutErrors(world, frozen)).toEqual(heldOutErrors(world, initial));
    const fit = experimentalLearnerFit(frozen, visibleWorld(world));
    expect(fit.learnedShots).toBe(0);
    expect(fit.retainedShots).toBe(0);
    expect(fit.observedShots).toBe(8);
  });

  for (const startingKnowledge of [0, 0.5, 1]) {
    it(`holds initial knowledge ${startingKnowledge} fixed while learning rates change evidence`, () => {
      const world = validationWorld();
      const visible = visibleWorld(world);
      const initial = trainLearner(world, 0, 0, startingKnowledge);
      for (const rate of [0, 0.1, 0.35, 1]) {
        expect(heldOutErrors(world, trainLearner(world, rate, 0, startingKnowledge))).toEqual(heldOutErrors(world, initial));
        const learned = trainLearner(world, rate, 2, startingKnowledge);
        const fit = experimentalLearnerFit(learned, visible);
        expect(fit.startingKnowledge).toBe(startingKnowledge);
        expect(fit.observedShots).toBe(2);
        expect(fit.learnedShots).toBeCloseTo(rate * 2, 12);
        if (rate === 0) expect(heldOutErrors(world, learned)).toEqual(heldOutErrors(world, initial));
      }
    });
  }

  it('recovers held-out gravity predictions from zero starting knowledge without weakening the frozen reference', () => {
    const world = validationWorld();
    const visible = visibleWorld(world);
    const initial = trainLearner(world, 0, 0, 0);
    const frozen = trainLearner(world, 0, 8, 0);
    const learned = trainLearner(world, 1, 8, 0);
    expect(heldOutErrors(world, frozen)).toEqual(heldOutErrors(world, initial));
    expect(experimentalLearnerFit(initial, visible).startingKnowledge).toBe(0);
    expect(experimentalLearnerFit(learned, visible).startingKnowledge).toBe(0);
    expect(quantile(heldOutErrors(world, learned).map((error) => error.trailRms), 0.5))
      .toBeLessThanOrEqual(quantile(heldOutErrors(world, frozen).map((error) => error.trailRms), 0.5) * 0.75);
    expect(experimentalLearnerFit(learned, visible).planets[0].mass).toBeGreaterThan(0);
  });

  it('consumes a repeated completed shot once, even after render-history copies', () => {
    const world = validationWorld();
    const visible = visibleWorld(world);
    const learner = createExperimentalLearner();
    const observed = recordShot(world, -6, 65, 17);
    observeExperimentalShot(learner, observed, visible, 1);
    const before = experimentalLearnerFit(learner, visible);
    const predictions = heldOutErrors(world, learner);
    observeExperimentalShot(learner, { ...observed, points: [...observed.points] }, visible, 1);
    const after = experimentalLearnerFit(learner, visible);
    expect(after.observedShots).toBe(before.observedShots);
    expect(after.learnedShots).toBe(before.learnedShots);
    expect(after.retainedShots).toBe(before.retainedShots);
    expect(heldOutErrors(world, learner)).toEqual(predictions);
  });

  it('scales real evidence updates without changing the observation count', () => {
    const world = validationWorld();
    const partial = trainLearner(world, 0.35, 2);
    const full = trainLearner(world, 1, 2);
    const partialFit = experimentalLearnerFit(partial, visibleWorld(world));
    const fullFit = experimentalLearnerFit(full, visibleWorld(world));
    expect(partialFit.observedShots).toBe(2);
    expect(fullFit.observedShots).toBe(2);
    expect(partialFit.learnedShots).toBeCloseTo(0.7, 12);
    expect(fullFit.learnedShots).toBe(2);
    expect(partialFit.planets[0].mass).not.toBe(fullFit.planets[0].mass);
    expect(fullFit.predictionSamples).toBeGreaterThan(20);
    expect(fullFit.predictionRms).not.toBeNull();
    expect(Number.isFinite(fullFit.predictionRms)).toBe(true);
  });

  for (const [configuredRate, effectiveRate] of [[-1, 0], [2, 1], [NaN, 0], [Infinity, 0], [-Infinity, 0]] as const) {
    it(`bounds direct observation rate ${String(configuredRate)} to ${effectiveRate}`, () => {
      const world = validationWorld();
      const visible = visibleWorld(world);
      const observed = recordShot(world, -6, 65, 1);
      const learner = createExperimentalLearner();
      const reference = createExperimentalLearner();
      observeExperimentalShot(learner, observed, visible, configuredRate);
      observeExperimentalShot(reference, observed, visible, effectiveRate);
      const actual = experimentalLearnerFit(learner, visible);
      const expected = experimentalLearnerFit(reference, visible);
      expect(actual.learningRate).toBe(effectiveRate);
      expect(actual.observedShots).toBe(1);
      expect(actual.learnedShots).toBe(effectiveRate);
      expect(actual.retainedShots).toBe(effectiveRate);
      expect(actual.planets).toEqual(expected.planets);
      expect(actual.predictionSamples).toBeGreaterThan(0);
      expect(actual.predictionRms).toBe(expected.predictionRms);
      if (effectiveRate === 0) expect(actual.fitMs).toBe(0);
    });
  }

  it('keeps hidden-position priors frozen at rate zero while counting usable observations', () => {
    const world = validationWorld();
    const hidden = { ...visibleWorld(world), visiblePlanets: undefined };
    const learner = createExperimentalLearner();
    const prior = experimentalLearnerFit(learner, hidden);
    observeExperimentalShot(learner, recordShot(world, -6, 65, 1), hidden, 0);
    const after = experimentalLearnerFit(learner, hidden);
    expect(after.planets).toEqual(prior.planets);
    expect(after.observedShots).toBe(1);
    expect(after.learnedShots).toBe(0);
    expect(after.retainedShots).toBe(0);
    expect(after.predictionSamples).toBeGreaterThan(0);
    expect(Number.isFinite(after.predictionRms)).toBe(true);
    expect(after.fitMs).toBe(0);
  });

  it('resets anonymous hidden positions and evidence when the public count or epoch changes', () => {
    const world = validationWorld();
    const visible = { ...visibleWorld(world), visiblePlanets: undefined };
    const learner = createExperimentalLearner();
    observeExperimentalShot(learner, recordShot(world, -6, 65, 1), visible, 1);
    const learned = experimentalLearnerFit(learner, visible);
    expect(learned.planets).toHaveLength(1);
    expect(learned.retainedShots).toBe(1);
    const changedEpoch = { ...visible, epoch: 1 };
    const reset = experimentalLearnerFit(learner, changedEpoch);
    const positions = (planets: typeof reset.planets) => planets.map(({ x, y }) => ({ x, y }));
    expect(positions(reset.planets)).toEqual(positions(experimentalLearnerFit(createExperimentalLearner(), changedEpoch).planets));
    expect(reset.planets[0].mass).toBeCloseTo(learned.planets[0].mass, 6);
    expect(reset.retainedShots).toBe(0);
    expect(reset.observedShots).toBe(1);
    expect(reset.learnedShots).toBe(1);
    for (const planetCount of [2, 0, 1]) {
      const changedCount = { ...changedEpoch, planetCount };
      const fit = experimentalLearnerFit(learner, changedCount);
      expect(fit.planets).toHaveLength(planetCount);
      expect(fit.planets.every((planet) => planet.id === undefined)).toBe(true);
      expect(positions(fit.planets)).toEqual(positions(experimentalLearnerFit(createExperimentalLearner(), changedCount).planets));
      expect(fit.retainedShots).toBe(0);
      expect(fit.observedShots).toBe(1);
      expect(fit.learnedShots).toBe(1);
    }
  });

  it('transfers estimated hidden swallowed mass without survivor IDs or old-field evidence', () => {
    const world = validationWorld();
    world.hole = { x: 667, y: 382, radius: 16, mass: HORIZON.START_MASS };
    const hidden = { ...visibleWorld(world), visiblePlanets: undefined };
    const learner = createExperimentalLearner();
    observeExperimentalShot(learner, recordShot(world, -6, 65, 1), hidden, 1);
    const before = experimentalLearnerFit(learner, hidden);
    const next = { ...hidden, planetCount: 0, epoch: 1, holeRadius: 23, visibleHole: { ...hidden.visibleHole!, radius: 23 } };
    advanceExperimentalWorld(learner, next, {
      holeMassGain: HORIZON.MASS_PER_VOLLEY, swallowedPlanetIds: [], feed: HORIZON.FEED,
    });
    const after = experimentalLearnerFit(learner, next);
    expect(after.planets).toHaveLength(0);
    expect(after.retainedShots).toBe(0);
    expect(after.observedShots).toBe(before.observedShots);
    expect(after.learnedShots).toBe(before.learnedShots);
    expect(after.holeMass).toBeCloseTo(before.holeMass! + HORIZON.MASS_PER_VOLLEY + HORIZON.FEED * before.planets[0].mass, 6);
    expect(after.hole).toEqual(next.visibleHole);
    expect(Number.isFinite(after.holeMassUncertainty)).toBe(true);
  });

  for (const learningRate of [0, 1e-9, 0.35, 1]) {
    it(`uses an available safe escape when a teammate blocks the enemy at rate ${learningRate}`, () => {
      const world = {
        ...validationWorld(), planets: [],
        ships: [{ x: 100, y: 400, alive: true }, { x: 160, y: 400, alive: true }, { x: 300, y: 400, alive: true }],
      };
      let decision: ExperimentalDecision | undefined;
      const rules = { bounce: false, timeLimit: 2 };
      const planner = planExperimentalShot(visibleWorld(world), {
        rules, attempt: 0, fixedPower: 65, friends: [1], rng: createRng(1), learningRate,
      }, (_, report) => { decision = report; });
      let result = planner.next();
      while (!result.done) result = planner.next();
      const outcome = simulateShot(world, 0, result.value.angle, result.value.power, rules, [1]);
      expect(outcome.end.kind !== 'ship' || outcome.end.ship === 2).toBe(true);
      expect(decision!.unsafeRate).toBe(0);
      expect(decision!.learningRate).toBe(learningRate);
      expect(decision!.startingKnowledge).toBe(1);
      expect(decision!.observedShots).toBe(0);
      expect(Number.isFinite(result.value.angle)).toBe(true);
      expect(result.value.power).toBe(65);
    });
  }

  it('learns from real future-shot accuracy across rates and history budgets', () => {
    const report = runLearningValidation();
    expect(report.cells).toHaveLength(3 * 2 * 4 * 5);
    for (const gate of report.gates) expect(gate.passed, `${gate.name}: ${JSON.stringify(gate.actual)}`).toBe(true);
    expect(report.actualShots.improvementFraction).toBeGreaterThanOrEqual(0.25);
    expect(report.actualShotSuite).toHaveLength(3);
    for (const scenario of report.actualShotSuite) {
      expect(scenario.frozenUnchanged).toBe(true);
      expect(scenario.probesExcluded).toBe(true);
      expect(scenario.learnedErrors.map(({ angle, power }) => ({ angle, power })))
        .toEqual(scenario.frozenErrors.map(({ angle, power }) => ({ angle, power })));
    }
    const learnedMedian = quantile(report.actualShotSuite.flatMap((scenario) => scenario.learnedErrors.map((error) => error.trailRms)), 0.5);
    const frozenMedian = quantile(report.actualShotSuite.flatMap((scenario) => scenario.frozenErrors.map((error) => error.trailRms)), 0.5);
    expect(learnedMedian).toBeLessThanOrEqual(frozenMedian * 0.75);
    expect(report.zeroKnowledgeActualShotSuite).toHaveLength(3);
    for (const scenario of report.zeroKnowledgeActualShotSuite) {
      expect(scenario.startingKnowledge).toBe(0);
      expect(scenario.learningRate).toBe(1);
      expect(scenario.frozenLearningRate).toBe(0);
      expect(scenario.frozenUnchanged).toBe(true);
      expect(scenario.probesExcluded).toBe(true);
      expect(scenario.learnedErrors.map(({ angle, power }) => ({ angle, power })))
        .toEqual(scenario.frozenErrors.map(({ angle, power }) => ({ angle, power })));
    }
    const zeroKnowledgeLearnedMedian = quantile(report.zeroKnowledgeActualShotSuite.flatMap((scenario) => scenario.learnedErrors.map((error) => error.trailRms)), 0.5);
    const zeroKnowledgeFrozenMedian = quantile(report.zeroKnowledgeActualShotSuite.flatMap((scenario) => scenario.frozenErrors.map((error) => error.trailRms)), 0.5);
    expect(zeroKnowledgeLearnedMedian).toBeLessThanOrEqual(zeroKnowledgeFrozenMedian * 0.75);
    for (const cell of report.cells.filter((cell) => cell.rate === 1 && cell.budget === 8)) {
      expect(cell.observedShots).toBe(8);
      expect(cell.learnedShots).toBe(8);
      expect(cell.errors.every((error) => error.samples > 20)).toBe(true);
    }
  }, 120_000);

  it('does not count completed sample-free boundary exits as mass evidence', () => {
    const report = lowInformationLearningCheck();
    expect(report.observedShots).toBe(4);
    expect(report.lengths.every((length) => length <= 3)).toBe(true);
    expect(report.learnedShots).toBe(0);
    expect(report.retainedShots).toBe(0);
    expect(report.predictionSamples).toBe(0);
    expect(report.predictionRms).toBeNull();
    expect(report.predictionsUnchanged).toBe(true);
  });

  it('retains uncertainty after short low-information shots with tiny fit residuals', () => {
    const report = shortShotConfidenceCheck();
    expect(report.observedShots).toBe(4);
    expect(report.predictionSamples).toBeGreaterThan(0);
    expect(report.predictionSamples).toBeLessThanOrEqual(16);
    expect(report.trainingRms).not.toBeNull();
    expect(report.trainingRms!).toBeLessThan(1);
    for (const uncertainty of report.massUncertainty) {
      expect(uncertainty).not.toBeNull();
      expect(uncertainty!).toBeGreaterThanOrEqual(0.05);
    }
    expect(report.heldOutMedian).toBeGreaterThan(0.1);
  });

  it('learns independent unequal densities and a publicly jittered Horizon center', () => {
    const scenarios = [independentDensityWorld(), independentDensityWorld(1)];
    const learnedErrors: number[] = [];
    const frozenErrors: number[] = [];
    for (const world of scenarios) {
      expect(new Set(world.planets.map((planet) => planet.mass / planet.radius ** 3)).size).toBe(3);
      const learner = trainLearner(world, 1, 8);
      const frozen = trainLearner(world, 0, 8);
      const fit = experimentalLearnerFit(learner, visibleWorld(world));
      expect(fit.observedShots).toBe(8);
      expect(fit.hole).toEqual(world.hole ? { x: world.hole.x, y: world.hole.y, radius: world.hole.radius } : undefined);
      learnedErrors.push(...heldOutErrors(world, learner).map((error) => error.trailRms));
      frozenErrors.push(...heldOutErrors(world, frozen).map((error) => error.trailRms));
    }
    expect(quantile(learnedErrors, 0.5)).toBeLessThanOrEqual(quantile(frozenErrors, 0.5) * 0.75);
  }, 120_000);

  it('cannot read hidden masses from visible observations', () => {
    const world = independentDensityWorld(1);
    const visible = visibleWorld(world);
    expect(Object.keys(visible.visiblePlanets![0]).sort()).toEqual(['id', 'radius', 'x', 'y']);
    const changedTruth = { ...world, planets: world.planets.map((planet) => ({ ...planet, mass: planet.mass * 10 })), hole: { ...world.hole!, mass: world.hole!.mass * 10 } };
    const first = experimentalLearnerFit(createExperimentalLearner(), visible);
    const second = experimentalLearnerFit(createExperimentalLearner(), visibleWorld(changedTruth));
    expect(second.planets).toEqual(first.planets);
    expect(second.holeMass).toEqual(first.holeMass);
    expect(second.hole).toEqual(first.hole);
    const observation = recordShot(world, -14, 70, 1);
    const originalLearner = createExperimentalLearner();
    const changedLearner = createExperimentalLearner();
    observeExperimentalShot(originalLearner, observation, visible, 1);
    observeExperimentalShot(changedLearner, observation, visibleWorld(changedTruth), 1);
    const originalFit = experimentalLearnerFit(originalLearner, visible);
    const changedFit = experimentalLearnerFit(changedLearner, visibleWorld(changedTruth));
    expect(changedFit.planets).toEqual(originalFit.planets);
    expect(changedFit.holeMass).toEqual(originalFit.holeMass);
    expect(changedFit.predictionRms).toBe(originalFit.predictionRms);
  });

  it('carries surviving estimates through Horizon changes without pooling obsolete trails', () => {
    const world = validationWorld(2);
    world.hole = { x: 667, y: 382, radius: 16, mass: HORIZON.START_MASS };
    const learner = trainLearner(world, 1, 4);
    const frozen = trainLearner(world, 0, 4);
    const prior = experimentalLearnerFit(learner, visibleWorld(world));
    const swallowed = world.planets[0];
    const survivor = world.planets[1];
    const next = {
      ...world, version: 1,
      planets: [{ ...survivor, x: survivor.x - 18, y: survivor.y + 12 }],
      hole: { ...world.hole, radius: 23, mass: world.hole.mass + HORIZON.MASS_PER_VOLLEY + HORIZON.FEED * swallowed.mass },
    };
    advanceExperimentalWorld(learner, visibleWorld(next), { holeMassGain: HORIZON.MASS_PER_VOLLEY, swallowedPlanetIds: [swallowed.seed], feed: HORIZON.FEED });
    advanceExperimentalWorld(frozen, visibleWorld(next), { holeMassGain: HORIZON.MASS_PER_VOLLEY, swallowedPlanetIds: [swallowed.seed], feed: HORIZON.FEED });
    const after = experimentalLearnerFit(learner, visibleWorld(next));
    expect(after.retainedShots).toBe(0);
    expect(after.observedShots).toBe(prior.observedShots);
    expect(after.learnedShots).toBe(prior.learnedShots);
    expect(after.planets).toHaveLength(1);
    expect(after.planets[0].x).toBe(next.planets[0].x);
    expect(after.planets[0].y).toBe(next.planets[0].y);
    expect(after.planets[0].mass).toBeCloseTo(prior.planets[1].mass, 6);
    expect(after.holeMass).toBeCloseTo(prior.holeMass! + HORIZON.MASS_PER_VOLLEY + HORIZON.FEED * prior.planets[0].mass, 6);
    const learnedErrors = heldOutErrors(next, learner);
    const frozenErrors = heldOutErrors(next, frozen);
    expect(quantile(learnedErrors.map((error) => error.trailRms), 0.5)).toBeLessThan(quantile(frozenErrors.map((error) => error.trailRms), 0.5));
    observeExperimentalShot(learner, recordShot(next, -15, 76, 99), visibleWorld(next), 1);
    const updated = experimentalLearnerFit(learner, visibleWorld(next));
    expect(updated.observedShots).toBe(prior.observedShots + 1);
    expect(updated.retainedShots).toBe(1);
  }, 120_000);
});
