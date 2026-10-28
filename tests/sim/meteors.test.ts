import { describe, expect, it } from 'vitest';
import { FIELD, SUDDEN_DEATH } from '../../src/sim/config';
import { landing, planMeteors } from '../../src/sim/meteors';
import { createRng } from '../../src/sim/rng';
import type { BlackHole, Planet, Ship, World } from '../../src/sim/physics';

const { METEORS } = SUDDEN_DEATH;
const ship = (x: number, y: number): Ship => ({ x, y, alive: true });
const planet = (x: number, y: number, radius: number, mass: number): Planet => ({ x, y, radius, mass, seed: 1, style: 'rock', tint: '#fff' }) as unknown as Planet;
const world = (ships: Ship[], planets: Planet[] = [], holes: BlackHole[] = []): World => ({ width: FIELD.width, height: FIELD.height, planets, ships, holes, nebulae: [], wormholes: [], defenses: [], version: 0 });
const ships = [ship(200, 300), ship(1050, 250), ship(640, 640)];
const inField = (x: number, y: number): boolean => x >= 0 && x <= FIELD.width && y >= 0 && y <= FIELD.height;
const pairs = (points: number[]): [number, number][] => points.map((_, i) => i).filter((i) => i % 2 === 0).map((i) => [points[i], points[i + 1]]);

describe('planMeteors', () => {
  const w = world(ships, [planet(640, 400, 40, 60_000), planet(300, 560, 25, 20_000)]);

  it('sends a meteor at every ship, ending on it, and one at every planet, ending on its rim', () => {
    const paths = planMeteors(w, [0, 1, 2], createRng(7));
    const own = paths.filter((p) => p.ship !== null);
    expect(own.map((p) => p.ship)).toEqual([0, 1, 2]);
    for (const p of own) {
      const target = w.ships[p.ship!];
      const [x, y] = pairs(p.points).at(-1)!;
      expect(Math.hypot(x - target.x, y - target.y)).toBeLessThan(1);
    }
    const rocks = paths.filter((p) => p.planet !== null);
    expect(rocks.map((p) => p.planet)).toEqual([0, 1]);
    expect(paths).toHaveLength(own.length + rocks.length);
    for (const p of rocks) {
      const rock = w.planets[p.planet!];
      const [x, y] = pairs(p.points).at(-1)!;
      expect(Math.abs(Math.hypot(x - rock.x, y - rock.y) - rock.radius)).toBeLessThan(3);
      expect(p.ship).toBeNull();
    }
  });

  it('leaves out the planets beyond what the wire holds, and has none to send on an empty field', () => {
    const crowded = world(ships, Array.from({ length: 30 }, (_, i) => planet(100 + (i % 10) * 110, 100 + Math.floor(i / 10) * 250, 12, 5_000)));
    expect(planMeteors(crowded, [0, 1, 2], createRng(3))).toHaveLength(METEORS.MAX_PATHS);
    expect(planMeteors(world(ships), [0, 1, 2], createRng(3)).every((p) => p.planet === null)).toBe(true);
  });

  it('starts outside the field and lasts long enough to be seen', () => {
    for (const p of planMeteors(w, [0, 1, 2], createRng(7))) {
      const [x, y] = pairs(p.points)[0];
      expect(inField(x, y)).toBe(false);
      expect(p.points.length / 2).toBeGreaterThanOrEqual(Math.ceil(METEORS.MIN_TIME * METEORS.RATE) + 1);
      expect(landing(p)).toBeGreaterThanOrEqual(p.delay);
    }
  });

  it('stays within what the wire allows', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const paths = planMeteors(w, [0, 1, 2], createRng(seed));
      expect(paths.length).toBeLessThanOrEqual(METEORS.MAX_PATHS);
      for (const p of paths) {
        expect(p.points.length).toBeLessThanOrEqual(2 * METEORS.MAX_SAMPLES);
        expect(p.points.length % 2).toBe(0);
        expect(p.points.every(Number.isInteger)).toBe(true);
      }
    }
  });

  it('is the same every time for one seed, and differs between seeds', () => {
    expect(planMeteors(w, [0, 1, 2], createRng(7))).toEqual(planMeteors(w, [0, 1, 2], createRng(7)));
    expect(planMeteors(w, [0, 1, 2], createRng(7))).not.toEqual(planMeteors(w, [0, 1, 2], createRng(8)));
  });

  it('never flies through a planet or a hole on the way to a ship', () => {
    const hole = { x: 900, y: 500, radius: 20, mass: 80_000 };
    const crowded = world(ships, w.planets, [hole]);
    for (let seed = 1; seed <= 20; seed++) {
      for (const p of planMeteors(crowded, [0, 1, 2], createRng(seed)).filter((q) => q.ship !== null)) {
        for (const [x, y] of pairs(p.points)) {
          for (const body of [...crowded.planets, hole]) expect(Math.hypot(x - body.x, y - body.y)).toBeGreaterThan(body.radius - 2);
        }
      }
    }
  });

  it('bends round a heavy planet instead of flying straight', () => {
    const heavy = world([ship(300, 400)], [planet(640, 400, 40, 400_000)]);
    let bent = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const [path] = planMeteors(heavy, [0], createRng(seed));
      const p = pairs(path.points);
      const [a, b] = [p[0], p[p.length - 1]];
      const chord = Math.hypot(b[0] - a[0], b[1] - a[1]);
      // How far the middle of the path lies off the straight line from its start to the ship.
      const mid = p[Math.floor(p.length / 2)];
      const off = Math.abs((b[0] - a[0]) * (a[1] - mid[1]) - (a[0] - mid[0]) * (b[1] - a[1])) / chord;
      if (off > 8) bent++;
    }
    expect(bent).toBeGreaterThan(5);
  });
});
