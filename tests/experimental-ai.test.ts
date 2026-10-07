import { describe, expect, it } from 'vitest';
import { FIELD, HORIZON } from '../src/config';
import { advanceExperimentalWorld, createExperimentalLearner, experimentalLearnerFit, fitGravity, fitGravityHypotheses, measureReconstruction, observeExperimentalShot, planExperimentalShot, type ExperimentalWorld } from '../src/experimental-ai';
import { Shot, simulateShot, type World } from '../src/physics';
import { createRng } from '../src/rng';


function planExperimental(world: ExperimentalWorld) {
  const planner = planExperimentalShot(world, {
    rules: { bounce: false, timeLimit: 12 },
    attempt: world.shots.length,
    fixedPower: null,
    rng: createRng(1),
  }, () => {});
  for (;;) {
    const result = planner.next();
    if (result.done) return result.value;
  }
}

function visibleWorld(world: World): ExperimentalWorld {
  return {
    width: world.width, height: world.height, ships: world.ships, shooter: 0,
    planetCount: world.planets.length,
    visiblePlanets: world.planets.map(({ seed, x, y, radius }) => ({ id: seed, x, y, radius })),
    visibleHole: world.hole ? { x: world.hole.x, y: world.hole.y, radius: world.hole.radius } : undefined,
    hasHole: world.hole !== null, holeRadius: world.hole?.radius ?? 0, rules: { bounce: false }, shots: [],
  };
}

function observedShot(world: World, angle: number, shotId: number, steps = 2_000) {
  const shot = new Shot(world, 0, angle, 65, { bounce: false, timeLimit: 12 });
  const points = [shot.x, shot.y];
  for (let step = 0; step < steps && !shot.end; step++) {
    shot.step();
    if (step % 2 === 1) points.push(shot.x, shot.y);
  }
  return { points, angle, power: 65, shotId };
}

describe('experimental starting knowledge', () => {
  const world: World = {
    width: FIELD.width, height: FIELD.height,
    ships: [{ x: 100, y: 400, alive: true }, { x: 1180, y: 400, alive: false }],
    planets: [{ x: 640, y: 520, radius: 25, mass: 20_000, seed: 1, style: 'rocky', tint: '#fff' }],
    hole: null, version: 0,
  };

  it.each([[undefined, 1], [-1, 0], [2, 1], [NaN, 0], [Infinity, 0], [0.35, 0.35]])(
    'normalizes %s and freezes knowledge for the learner lifetime', (input, expected) => {
      const learner = createExperimentalLearner(input);
      expect(learner.startingKnowledge).toBe(expected);
      expect(Reflect.set(learner, 'startingKnowledge', 0.7)).toBe(false);
      expect(experimentalLearnerFit(learner, visibleWorld(world)).startingKnowledge).toBe(expected);
    },
  );

  it('interpolates initial gravity without changing exact public collision geometry or reading true masses', () => {
    const visible = visibleWorld(world);
    const fits = [0, 0.5, 1].map((knowledge) => experimentalLearnerFit(createExperimentalLearner(knowledge), visible));
    expect(fits.map((fit) => fit.planets[0].mass)).toEqual([0, 25 ** 3 * 1.025 / 2, 25 ** 3 * 1.025]);
    expect(fits[0].planets[0].massStandardDeviation).toBeGreaterThan(fits[2].planets[0].massStandardDeviation! * 5);
    for (const fit of fits) expect(fit.planets[0]).toMatchObject({ id: 1, x: 640, y: 520, radius: 25 });
    const otherTruth = { ...world, planets: world.planets.map((planet) => ({ ...planet, mass: 12_000 })) };
    expect(experimentalLearnerFit(createExperimentalLearner(0.5), visibleWorld(otherTruth))).toEqual(fits[1]);
    const direct = { ...world, planets: [{ ...world.planets[0], y: 400, mass: 0 }] };
    const fit = experimentalLearnerFit(createExperimentalLearner(0), visibleWorld(direct));
    const believed = { ...direct, planets: direct.planets.map((planet, index) => ({ ...planet, ...fit.planets[index] })) };
    expect(simulateShot(believed, 0, 0, 65, { bounce: false, timeLimit: 12 }).end?.kind).toBe('planet');
  });

  it('keeps zero knowledge frozen at rate zero across complete real trajectories and geometry updates', () => {
    const learner = createExperimentalLearner(0);
    const visible = visibleWorld(world);
    const initial = experimentalLearnerFit(learner, visible);
    observeExperimentalShot(learner, observedShot(world, 0, 1), visible, 0);
    const fit = experimentalLearnerFit(learner, visible);
    expect(fit.planets).toEqual(initial.planets);
    expect(fit.retainedShots).toBe(0);
    expect(fit.learnedShots).toBe(0);
    expect(fit.predictionRms).toBeGreaterThan(1);
    const moved = { ...visible, epoch: 1, visiblePlanets: visible.visiblePlanets!.map((planet) => ({ ...planet, x: planet.x + 10 })) };
    const updated = experimentalLearnerFit(learner, moved);
    expect(updated.planets[0].mass).toBe(0);
    expect(updated.planets[0].massStandardDeviation).toBe(initial.planets[0].massStandardDeviation);
    expect(updated.planets[0].x).toBe(650);
    expect(updated.startingKnowledge).toBe(0);
  });

  it('recovers from zero knowledge using own evidence and improves an independent real held-out trajectory', () => {
    const visible = visibleWorld(world);
    const frozen = createExperimentalLearner(0);
    const recovering = createExperimentalLearner(0);
    const training = observedShot(world, 0, 1);
    observeExperimentalShot(recovering, training, visible, 1);
    const learned = experimentalLearnerFit(recovering, visible);
    expect(learned.planets[0].mass).toBeCloseTo(world.planets[0].mass, -1);
    expect(learned.planets[0].massStandardDeviation).toBeLessThan(100);
    const heldOut = observedShot(world, 5, 2);
    observeExperimentalShot(frozen, heldOut, visible, 0);
    observeExperimentalShot(recovering, heldOut, visible, 0);
    const frozenFit = experimentalLearnerFit(frozen, visible);
    const recoveryFit = experimentalLearnerFit(recovering, visible);
    expect(recoveryFit.predictionSamples).toBeGreaterThan(0);
    expect(recoveryFit.predictionRms).toBeLessThan(frozenFit.predictionRms! / 10);
    expect(recoveryFit.startingKnowledge).toBe(0);
    expect(recoveryFit.learnedShots).toBe(1);
    expect(recoveryFit.planets).toEqual(learned.planets);
  });

  it('does not snap a zero prior to informed mass bounds at a tiny positive learning rate', () => {
    const learner = createExperimentalLearner(0);
    observeExperimentalShot(learner, observedShot(world, 0, 1), visibleWorld(world), 1e-9);
    const fit = experimentalLearnerFit(learner, visibleWorld(world));
    expect(fit.planets[0].mass).toBeGreaterThan(0);
    expect(fit.planets[0].mass).toBeLessThan(0.001);
    expect(fit.planets[0].massStandardDeviation).toBeCloseTo(25 ** 3 * 1.025, 3);
  });

  it('uses knowledge for hidden-position priors without receiving hidden positions or mass', () => {
    const hidden = { ...visibleWorld(world), visiblePlanets: undefined };
    const weak = experimentalLearnerFit(createExperimentalLearner(0), hidden);
    const informed = experimentalLearnerFit(createExperimentalLearner(1), hidden);
    expect(weak.planets[0].mass).toBe(0);
    expect(weak.planets[0].massStandardDeviation).toBeGreaterThan(0);
    expect(informed.planets[0].mass).toBeGreaterThan(1_000);
    expect(informed.planets[0].id).toBeUndefined();
    expect(experimentalLearnerFit(createExperimentalLearner(1), { ...hidden, ships: [...hidden.ships] })).toEqual(informed);
  });

  it('learns a hidden-position field from zero knowledge without replacing its frozen counterpart', () => {
    const hidden = { ...visibleWorld(world), visiblePlanets: undefined };
    const frozen = createExperimentalLearner(0);
    const learner = createExperimentalLearner(0);
    const evidence = observedShot(world, 0, 1);
    observeExperimentalShot(frozen, evidence, hidden, 0);
    observeExperimentalShot(learner, evidence, hidden, 1);
    const fit = experimentalLearnerFit(learner, hidden);
    expect(fit.planets[0].mass).toBeGreaterThan(1_000);
    expect(fit.rms).toBeLessThan(experimentalLearnerFit(frozen, hidden).predictionRms!);
    expect(measureReconstruction(world, fit).relativeGravityRms).toBeLessThan(1);
    expect(fit.startingKnowledge).toBe(0);
    expect(fit.learnedShots).toBe(1);
    expect(experimentalLearnerFit(frozen, hidden).planets[0].mass).toBe(0);
  });

  it('propagates anonymous swallowed uncertainty without inventing hidden survivor identities', () => {
    const hidden = { ...visibleWorld(world), mode: 'horizon' as const, visiblePlanets: undefined,
      hasHole: true, holeRadius: 30 };
    const learner = createExperimentalLearner(0);
    const initial = experimentalLearnerFit(learner, hidden);
    advanceExperimentalWorld(learner, { ...hidden, epoch: 1, planetCount: 0 },
      { holeMassGain: 1_000, swallowedPlanetIds: [], feed: HORIZON.FEED });
    const fit = experimentalLearnerFit(learner, { ...hidden, epoch: 1, planetCount: 0 });
    expect(fit.holeMass).toBe(1_000);
    expect(fit.holeMassStandardDeviation).toBeGreaterThan(initial.holeMassStandardDeviation!);
    expect(fit.planets).toEqual([]);
    expect(fit.startingKnowledge).toBe(0);
  });

  it('keeps low-knowledge Horizon hole mass uncertain while applying public growth and swallowed estimates', () => {
    const horizon = { ...visibleWorld(world), mode: 'horizon' as const, hasHole: true,
      holeRadius: 30, visibleHole: { x: 800, y: 650, radius: 30 } };
    const learner = createExperimentalLearner(0);
    const initial = experimentalLearnerFit(learner, horizon);
    expect(initial.holeMass).toBe(0);
    expect(initial.holeMassStandardDeviation).toBe(HORIZON.START_MASS);
    expect(experimentalLearnerFit(createExperimentalLearner(1), horizon).holeMass).toBe(HORIZON.START_MASS);
    const next = { ...horizon, epoch: 1, planetCount: 0, visiblePlanets: [] };
    advanceExperimentalWorld(learner, next, { holeMassGain: 5_000, swallowedPlanetIds: [1], feed: HORIZON.FEED });
    const fit = experimentalLearnerFit(learner, next);
    expect(fit.holeMass).toBe(5_000);
    expect(fit.holeMassStandardDeviation).toBeGreaterThan(initial.holeMassStandardDeviation!);
    expect(fit.startingKnowledge).toBe(0);
    expect(fit.learnedShots).toBe(0);
    expect(fit.planets).toEqual([]);
  });

  it('recovers unknown Horizon hole mass from a real own shot', () => {
    const horizonWorld = { ...world, planets: [], hole: { x: 800, y: 650, radius: 30, mass: 200_000 } };
    const visible = { ...visibleWorld(horizonWorld), mode: 'horizon' as const };
    const learner = createExperimentalLearner(0);
    observeExperimentalShot(learner, observedShot(horizonWorld, 0, 1, 300), visible, 1);
    const fit = experimentalLearnerFit(learner, visible);
    expect(fit.holeMass).toBeCloseTo(horizonWorld.hole.mass, -1);
    expect(fit.holeMassStandardDeviation).toBeLessThan(HORIZON.START_MASS);
    expect(fit.predictionRms).toBeGreaterThan(fit.rms!);
  });

  it.each([0, 1])('retains uncertainty after a sparse hidden Horizon shot with %i planets', (planetCount) => {
    const horizonWorld = { ...world, planets: world.planets.slice(0, planetCount),
      hole: { x: FIELD.width / 2, y: FIELD.height / 2, radius: 30, mass: 200_000 } };
    const hidden = { ...visibleWorld(horizonWorld), mode: 'horizon' as const, visiblePlanets: undefined };
    const learner = createExperimentalLearner(0);
    const prior = experimentalLearnerFit(learner, hidden);
    const evidence = observedShot(horizonWorld, 0, 1, 6);
    observeExperimentalShot(learner, evidence, hidden, 1);
    const fit = experimentalLearnerFit(learner, hidden);
    expect(fit.holeMassStandardDeviation).toBeGreaterThan(prior.holeMassStandardDeviation! * 0.9);
    expect(fit.holeMassUncertainty).toBeGreaterThan(0.1);
    expect(fit.hole).toEqual(prior.hole);
    expect(fit.startingKnowledge).toBe(0);
    expect(fit.observedShots).toBe(1);
    expect(fit.learnedShots).toBe(1);
    expect(fit.retainedShots).toBe(1);
    expect(fit.learningRate).toBe(1);
  });

  it('reduces hidden hole uncertainty when a real trajectory supplies informative evidence', () => {
    const horizonWorld = { ...world, planets: [],
      hole: { x: FIELD.width / 2, y: FIELD.height / 2, radius: 30, mass: 200_000 } };
    const hidden = { ...visibleWorld(horizonWorld), mode: 'horizon' as const, visiblePlanets: undefined };
    const learner = createExperimentalLearner(0);
    const prior = experimentalLearnerFit(learner, hidden);
    observeExperimentalShot(learner, observedShot(horizonWorld, 0, 1, 6), hidden, 1);
    const sparse = experimentalLearnerFit(learner, hidden);
    observeExperimentalShot(learner, observedShot(horizonWorld, 0, 2, 300), hidden, 1);
    const informed = experimentalLearnerFit(learner, hidden);
    expect(informed.holeMassStandardDeviation).toBeGreaterThan(0);
    expect(informed.holeMassStandardDeviation).toBeLessThan(sparse.holeMassStandardDeviation! * 0.5);
    expect(informed.holeMassStandardDeviation).toBeLessThan(prior.holeMassStandardDeviation!);
    expect(informed.holeMassUncertainty).toBeGreaterThan(0);
    expect(informed.hole).toEqual(prior.hole);
    expect(informed.observedShots).toBe(2);
    expect(informed.learnedShots).toBe(2);
    expect(informed.retainedShots).toBe(2);
  });

  it('initializes a new planning learner from its knowledge option and keeps broad gravity hypotheses', () => {
    const planner = planExperimentalShot(visibleWorld(world), {
      rules: { bounce: false, timeLimit: 2 }, attempt: 0, fixedPower: 65,
      startingKnowledge: 0, learningRate: 0, rng: createRng(1),
    }, (fit, decision) => {
      expect(fit.startingKnowledge).toBe(0);
      expect(fit.planets[0].mass).toBe(0);
      expect(fit.planets[0].massStandardDeviation).toBeGreaterThan(0);
      expect(decision.startingKnowledge).toBe(0);
      expect(decision.hypothesisCount).toBeGreaterThan(1);
    });
    let result = planner.next();
    while (!result.done) result = planner.next();
    expect(Number.isFinite(result.value.angle)).toBe(true);
    expect(result.value.power).toBe(65);
  });

  it('reports immutable learner knowledge even when planning options request a different prior', () => {
    const empty = { ...visibleWorld(world), planetCount: 0, visiblePlanets: [] };
    const learner = createExperimentalLearner(0);
    const aims = [0, 1].map((rate) => {
      const planner = planExperimentalShot(empty, {
        rules: { bounce: false, timeLimit: 2 }, attempt: 0, fixedPower: 65,
        learner, learningRate: rate, startingKnowledge: 1, rng: createRng(1),
      }, (fit, decision) => {
        expect(fit.startingKnowledge).toBe(0);
        expect(decision.startingKnowledge).toBe(0);
        expect(decision.learningRate).toBe(rate);
      });
      let result = planner.next();
      while (!result.done) result = planner.next();
      return result.value;
    });
    expect(aims[0]).toEqual(aims[1]);
    expect(experimentalLearnerFit(createExperimentalLearner(1), visibleWorld(world)).planets[0].mass).toBeGreaterThan(0);
  });
});
describe('experimental gravity fitting', () => {
  it('assimilates unique own evidence gradually while a frozen learner retains its prior', () => {
    const world: World = {
      width: FIELD.width, height: FIELD.height,
      ships: [{ x: 100, y: 400, alive: true }, { x: 1180, y: 400, alive: false }],
      planets: [{ x: 640, y: 520, radius: 25, mass: 20_000, seed: 1, style: 'rocky', tint: '#fff' }],
      hole: null, version: 0,
    };
    const visible = visibleWorld(world);
    const shot = new Shot(world, 0, 0, 65, { bounce: false, timeLimit: 12 });
    const points = [shot.x, shot.y];
    for (let step = 0; step < 2_000 && !shot.end; step++) {
      shot.step();
      if (step % 2 === 1) points.push(shot.x, shot.y);
    }
    const evidence = { points, angle: 0, power: 65, shotId: 1 };
    const frozen = createExperimentalLearner();
    const gradual = createExperimentalLearner();
    const full = createExperimentalLearner();
    const prior = experimentalLearnerFit(frozen, visible).planets[0].mass;
    observeExperimentalShot(frozen, evidence, visible, 0);
    observeExperimentalShot(gradual, evidence, visible, 0.25);
    observeExperimentalShot(full, evidence, visible, 1);
    const frozenFit = experimentalLearnerFit(frozen, visible);
    const gradualFit = experimentalLearnerFit(gradual, visible);
    const fullFit = experimentalLearnerFit(full, visible);
    expect(frozenFit.planets[0].mass).toBe(prior);
    expect(frozenFit.retainedShots).toBe(0);
    expect(fullFit.planets[0].mass).toBeCloseTo(world.planets[0].mass, -1);
    expect(gradualFit.planets[0].mass).toBeCloseTo(prior + 0.25 * (fullFit.planets[0].mass - prior), 4);
    expect(fullFit.predictionRms).toBeGreaterThan(fullFit.rms!);
    expect(fullFit.learnedShots).toBe(1);
    observeExperimentalShot(full, { ...evidence, points: [...points] }, visible, 1);
    expect(experimentalLearnerFit(full, visible)).toEqual(fullFit);
  });

  it.each(['planet', 'hole'] as const)('approaches the frozen %s belief continuously at tiny positive rates', (source) => {
    const world: World = {
      width: FIELD.width, height: FIELD.height,
      ships: [{ x: 100, y: 400, alive: true }, { x: 1180, y: 400, alive: false }],
      planets: source === 'planet' ? [{ x: 640, y: 520, radius: 25, mass: 20_000, seed: 1, style: 'rocky', tint: '#fff' }] : [],
      hole: source === 'hole' ? { x: 800, y: 650, radius: 30, mass: 200_000 } : null,
      version: 0,
    };
    const visible = visibleWorld(world);
    const shot = new Shot(world, 0, 0, 65, { bounce: false, timeLimit: 12 });
    const points = [shot.x, shot.y];
    for (let step = 0; step < 300 && !shot.end; step++) {
      shot.step();
      if (step % 2 === 1) points.push(shot.x, shot.y);
    }
    const fits = [0, 1e-9, 1].map((rate) => {
      const learner = createExperimentalLearner();
      observeExperimentalShot(learner, { points, angle: 0, power: 65 }, visible, rate);
      return experimentalLearnerFit(learner, visible);
    });
    const masses = fits.map((fit) => source === 'planet' ? fit.planets[0].mass : fit.holeMass!);
    const uncertainties = fits.map((fit) => source === 'planet' ? fit.planets[0].massUncertainty! : fit.holeMassUncertainty ?? 0);
    expect(Math.abs(masses[2] - masses[0])).toBeGreaterThan(1);
    expect(Math.abs(masses[1] - masses[0])).toBeLessThan(0.01);
    expect(Math.abs(uncertainties[1] - uncertainties[0])).toBeLessThan(1e-6);
    expect(fits[0].learnedShots).toBe(0);
    expect(fits[1].learnedShots).toBe(1e-9);
  });

  it('reports zero fitting time for a sample-free observation after fitting evidence', () => {
    const world: World = {
      width: FIELD.width, height: FIELD.height,
      ships: [{ x: 100, y: 400, alive: true }, { x: 1180, y: 400, alive: false }],
      planets: [{ x: 640, y: 520, radius: 25, mass: 20_000, seed: 1, style: 'rocky', tint: '#fff' }],
      hole: null, version: 0,
    };
    const visible = visibleWorld(world);
    const learner = createExperimentalLearner();
    const shot = new Shot(world, 0, 0, 65, { bounce: false, timeLimit: 12 });
    const points = [shot.x, shot.y];
    for (let step = 0; step < 300 && !shot.end; step++) {
      shot.step();
      if (step % 2 === 1) points.push(shot.x, shot.y);
    }
    observeExperimentalShot(learner, { points, angle: 0, power: 65, shotId: 1 }, visible, 1);
    expect(experimentalLearnerFit(learner, visible).fitMs).toBeGreaterThan(0);
    observeExperimentalShot(learner, { points: [], angle: 0, power: 65, shotId: 2 }, visible, 1);
    let reportedFitMs = -1;
    const planner = planExperimentalShot(visible, {
      rules: { bounce: false, timeLimit: 2 }, attempt: 2, fixedPower: 65,
      rng: createRng(1), learner, learningRate: 1,
    }, (fit) => { reportedFitMs = fit.fitMs; });
    let result = planner.next();
    while (!result.done) result = planner.next();
    expect(reportedFitMs).toBe(0);
    expect(experimentalLearnerFit(learner, visible).retainedShots).toBe(1);
  });

  it('keeps independent mass uncertainty after low-information paths despite tiny residuals', () => {
    const world: World = {
      width: FIELD.width, height: FIELD.height,
      ships: [{ x: 100, y: 80, alive: true }, { x: 1180, y: 400, alive: false }],
      planets: [
        { x: 640, y: 520, radius: 25, mass: 25 ** 3 * 0.76, seed: 1, style: 'rocky', tint: '#fff' },
        { x: 930, y: 640, radius: 30, mass: 30 ** 3 * 1.29, seed: 2, style: 'rocky', tint: '#fff' },
      ], hole: null, version: 0,
    };
    const visible = visibleWorld(world);
    const learner = createExperimentalLearner();
    for (let id = 0; id < 4; id++) {
      const shot = new Shot(world, 0, 180, 100, { bounce: false, timeLimit: 12 });
      const points = [shot.x, shot.y];
      for (let step = 0; step < 12; step++) {
        shot.step();
        if (step % 2 === 1) points.push(shot.x, shot.y);
      }
      observeExperimentalShot(learner, { points, angle: 180, power: 100, shotId: id }, visible, 1);
    }
    const fit = experimentalLearnerFit(learner, visible);
    expect(fit.learnedShots).toBe(4);
    expect(fit.rms).toBeLessThan(0.5);
    for (const planet of fit.planets) expect(planet.massUncertainty).toBeGreaterThan(0.05);
  });

  it('shrinks mass uncertainty from informative evidence, not from the observation counter', () => {
    const world: World = {
      width: FIELD.width, height: FIELD.height,
      ships: [{ x: 100, y: 400, alive: true }, { x: 1180, y: 400, alive: false }],
      planets: [{ x: 640, y: 520, radius: 25, mass: 20_000, seed: 1, style: 'rocky', tint: '#fff' }],
      hole: null, version: 0,
    };
    const visible = visibleWorld(world);
    const learner = createExperimentalLearner();
    const prior = experimentalLearnerFit(learner, visible).planets[0].massUncertainty!;
    const shot = new Shot(world, 0, 0, 65, { bounce: false, timeLimit: 12 });
    const points = [shot.x, shot.y];
    for (let step = 0; step < 2_000 && !shot.end; step++) {
      shot.step();
      if (step % 2 === 1) points.push(shot.x, shot.y);
    }
    observeExperimentalShot(learner, { points, angle: 0, power: 65 }, visible, 1);
    const fit = experimentalLearnerFit(learner, visible);
    expect(fit.planets[0].massUncertainty).toBeLessThan(prior / 10);
    expect(fit.predictionRms).toBeGreaterThan(1);
  });

  it('takes an available opening hit instead of wasting it on a probe at every rate', () => {
    const world: World = {
      width: FIELD.width, height: FIELD.height,
      ships: [{ x: 100, y: 400, alive: true }, { x: 1180, y: 400, alive: true }],
      planets: [], hole: null, version: 0,
    };
    const aims: { angle: number; power: number }[] = [];
    const decisions: { kind: string; hypothesisCount: number; hitRate: number; unsafeRate: number }[] = [];
    for (const learningRate of [0, 0.1, 0.35, 1]) {
      let kind = '';
      const planner = planExperimentalShot(visibleWorld(world), {
        rules: { bounce: false, timeLimit: 60 }, attempt: 0, fixedPower: 65,
        rng: createRng(1), learner: createExperimentalLearner(), learningRate,
      }, (_, decision) => { kind = decision.kind; decisions.push(decision); });
      let result = planner.next();
      while (!result.done) result = planner.next();
      const aim = result.value;
      aims.push(aim);
      expect(kind).toBe('exploit');
      expect(simulateShot(world, 0, aim.angle, aim.power, { bounce: false, timeLimit: 60 }).end).toEqual({ kind: 'ship', ship: 1 });
    }
    expect(aims.every((aim) => aim.angle === aims[0].angle && aim.power === aims[0].power)).toBe(true);
    for (const decision of decisions) expect(decision).toMatchObject({
      kind: 'exploit', hypothesisCount: 1, hitRate: 1, unsafeRate: 0,
    });
  });

  it('plans finite fixed-power shots from public geometry without any completed trail', () => {
    const visible: ExperimentalWorld = {
      width: FIELD.width, height: FIELD.height,
      ships: [{ x: 100, y: 400, alive: true }, { x: 1180, y: 400, alive: true }], shooter: 0,
      planetCount: 1, visiblePlanets: [{ id: 1, x: 640, y: 520, radius: 25 }],
      hasHole: false, holeRadius: 0, rules: { bounce: false }, shots: [],
    };
    const aim = planExperimental(visible);
    expect(Number.isFinite(aim.angle)).toBe(true);
    expect(Number.isFinite(aim.power)).toBe(true);
    expect(aim.power).toBeGreaterThanOrEqual(5);
    expect(aim.power).toBeLessThanOrEqual(100);
  });
  it('uses at most 500 trajectory samples', () => {
    const points = Array.from({ length: 1_020 }, (_, index) => index % 2 === 0 ? index : 400);
    const fit = fitGravity([{ points, angle: 0, power: 50 }], 0, FIELD.width, FIELD.height, false);

    expect(fit.samples).toBe(500);
  });

  it('holds the Event Horizon black hole at center when there are no observed shots', () => {
    const fit = fitGravity([], 0, FIELD.width, FIELD.height, true);

    expect(fit.holeMass).toBeCloseTo(HORIZON.START_MASS);
    expect(fit.planets).toEqual([]);
  });

  it('measures an exact planet map as a zero-error reconstruction', () => {
    const planet = { x: 300, y: 200, radius: 20, mass: 8_000, seed: 1, style: 'rocky' as const, tint: '#fff' };
    const world: World = {
      width: FIELD.width,
      height: FIELD.height,
      ships: [],
      planets: [planet],
      hole: null,
      version: 0,
    };
    const fit = fitGravity([], 1, FIELD.width, FIELD.height, false);
    fit.planets[0] = { x: planet.x, y: planet.y, mass: planet.mass };

    expect(measureReconstruction(world, fit)).toMatchObject({
      planetMatches: [{ positionError: 0, massError: 0 }],
      gravityRms: 0,
      relativeGravityRms: 0,
    });
  });


  it('reduces gravity residual on a known one-planet trajectory', () => {
    const world: World = {
      width: FIELD.width,
      height: FIELD.height,
      ships: [{ x: 100, y: 400, alive: true }, { x: 1180, y: 400, alive: false }],
      planets: [{ x: 640, y: 520, radius: 25, mass: 15_625, seed: 1, style: 'rocky', tint: '#fff' }],
      hole: null,
      version: 0,
    };
    const shot = new Shot(world, 0, 0, 50, { bounce: false, timeLimit: 12 });
    const trail: number[] = [shot.x, shot.y];
    for (let step = 0; step < 2_000 && !shot.end; step++) {
      shot.step();
      if (step % 2 === 1) trail.push(shot.x, shot.y);
    }
    const fit = fitGravity([{ points: trail, angle: 0, power: 50 }], 1, FIELD.width, FIELD.height, false);
    const quality = measureReconstruction(world, fit);

    expect(fit.samples).toBeGreaterThan(100);
    expect(fit.rms).toBeLessThan(fit.initialRms!);
    expect(fit.validationRms).toBeNull();
    expect(quality.relativeGravityRms).toBeLessThan(1);
  });
  it('fits only the centered black hole mass from its trajectory curvature', () => {
    const world: World = {
      width: FIELD.width,
      height: FIELD.height,
      ships: [{ x: 100, y: 400, alive: true }, { x: 1180, y: 400, alive: false }],
      planets: [],
      hole: { x: FIELD.width / 2, y: FIELD.height / 2, radius: 16, mass: HORIZON.START_MASS },
      version: 0,
    };
    const shot = new Shot(world, 0, 0, 50, { bounce: true, timeLimit: 12 });
    const trail: number[] = [shot.x, shot.y];
    for (let step = 0; step < 2_000 && !shot.end; step++) {
      shot.step();
      if (step % 2 === 1) trail.push(shot.x, shot.y);
    }
    const fit = fitGravity([{ points: trail, angle: 0, power: 50 }], 0, FIELD.width, FIELD.height, true, { bounce: true });

    expect(fit.samples).toBeGreaterThan(100);
    expect(fit.holeMass).toBeCloseTo(world.hole!.mass, -4);
  });

  it('validates a fit against the newest completed trajectory', () => {
    const world: World = {
      width: FIELD.width,
      height: FIELD.height,
      ships: [{ x: 100, y: 400, alive: true }, { x: 1180, y: 400, alive: false }],
      planets: [{ x: 640, y: 520, radius: 25, mass: 15_625, seed: 1, style: 'rocky', tint: '#fff' }],
      hole: null,
      version: 0,
    };
    const trails: { points: number[]; angle: number; power: number }[] = [];
    for (const angle of [-8, 0]) {
      const shot = new Shot(world, 0, angle, 50, { bounce: false, timeLimit: 12 });
      const points = [shot.x, shot.y];
      for (let step = 0; step < 2_000 && !shot.end; step++) {
        shot.step();
        if (step % 2 === 1) points.push(shot.x, shot.y);
      }
      trails.push({ points, angle, power: 50 });
    }

    const fit = fitGravity(trails, 1, FIELD.width, FIELD.height, false);

    expect(fit.validationSamples).toBeGreaterThan(100);
    expect(fit.validationRms).not.toBeNull();
    expect(fit.fitMs).toBeGreaterThanOrEqual(0);
  });

  it('retains only a bounded set of distinct gravity hypotheses', () => {
    const world: World = {
      width: FIELD.width,
      height: FIELD.height,
      ships: [{ x: 100, y: 400, alive: true }, { x: 1180, y: 400, alive: false }],
      planets: [{ x: 640, y: 520, radius: 25, mass: 15_625, seed: 1, style: 'rocky', tint: '#fff' }],
      hole: null,
      version: 0,
    };
    const shot = new Shot(world, 0, 0, 50, { bounce: false, timeLimit: 12 });
    const points = [shot.x, shot.y];
    for (let step = 0; step < 2_000 && !shot.end; step++) {
      shot.step();
      if (step % 2 === 1) points.push(shot.x, shot.y);
    }

    const fits = fitGravityHypotheses([{ points, angle: 0, power: 50 }], 1, FIELD.width, FIELD.height, false);

    expect(fits.length).toBeGreaterThan(0);
    expect(fits.length).toBeLessThanOrEqual(4);
    expect(fits.every((fit) => fit.rms !== null && fit.fitMs >= 0)).toBe(true);

    const learner = createExperimentalLearner();
    const visible: ExperimentalWorld = { ...visibleWorld(world), visiblePlanets: undefined };
    observeExperimentalShot(learner, { points, angle: 0, power: 50 }, visible, 1);
    let plannedHypotheses = 0;
    const planner = planExperimentalShot(visible, {
      rules: { bounce: false, timeLimit: 2 }, attempt: 1, fixedPower: 50,
      rng: createRng(1), learner, learningRate: 1,
    }, (_, decision) => { plannedHypotheses = decision.hypothesisCount; });
    let result = planner.next();
    while (!result.done) result = planner.next();
    // The central fit and its density samples do not replace positional alternatives.
    expect(plannedHypotheses).toBe(8 + fits.length);
    expect(plannedHypotheses).toBeGreaterThan(9);
  });

});
