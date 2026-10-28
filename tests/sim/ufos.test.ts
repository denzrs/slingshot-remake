import { describe, expect, it } from 'vitest';
import { FIELD, SUDDEN_DEATH } from '../../src/sim/config';
import { planUfos, zapAt } from '../../src/sim/ufos';
import { createRng } from '../../src/sim/rng';
import type { Planet, Ship, World } from '../../src/sim/physics';

const { UFOS } = SUDDEN_DEATH;
const ship = (x: number, y: number): Ship => ({ x, y, alive: true });
const planet = (x: number, y: number, radius: number): Planet => ({ x, y, radius, mass: 1, seed: 1, style: 'rock', tint: '#fff' }) as unknown as Planet;
const world = (ships: Ship[], planets: Planet[] = []): World => ({ width: FIELD.width, height: FIELD.height, planets, ships, holes: [], nebulae: [], wormholes: [], defenses: [], version: 0 });
const ships = [ship(200, 300), ship(1050, 250), ship(640, 640)];
const inField = (x: number, y: number): boolean => x >= 0 && x <= FIELD.width && y >= 0 && y <= FIELD.height;
const last = (points: number[]): [number, number] => [points[points.length - 2], points[points.length - 1]];

describe('planUfos', () => {
  const w = world(ships, [planet(640, 400, 40), planet(300, 560, 25), planet(900, 500, 30)]);

  it('sends a saucer for every ship, aimed at it, and one for every planet, zapping its rim', () => {
    const paths = planUfos(w, [0, 1, 2], createRng(5));
    const own = paths.filter((p) => p.ship !== null);
    expect(own.map((p) => p.ship)).toEqual([0, 1, 2]);
    for (const p of own) expect(p.target).toEqual([Math.round(w.ships[p.ship!].x), Math.round(w.ships[p.ship!].y)]);
    const rocks = paths.filter((p) => p.planet !== null);
    expect(rocks.map((p) => p.planet)).toEqual([0, 1, 2]);
    expect(paths).toHaveLength(own.length + rocks.length);
    for (const p of rocks) {
      const rock = w.planets[p.planet!];
      expect(Math.abs(Math.hypot(p.target[0] - rock.x, p.target[1] - rock.y) - rock.radius)).toBeLessThan(2);
    }
  });

  it('flies in from outside the field and settles in the field, within range of its ship, with a clear line of fire', () => {
    for (let seed = 1; seed <= 30; seed++) {
      for (const p of planUfos(w, [0, 1, 2], createRng(seed)).filter((q) => q.ship !== null)) {
        const [sx, sy] = [p.points[0], p.points[1]];
        expect(inField(sx, sy)).toBe(false);
        const [hx, hy] = last(p.points);
        expect(inField(hx, hy)).toBe(true);
        const gap = Math.hypot(hx - p.target[0], hy - p.target[1]);
        expect(gap).toBeGreaterThan(UFOS.HOVER_MIN - 3);
        expect(gap).toBeLessThan(UFOS.HOVER_MAX + 3);
        // Nothing stands between the saucer and its ship.
        for (const q of w.planets) {
          const [dx, dy] = [p.target[0] - hx, p.target[1] - hy];
          const k = Math.max(0, Math.min(1, ((q.x - hx) * dx + (q.y - hy) * dy) / (dx * dx + dy * dy)));
          expect(Math.hypot(hx + dx * k - q.x, hy + dy * k - q.y)).toBeGreaterThan(q.radius);
        }
      }
    }
  });

  it('is seen long enough, and zaps after it has charged', () => {
    for (const p of planUfos(w, [0, 1, 2], createRng(5))) {
      expect(p.points.length / 2).toBeGreaterThanOrEqual(Math.ceil(UFOS.MIN_TIME * UFOS.RATE) + 1);
      expect(zapAt(p)).toBeCloseTo(p.delay + (p.points.length / 2 - 1) / UFOS.RATE + UFOS.CHARGE, 9);
    }
  });

  it('stays within what the wire allows', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const paths = planUfos(w, [0, 1, 2], createRng(seed));
      expect(paths.length).toBeLessThanOrEqual(UFOS.MAX_PATHS);
      for (const p of paths) {
        expect(p.points.length).toBeLessThanOrEqual(2 * UFOS.MAX_SAMPLES);
        expect(p.points.length % 2).toBe(0);
        expect(p.points.every(Number.isInteger)).toBe(true);
        expect(p.delay).toBeLessThanOrEqual(Math.max(UFOS.DELAY_SHIP, UFOS.DELAY_PLANET));
      }
    }
  });

  it('is the same every time for one seed, differs between seeds, and has no planets to zap on an empty field', () => {
    expect(planUfos(w, [0, 1, 2], createRng(5))).toEqual(planUfos(w, [0, 1, 2], createRng(5)));
    expect(planUfos(w, [0, 1, 2], createRng(5))).not.toEqual(planUfos(w, [0, 1, 2], createRng(6)));
    expect(planUfos(world(ships), [0, 1, 2], createRng(5)).every((p) => p.planet === null)).toBe(true);
  });
});
