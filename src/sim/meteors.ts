import { PHYSICS, SUDDEN_DEATH } from './config';
import type { World } from './physics';
import { range, type Rng } from './rng';

const { METEORS } = SUDDEN_DEATH;
const { DT, G } = PHYSICS;
/** Physics steps between two samples of a path. */
const STRIDE = Math.max(1, Math.round(1 / (METEORS.RATE * DT)));
/** A path has at least this many samples (so a meteor is a streak, not a blink). */
const MIN_SAMPLES = Math.ceil(METEORS.MIN_TIME * METEORS.RATE) + 1;

/** One meteor: its path as x, y pairs sampled `RATE` times a second (rounded to whole px), from `delay` s after the blast. */
export interface MeteorPath {
  /** The ship it hits (its path ends on it), or null. */
  ship: number | null;
  /** The planet it hits (an index into `world.planets`; its path ends on the rim), or null. */
  planet: number | null;
  delay: number;
  points: number[];
}

/** When the meteor lands (s after the blast). */
export const landing = (path: Pick<MeteorPath, 'delay' | 'points'>): number => path.delay + (path.points.length / 2 - 1) / METEORS.RATE;

function pull(world: World, x: number, y: number): [number, number] {
  let ax = 0;
  let ay = 0;
  for (const p of world.planets) {
    const dx = p.x - x;
    const dy = p.y - y;
    const d2 = dx * dx + dy * dy;
    const a = ((p.reversed ? -G : G) * p.mass) / d2 / Math.sqrt(d2);
    ax += a * dx;
    ay += a * dy;
  }
  for (const h of world.holes) {
    const dx = h.x - x;
    const dy = h.y - y;
    const d2 = dx * dx + dy * dy;
    const a = (G * h.mass) / d2 / Math.sqrt(d2);
    ax += a * dx;
    ay += a * dy;
  }
  return [ax, ay];
}

const struck = (world: World, x: number, y: number): boolean =>
  world.planets.some((p) => Math.hypot(p.x - x, p.y - y) < p.radius) || world.holes.some((h) => Math.hypot(h.x - x, h.y - y) < h.radius);

/**
 * Flies a body from (x, y) at (vx, vy) under the gravity of the planets and holes, with the velocity Verlet step, which
 * runs the same way backwards: that is what lets a path be flown from the ship outwards and walked in reverse.
 * Ends when it leaves the field by the margin ('out'), strikes a planet or a hole ('hit') or takes too long ('time').
 */
function fly(world: World, x: number, y: number, vx: number, vy: number): { points: number[]; end: 'out' | 'hit' | 'time' } {
  const points = [x, y];
  let [ax, ay] = pull(world, x, y);
  const m = METEORS.MARGIN;
  for (let i = 1, last = Math.round(METEORS.MAX_TIME / DT); i <= last; i++) {
    x += vx * DT + 0.5 * ax * DT * DT;
    y += vy * DT + 0.5 * ay * DT * DT;
    const [nx, ny] = pull(world, x, y);
    vx += 0.5 * (ax + nx) * DT;
    vy += 0.5 * (ay + ny) * DT;
    [ax, ay] = [nx, ny];
    if (struck(world, x, y)) return { points: [...points, x, y], end: 'hit' };
    const out = x < -m || x > world.width + m || y < -m || y > world.height + m;
    if (i % STRIDE === 0 || out) points.push(x, y);
    if (out) return { points, end: 'out' };
  }
  return { points, end: 'time' };
}

const reversed = (points: number[]): number[] => {
  const out: number[] = [];
  for (let i = points.length - 2; i >= 0; i -= 2) out.push(points[i], points[i + 1]);
  return out;
};

/**
 * A meteor that ends at (x, y): flown from there outwards (along `heading`, give or take, if there is one), then walked
 * backwards, so it arrives bent by the same gravity.
 */
function aimedAt(world: World, x: number, y: number, rng: Rng, heading?: number): number[] {
  for (let tries = 0; tries < METEORS.ATTEMPTS; tries++) {
    const a = heading === undefined ? rng() * Math.PI * 2 : heading + range(rng, -0.6, 0.6);
    const { points, end } = fly(world, x, y, Math.cos(a) * METEORS.SPEED, Math.sin(a) * METEORS.SPEED);
    if (end === 'out' && points.length / 2 >= MIN_SAMPLES) return reversed(points);
  }
  // No clear way in under the gravity: a straight one, from outside the field.
  const a = heading ?? rng() * Math.PI * 2;
  const reach = Math.max(world.width, world.height);
  const samples = Math.ceil((reach / METEORS.SPEED) * METEORS.RATE);
  const points: number[] = [];
  for (let i = 0; i <= samples; i++) {
    const k = 1 - i / samples;
    points.push(x + Math.cos(a) * reach * k, y + Math.sin(a) * reach * k);
  }
  return points;
}

/**
 * The meteor shower of sudden death's finale: one meteor for each of `ids` (a ship it hits) and one for every planet (it
 * ends on the rim, on the side the meteor comes from). Pure and deterministic: the same world and generator always
 * give the same paths.
 */
export function planMeteors(world: World, ids: readonly number[], rng: Rng): MeteorPath[] {
  const round = (points: number[]): number[] => points.map((n) => Math.round(n));
  const paths: MeteorPath[] = ids.map((id) => {
    const ship = world.ships[id];
    return { ship: id, planet: null, delay: range(rng, 0, METEORS.DELAY_SHIP), points: round(aimedAt(world, ship.x, ship.y, rng)) };
  });
  world.planets.slice(0, Math.max(0, METEORS.MAX_PATHS - ids.length)).forEach((planet, index) => {
    const a = rng() * Math.PI * 2;
    const [x, y] = [planet.x + Math.cos(a) * (planet.radius + 1), planet.y + Math.sin(a) * (planet.radius + 1)];
    paths.push({ ship: null, planet: index, delay: range(rng, 0, METEORS.DELAY_PLANET), points: round(aimedAt(world, x, y, rng, a)) });
  });
  return paths;
}
