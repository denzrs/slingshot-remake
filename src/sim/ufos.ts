import { SUDDEN_DEATH } from './config';
import type { World } from './physics';
import { range, type Rng } from './rng';

const { UFOS } = SUDDEN_DEATH;
const MIN_SAMPLES = Math.ceil(UFOS.MIN_TIME * UFOS.RATE) + 1;
/** A hover spot keeps this far inside the field edge (more below, so the scoreboard is left clear) and this far off a planet's rim. */
const EDGE = 48;
const TOP = 90;
const CLEARANCE = 36;

/** One saucer: how it flies in (x, y pairs sampled `RATE` times a second, rounded to whole px), then what it zaps once it has charged. */
export interface UfoPath {
  /** The ship it zaps, or null. */
  ship: number | null;
  /** The planet it zaps instead (an index into `world.planets`), or null. */
  planet: number | null;
  delay: number;
  points: number[];
  charge: number;
  /** Where the beam lands. */
  target: [number, number];
}

/** When the saucer zaps (s after the blast). */
export const zapAt = (path: Pick<UfoPath, 'delay' | 'points' | 'charge'>): number => path.delay + (path.points.length / 2 - 1) / UFOS.RATE + path.charge;

/** Whether the segment from a to b stays clear of the circle. */
function clear(ax: number, ay: number, bx: number, by: number, c: { x: number; y: number; r: number }): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const k = len2 ? Math.max(0, Math.min(1, ((c.x - ax) * dx + (c.y - ay) * dy) / len2)) : 0;
  return Math.hypot(ax + dx * k - c.x, ay + dy * k - c.y) > c.r;
}

/** Where a saucer settles to zap (x, y): in the field, off the planets, with nothing between it and the target. */
function hoverAt(world: World, x: number, y: number, rng: Rng, bodies: { x: number; y: number; r: number }[]): [number, number] {
  let spot: [number, number] = [x, Math.max(TOP, y - UFOS.HOVER_MIN)];
  for (let tries = 0; tries < 40; tries++) {
    const a = rng() * Math.PI * 2;
    const d = range(rng, UFOS.HOVER_MIN, UFOS.HOVER_MAX);
    const s: [number, number] = [x + Math.cos(a) * d, y + Math.sin(a) * d];
    if (s[0] < EDGE || s[0] > world.width - EDGE || s[1] < TOP || s[1] > world.height - EDGE) continue;
    if (world.planets.some((p) => Math.hypot(p.x - s[0], p.y - s[1]) < p.radius + CLEARANCE)) continue;
    if (!bodies.every((b) => clear(s[0], s[1], x, y, b))) continue;
    return s;
  }
  return spot;
}

/** The way in: from a random edge, on a curve, easing to a stop over the hover spot. */
function flightTo(spot: [number, number], world: World, rng: Rng): number[] {
  const m = UFOS.MARGIN;
  const along = rng();
  const [sx, sy] = [[along * world.width, -m], [world.width + m, along * world.height], [along * world.width, world.height + m], [-m, along * world.height]][Math.floor(rng() * 4)];
  const [dx, dy] = [spot[0] - sx, spot[1] - sy];
  const len = Math.hypot(dx, dy) || 1;
  // The curve bows away from the straight line by a random amount, to either side.
  const bow = range(rng, -0.35, 0.35) * len;
  const [cx, cy] = [sx + dx / 2 - (dy / len) * bow, sy + dy / 2 + (dx / len) * bow];
  const samples = Math.max(MIN_SAMPLES, Math.min(UFOS.MAX_SAMPLES, Math.ceil(((len * 1.15) / UFOS.SPEED) * UFOS.RATE)));
  const points: number[] = [];
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    const u = 1 - (1 - t) * (1 - t);
    const v = 1 - u;
    points.push(Math.round(v * v * sx + 2 * v * u * cx + u * u * spot[0]), Math.round(v * v * sy + 2 * v * u * cy + u * u * spot[1]));
  }
  return points;
}

/**
 * The UFO invasion of sudden death's finale: a saucer for each of `ids`, which flies in, hovers and zaps its ship, and one
 * more for every planet, which zaps that. Pure and deterministic: the same world and generator always give the same paths.
 */
export function planUfos(world: World, ids: readonly number[], rng: Rng): UfoPath[] {
  const bodies = [...world.planets.map((p) => ({ x: p.x, y: p.y, r: p.radius + 2 })), ...world.holes.map((h) => ({ x: h.x, y: h.y, r: h.radius + 2 }))];
  const paths: UfoPath[] = ids.map((id) => {
    const ship = world.ships[id];
    const spot = hoverAt(world, ship.x, ship.y, rng, bodies);
    return { ship: id, planet: null, delay: range(rng, 0, UFOS.DELAY_SHIP), points: flightTo(spot, world, rng), charge: UFOS.CHARGE, target: [Math.round(ship.x), Math.round(ship.y)] };
  });
  world.planets.slice(0, Math.max(0, UFOS.MAX_PATHS - ids.length)).forEach((planet, index) => {
    const a = rng() * Math.PI * 2;
    const d = planet.radius + range(rng, 150, 230);
    const spot: [number, number] = [Math.max(EDGE, Math.min(world.width - EDGE, planet.x + Math.cos(a) * d)), Math.max(TOP, Math.min(world.height - EDGE, planet.y + Math.sin(a) * d))];
    const away = Math.hypot(spot[0] - planet.x, spot[1] - planet.y) || 1;
    const target: [number, number] = [Math.round(planet.x + ((spot[0] - planet.x) / away) * planet.radius), Math.round(planet.y + ((spot[1] - planet.y) / away) * planet.radius)];
    paths.push({ ship: null, planet: index, delay: range(rng, 0, UFOS.DELAY_PLANET), points: flightTo(spot, world, rng), charge: UFOS.CHARGE, target });
  });
  return paths;
}
