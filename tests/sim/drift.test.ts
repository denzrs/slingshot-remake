import { describe, expect, it } from 'vitest';
import { FIELD, PHYSICS, SUDDEN_DEATH } from '../../src/sim/config';
import { planCollision } from '../../src/sim/drift';
import type { BlackHole, Planet, Ship, World } from '../../src/sim/physics';

const { COLLISION } = SUDDEN_DEATH;
const ship = (x: number, y: number): Ship => ({ x, y, alive: true });
const world = (ships: Ship[], planets: Partial<Planet>[] = [], holes: BlackHole[] = []): World => ({
  width: FIELD.width,
  height: FIELD.height,
  planets: planets as Planet[],
  ships,
  holes,
  nebulae: [],
  wormholes: [],
  defenses: [],
  version: 0,
});
const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);
const landed = (moves: ReturnType<typeof planCollision>, i: number): { x: number; y: number } => ({ x: moves[i].toX, y: moves[i].toY });

describe('planCollision', () => {
  const left = ship(100, 400);
  const right = ship(1180, 400);

  it('moves every ship toward the middle by the same share, so each gap shrinks by it', () => {
    const moves = planCollision(world([left, right]), [0, 1], 1);
    expect(landed(moves, 0).x).toBeCloseTo(100 + (FIELD.width / 2 - 100) * COLLISION.FRACTION, 6);
    expect(dist(landed(moves, 0), landed(moves, 1))).toBeCloseTo(dist(left, right) * (1 - COLLISION.FRACTION), 6);
  });

  it('pulls harder with each pass, up to a limit', () => {
    const gapAt = (step: number): number => {
      const moves = planCollision(world([left, right]), [0, 1], step);
      return dist(landed(moves, 0), landed(moves, 1));
    };
    expect(gapAt(2)).toBeLessThan(gapAt(1));
    expect(gapAt(30)).toBeCloseTo(gapAt(31), 6);
    expect(gapAt(30)).toBeCloseTo(dist(left, right) * (1 - COLLISION.FRACTION_MAX), 6);
  });

  it('stops two ships at the minimum gap', () => {
    const moves = planCollision(world([ship(600, 400), ship(600 + COLLISION.MIN_GAP + 10, 400)]), [0, 1], 1);
    expect(dist(landed(moves, 0), landed(moves, 1))).toBeGreaterThanOrEqual(COLLISION.MIN_GAP - 1e-6);
  });

  it('lets ships that are already closer than the minimum gap stay put', () => {
    const moves = planCollision(world([ship(600, 400), ship(640, 400)]), [0, 1], 1);
    expect(dist(landed(moves, 0), landed(moves, 1))).toBeGreaterThanOrEqual(40 - 1e-6);
  });

  it('stops a ship short of a planet in its way', () => {
    const planet = { x: 400, y: 400, radius: 40 };
    const moves = planCollision(world([left, right], [planet]), [0, 1], 30);
    expect(dist(landed(moves, 0), planet)).toBeGreaterThanOrEqual(planet.radius + PHYSICS.SHIP_RADIUS + COLLISION.MARGIN - 1e-6);
  });

  it('stops a ship short of a black hole in its way', () => {
    const hole = { x: 400, y: 400, radius: 30, mass: 1 };
    const moves = planCollision(world([left, right], [], [hole]), [0, 1], 30);
    expect(dist(landed(moves, 0), hole)).toBeGreaterThanOrEqual(hole.radius + PHYSICS.SHIP_RADIUS + COLLISION.MARGIN - 1e-6);
  });

  it('only moves the ships it is given, and gives the same answer every time', () => {
    const w = world([left, right, ship(640, 100)]);
    const moves = planCollision(w, [0, 2], 3);
    expect(moves.map((m) => m.id)).toEqual([0, 2]);
    expect(planCollision(w, [0, 2], 3)).toEqual(moves);
  });
});
