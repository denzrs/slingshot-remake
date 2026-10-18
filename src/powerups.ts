import { PHYSICS } from './config';
import { Shot, type ShotRules, type World } from './physics';
import type { Rng } from './rng';

/**
 * Experimental power-ups (offline Classic only): pickups float on the field, a shot that flies past one
 * takes it, and a ship holds one at a time. Everything here is pure, so the match can call it from its
 * own rng and the tests can call it directly.
 */

export type PowerUpKind = 'preview' | 'teleport' | 'splitter';

export const POWER_UP_KINDS: readonly PowerUpKind[] = ['preview', 'teleport', 'splitter'];

export const POWER_UP = {
  /** Pickups on the field at the same time. */
  MAX_ON_FIELD: 3,
  /** Pickups a round starts with. */
  START_COUNT: 2,
  /** A pickup fades once this many passes (every ship has shot once) have gone by. */
  LIFETIME_PASSES: 3,
  /** A shot that passes this close to a pickup takes it. */
  PICKUP_RADIUS: 16,
  /** Pickups keep this far from the edges, planets, ships and each other. */
  EDGE: 60,
  PLANET_GAP: 40,
  SHIP_GAP: 70,
  PICKUP_GAP: 90,
  /** Seconds of flight the preview draws: just the first stretch, so it hints at the shot without giving it away. */
  PREVIEW_SECONDS: 2,
  /** Angle a split adds on either side of the shot, in degrees. */
  SPLIT_SPREAD: 5,
  /** A CPU splits its shot once it is this close to an enemy ship, and not before it has flown this long. */
  CPU_SPLIT_RANGE: 150,
  CPU_SPLIT_MIN_TIME: 0.3,
  /** A teleport lands at least this far from planets, other ships and pickups. */
  TELEPORT_PLANET_GAP: 50,
  TELEPORT_SHIP_GAP: 110,
  TELEPORT_PICKUP_GAP: 50,
  /** Random spots tried before giving up. */
  ATTEMPTS: 200,
} as const;

export interface Pickup {
  id: number;
  kind: PowerUpKind;
  x: number;
  y: number;
  /** The pass the pickup appeared in. */
  born: number;
}

const distance = (ax: number, ay: number, bx: number, by: number): number => Math.hypot(ax - bx, ay - by);

/** A random spot on the field that is clear of planets, ships and the other pickups. */
function clearSpot(world: World, rng: Rng, planetGap: number, shipGap: number, pickups: readonly Pickup[], pickupGap: number, edge: number): { x: number; y: number } | null {
  for (let attempt = 0; attempt < POWER_UP.ATTEMPTS; attempt++) {
    const x = edge + rng() * (world.width - 2 * edge);
    const y = edge + rng() * (world.height - 2 * edge);
    if (world.planets.some((p) => distance(x, y, p.x, p.y) < p.radius + planetGap)) continue;
    if (world.ships.some((s) => distance(x, y, s.x, s.y) < shipGap)) continue;
    if (pickups.some((q) => distance(x, y, q.x, q.y) < pickupGap)) continue;
    return { x, y };
  }
  return null;
}

/** A new pickup of `kind` somewhere clear, or null when the field has no room left for one. */
export function spawnPickup(world: World, rng: Rng, pickups: readonly Pickup[], kind: PowerUpKind, id: number, pass: number): Pickup | null {
  const spot = clearSpot(world, rng, POWER_UP.PLANET_GAP, POWER_UP.SHIP_GAP, pickups, POWER_UP.PICKUP_GAP, POWER_UP.EDGE);
  return spot ? { id, kind, x: spot.x, y: spot.y, born: pass } : null;
}

/** A random place for a ship to land: well clear of planets, the other ships and the pickups. */
export function teleportSpot(world: World, rng: Rng, pickups: readonly Pickup[] = []): { x: number; y: number } | null {
  return clearSpot(world, rng, POWER_UP.TELEPORT_PLANET_GAP, POWER_UP.TELEPORT_SHIP_GAP, pickups, POWER_UP.TELEPORT_PICKUP_GAP, POWER_UP.EDGE);
}

/**
 * The first seconds of the flight a shot would make from the current aim, as a flat [x0, y0, x1, y1, …]
 * polyline. Stops early when the shot ends (it hits something) or leaves the field.
 */
export function previewPath(world: World, shooter: number, angle: number, power: number, rules: ShotRules): number[] {
  const shot = new Shot(world, shooter, angle, power, rules);
  const points = [shot.x, shot.y];
  const steps = Math.round(POWER_UP.PREVIEW_SECONDS / PHYSICS.DT);
  for (let i = 0; i < steps; i++) {
    if (shot.step()) break;
    if (i % 4 === 3) points.push(shot.x, shot.y);
  }
  points.push(shot.x, shot.y);
  return points;
}

/** The turns (radians) a split adds to a shot: one copy either side of it. */
export const SPLIT_TURNS: readonly number[] = [(-POWER_UP.SPLIT_SPREAD * Math.PI) / 180, (POWER_UP.SPLIT_SPREAD * Math.PI) / 180];

/** The pickups a shot passes close enough to take, as indices into `pickups`. */
export function touchedPickups(pickups: readonly Pickup[], x: number, y: number): number[] {
  const hits: number[] = [];
  pickups.forEach((p, i) => {
    if (distance(x, y, p.x, p.y) < POWER_UP.PICKUP_RADIUS) hits.push(i);
  });
  return hits;
}
