import { describe, expect, it } from 'vitest';
import { FIELD, HORIZON } from '../src/config';
import { fitGravity, fitGravityHypotheses, measureReconstruction, planExperimentalShot, type ExperimentalWorld } from '../src/experimental-ai';
import { Shot, type World } from '../src/physics';
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
describe('experimental gravity fitting', () => {
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

  it('uses visible planet centers and fixed power 45 for the opening shot', () => {
    const aim = planExperimental({
      width: FIELD.width,
      height: FIELD.height,
      ships: [{ x: 100, y: 400, alive: true }, { x: 1180, y: 400, alive: true }],
      shooter: 0,
      planetCount: 1,
      visiblePlanetPositions: [{ x: 640, y: 520 }],
      hasHole: false,
      holeRadius: 0,
      rules: { bounce: false },
      shots: [],
    });

    expect(aim.power).toBe(45);
  });

  it('uses only reconstructed trajectories after the opening shot', () => {
    const world: World = {
      width: FIELD.width,
      height: FIELD.height,
      ships: [{ x: 100, y: 400, alive: true }, { x: 1180, y: 400, alive: true }],
      planets: [{ x: 640, y: 520, radius: 25, mass: 15_625, seed: 1, style: 'rocky', tint: '#fff' }],
      hole: null,
      version: 0,
    };
    const shot = new Shot(world, 0, 0, 45, { bounce: false, timeLimit: 12 });
    const points = [shot.x, shot.y];
    for (let step = 0; step < 2_000 && !shot.end; step++) {
      shot.step();
      if (step % 2 === 1) points.push(shot.x, shot.y);
    }
    const base: Omit<ExperimentalWorld, 'visiblePlanetPositions'> = {
      width: FIELD.width,
      height: FIELD.height,
      ships: world.ships,
      shooter: 0,
      planetCount: 1,
      hasHole: false,
      holeRadius: 0,
      rules: { bounce: false },
      shots: [{ points, angle: 0, power: 45 }],
    };

    expect(planExperimental({ ...base, visiblePlanetPositions: [{ x: 640, y: 520 }] })).toEqual(
      planExperimental({ ...base, visiblePlanetPositions: [{ x: 200, y: 200 }] }),
    );
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
  });

  it('uses a larger interactive sample cap after two long trails', () => {
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

    const fits = fitGravityHypotheses(trails, 1, FIELD.width, FIELD.height, false, { bounce: false }, 96);

    expect(fits[0].samples).toBe(96);
  });
});
