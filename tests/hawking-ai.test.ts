import { describe, expect, it, vi } from 'vitest';
import { planShot, planShotNow, type CpuLevel } from '../src/ai';
import { FIELD, PHYSICS } from '../src/config';
import { normalizeAngle, Shot, simulateShot, simulateStyledShot, type StyledShotOutcome, type World } from '../src/physics';
import * as physics from '../src/physics';
import { createRng, gaussian, type Rng } from '../src/rng';

const rules = { bounce: false, timeLimit: 12 };
const emptyWorld = (): World => ({
  ...FIELD, planets: [], hole: null, version: 0,
  ships: [{ x: 100, y: 400, alive: true }, { x: 1180, y: 400, alive: true }],
});
function finish<T>(it: Generator<void, T>): { result: T; yields: number } {
  let yields = 0;
  for (;;) {
    const next = it.next();
    if (next.done) return { result: next.value, yields };
    yields++;
  }
}
function styled(world: World, angle: number, power: number, timeLimit = 12, friends: number[] = []): StyledShotOutcome {
  return finish(simulateStyledShot(world, 0, angle, power, { ...rules, timeLimit }, friends)).result;
}
function orbitWorld(): { world: World; power: number } {
  const mass = 45 ** 3;
  return {
    world: {
      ...FIELD, version: 0, hole: null,
      planets: [{ x: 640, y: 400, radius: 45, mass, seed: 1, style: 'rocky', tint: '#fff' }],
      ships: [{ x: 790, y: 380, alive: false }],
    },
    // Elliptical orbit: apocentre 150, pericentre 75, crossing the encounter boundary each lap.
    power: Math.sqrt(PHYSICS.G * mass * 2 * 75 / (150 * (150 + 75))) / PHYSICS.SPEED_PER_POWER,
  };
}

describe('Hawking production flight metrics', () => {
  it('counts repeated passes of one planet exactly like the live style log without retaining events', () => {
    const { world, power } = orbitWorld();
    const live = new Shot(world, 0, 270, power, rules, true);
    while (!live.step());
    const events = live.style!.filter((event) => event.kind === 'swingby');
    expect(events.length).toBeGreaterThan(2);
    const metrics = styled(world, 270, power);
    expect(metrics.swingbys).toBe(events.length);
    expect(metrics.flightTime).toBe(live.time);
    expect(metrics.end).toEqual(live.end);
    const compact = new Shot(world, 0, 270, power, rules, 'metrics');
    while (!compact.step());
    expect(compact.style).toBeNull();
    expect(compact.swingbys).toBe(events.length);
  });

  it('uses identical own-ship grace and teammate closest-approach math', () => {
    const world = emptyWorld();
    world.ships.push({ x: 500, y: 460, alive: true });
    for (const angle of [0, 12, 180]) {
      const ordinary = simulateShot(world, 0, angle, 50, rules, [2]);
      const metrics = styled(world, angle, 50, 12, [2]);
      expect(metrics.end).toEqual(ordinary.end);
      expect(metrics.closest).toBe(ordinary.closest);
      expect(metrics.selfClosest).toBe(ordinary.selfClosest);
    }
  });

  it('slices a 60-second flight into bounded physics chunks instead of clipping it to 12 seconds', () => {
    const world = emptyWorld();
    world.width = 100_000;
    world.height = 100_000;
    world.ships[1] = { x: 90_000, y: 90_000, alive: true };
    const flight = finish(simulateStyledShot(world, 0, 0, 15, { bounce: false, timeLimit: 60 }));
    expect(flight.result.end.kind).toBe('timeout');
    expect(flight.result.flightTime).toBeGreaterThanOrEqual(60);
    expect(flight.result.pathLength).toBeGreaterThan(7_000);
    expect(flight.yields).toBeGreaterThanOrEqual(59);
    const planner = planShot(world, 0, {
      level: 'hawking', rules: { bounce: false, timeLimit: 60 }, lookahead: 12,
      attempt: 30, fixedPower: 15, effort: 0.01, rng: () => 0,
    });
    // The first launch follows the target diagonal and remains in this large world.
    // It must yield within that candidate, well before the outer four-candidate slice.
    for (let i = 0; i < 20; i++) expect(planner.next().done).toBe(false);
    planner.return({ angle: 0, power: 15 });
  });
});

describe('Hawking classic search', () => {
  for (const level of ['easy', 'medium', 'hard', 'hawking'] as const) {
    for (const noiseFree of [false, true]) {
      it(`${level} keeps searched and live power capped with noiseFree=${noiseFree}`, () => {
        const world = emptyWorld();
        world.ships[1] = { x: 170, y: 400, alive: true };
        const ordinary = vi.spyOn(physics, 'simulateShot');
        const styledFlight = vi.spyOn(physics, 'simulateStyledShot');
        try {
          for (const fixedPower of [null, 55, 5]) {
            const aim = planShotNow(world, 0, {
              level, rules: { ...rules, timeLimit: 0.3 }, attempt: 0,
              fixedPower, maxPower: 10, effort: 0.03, noiseFree, optimizeHitPower: true, rng: createRng(90210),
            });
            const shot = new Shot(world, 0, aim.angle, aim.power, rules, true);
            expect(shot.power).toBeLessThanOrEqual(10);
            expect(shot.power).toBeGreaterThanOrEqual(0);
            if (fixedPower !== null) expect(shot.power).toBe(Math.min(fixedPower, 10));
          }
          const calls = [...ordinary.mock.calls, ...styledFlight.mock.calls];
          expect(calls.length).toBeGreaterThan(0);
          for (const [, , , power] of calls) expect(power).toBeLessThanOrEqual(10);
        } finally {
          ordinary.mockRestore();
          styledFlight.mockRestore();
        }
      });
    }
  }

  it('keeps Hawking full-length style flights within a low power cap', () => {
    const world = emptyWorld();
    world.width = 100_000;
    world.height = 100_000;
    world.ships[1] = { x: 90_000, y: 90_000, alive: true };
    const aim = planShotNow(world, 0, {
      level: 'hawking', rules: { bounce: false, timeLimit: 20 }, lookahead: 0.1,
      attempt: 0, fixedPower: 55, maxPower: 10, effort: 0.01, rng: createRng(42),
    });
    expect(aim.power).toBe(10);
    const result = styled(world, aim.angle, aim.power, 20);
    expect(result.end.kind).toBe('timeout');
    expect(result.flightTime).toBeGreaterThanOrEqual(20);
    expect(result.pathLength).toBeCloseTo(result.flightTime * 10 * PHYSICS.SPEED_PER_POWER, 5);
  });

  it('selects a longer swing-by hit over the available cheaper direct hit', () => {
    const { world, power } = orbitWorld();
    const scouting = new Shot(world, 0, 270, power, rules, true);
    while (!scouting.end && scouting.swingbys === 0) scouting.step();
    expect(scouting.swingbys).toBe(1);
    world.ships[0].alive = true;
    world.ships.push({ x: 850, y: 380, alive: true });
    world.ships.push({ x: scouting.x, y: scouting.y, alive: true });
    const direct = styled(world, 0, power);
    const curved = styled(world, 270, power);
    expect(direct.end).toEqual({ kind: 'ship', ship: 1 });
    expect(curved.end).toEqual({ kind: 'ship', ship: 2 });
    expect(curved.selfClosest).toBeGreaterThanOrEqual(45);
    expect(curved.swingbys).toBeGreaterThan(direct.swingbys);
    expect(curved.flightTime).toBeGreaterThan(direct.flightTime);
    // Supply both physical launches in the normal random sweep, then a seeded search.
    const rng = (): Rng => {
      const prefix = [0, 0, 0.75];
      const rest = createRng(42);
      return () => prefix.length ? prefix.shift()! : rest();
    };
    const run = (level: 'hard' | 'hawking') => {
      const aim = planShotNow(world, 0, { rules, level, attempt: 30, fixedPower: power, rng: rng(), effort: 0.3 });
      return styled(world, aim.angle, aim.power);
    };
    const hard = run('hard');
    const hawking = run('hawking');
    expect(hard.end.kind).toBe('ship');
    expect(hawking.end.kind).toBe('ship');
    expect(hawking.selfClosest).toBeGreaterThanOrEqual(45);
    expect(hawking.swingbys).toBeGreaterThan(hard.swingbys);
    expect(hawking.flightTime).toBeGreaterThan(hard.flightTime);
  });

  it.each([0, 4])('uses the hard Gaussian execution error and decay at attempt %i', (attempt) => {
    const world = emptyWorld();
    const launches: { angle: number; power: number }[] = [];
    const draws: number[][] = [];
    for (const n of [attempt, 30]) {
      const sequence: number[] = [];
      const source = createRng(90210);
      launches.push(planShotNow(world, 0, {
        level: 'hawking', rules, attempt: n, fixedPower: null, effort: 0.03,
        rng: () => { const draw = source(); sequence.push(draw); return draw; },
      }));
      draws.push(sequence);
    }
    expect(draws[0]).toEqual(draws[1]);
    const tail = draws[0].slice(-4);
    const errorRng = () => tail.shift()!;
    const angleError = gaussian(errorRng) * 0.5;
    const powerError = gaussian(errorRng) * 0.5;
    const decayDifference = 0.45 ** attempt - 0.45 ** 30;
    expect(normalizeAngle(launches[0].angle - launches[1].angle)).toBeCloseTo(normalizeAngle(angleError * decayDifference), 8);
    expect(launches[0].power - launches[1].power).toBeCloseTo(powerError * decayDifference, 8);
  });

  it('keeps fixed power unchanged and avoids teammates even when the direct enemy line is blocked', () => {
    const world = emptyWorld();
    world.ships.push({ x: 640, y: 400, alive: true });
    for (const seed of [1, 7, 23]) {
      const aim = planShotNow(world, 0, {
        level: 'hawking', rules, attempt: 30, fixedPower: 55, rng: createRng(seed), friends: [2], effort: 0.1,
      });
      const result = styled(world, aim.angle, aim.power, 12, [2]);
      expect(aim.power).toBe(55);
      expect(result.end).not.toEqual({ kind: 'ship', ship: 0 });
      expect(result.end).not.toEqual({ kind: 'ship', ship: 2 });
      expect(result.selfClosest).toBeGreaterThanOrEqual(45);
    }
  });

  it('returns a finite legal fallback when no opponents are alive', () => {
    const world = emptyWorld();
    world.ships[1].alive = false;
    const level: CpuLevel = 'hawking';
    for (const fixedPower of [null, 55]) {
      const aim = planShotNow(world, 0, { level, rules, attempt: 0, fixedPower, rng: createRng(13) });
      expect(Number.isFinite(aim.angle)).toBe(true);
      expect(aim.angle).toBeGreaterThanOrEqual(0);
      expect(aim.angle).toBeLessThan(360);
      expect(aim.power).toBeGreaterThanOrEqual(15);
      expect(aim.power).toBeLessThanOrEqual(100);
      if (fixedPower !== null) expect(aim.power).toBe(fixedPower);
    }
  });
});
