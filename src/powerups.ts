import { AIM, NEBULA, PHYSICS } from './config';
import { aimDirection, portalFits, Shot, type ShotRules, type World } from './physics';
import type { Rng } from './rng';

/**
 * Power-ups: pickups float on the field, a shot that flies past one
 * takes it, and a ship holds one at a time. Everything here is pure, so the match can call it from its
 * own rng and the tests can call it directly.
 */

export type PowerUpKind = 'preview' | 'teleport' | 'splitter' | 'antigravity' | 'shield' | 'blackhole' | 'planetkiller' | 'nebula' | 'piercing' | 'wormhole' | 'defense' | 'plasma';

export const POWER_UP_KINDS: readonly PowerUpKind[] = ['preview', 'teleport', 'splitter', 'antigravity', 'shield', 'blackhole', 'planetkiller', 'nebula', 'piercing', 'wormhole', 'defense', 'plasma'];

/**
 * How often each kind turns up, relative to the others, and the same in every mode: the stronger the kind,
 * the scarcer it is. So the preview is the rarest find, then the planet killer and the black hole, up to the
 * teleport and the shield, which are the commonest.
 */
export const POWER_UP_WEIGHTS: Readonly<Record<PowerUpKind, number>> = { preview: 0.2, planetkiller: 0.3, blackhole: 0.3, splitter: 0.5, piercing: 0.5, antigravity: 0.6, nebula: 0.8, teleport: 0.8, shield: 0.8, wormhole: 0.3, defense: 0.5, plasma: 0.5 };

/** The kind of a new pickup, drawn by weight from the kinds in play (all of them when the list is empty). */
export function pickKind(rng: Rng, kinds: readonly PowerUpKind[] = POWER_UP_KINDS): PowerUpKind {
  const pool = kinds.length ? kinds : POWER_UP_KINDS;
  let roll = rng() * pool.reduce((sum, kind) => sum + POWER_UP_WEIGHTS[kind], 0);
  for (const kind of pool) {
    roll -= POWER_UP_WEIGHTS[kind];
    if (roll <= 0) return kind;
  }
  return pool[pool.length - 1];
}

/**
 * Kinds a CPU has no use for: it leaves them lying. Only the preview, which shows a shot's path and means
 * nothing to a planner that already knows it. A placement (black hole, planet killer, nebula, defense,
 * wormhole, antigravity) it does take, and lays it at a rough spot of its own.
 */
export const CPU_IGNORES: Readonly<Partial<Record<PowerUpKind, true>>> = { preview: true };

export const POWER_UP = {
  /**
   * The amount setting is how many pickups lie on the field, and never more: a round starts with that many, a
   * taken one is replaced at once, and a faded one only once it is gone.
   */
  DEFAULT_AMOUNT: 2,
  AMOUNTS: [1, 2, 3, 4] as readonly number[],
  /** A pickup fades once this many passes (every ship has shot once) have gone by. */
  LIFETIME_PASSES: 3,
  /** A shot that passes this close to a pickup takes it. */
  PICKUP_RADIUS: 16,
  /** Pickups keep this far from the edges, planets, ships and each other. */
  EDGE: 60,
  PLANET_GAP: 40,
  SHIP_GAP: 70,
  PICKUP_GAP: 160,
  /** Seconds of flight the preview draws: just the first stretch, so it hints at the shot without giving it away. */
  PREVIEW_SECONDS: 2,
  /**
   * Where along the preview the hint is spent. The path is drawn no further than this share of it and
   * fades out on the way, so an armed preview shows where the shot sets off rather than where it goes.
   */
  PREVIEW_FADE_AT: 0.6,
  /** Angle a split adds on either side of the shot, in degrees. */
  SPLIT_SPREAD: 5,
  /** A CPU splits its shot once it is this close to an enemy ship, and not before it has flown this long. */
  CPU_SPLIT_RANGE: 150,
  CPU_SPLIT_MIN_TIME: 0.3,
  /** How far a random teleport lands from planets, other ships and pickups. An aimed teleport keeps the planet gap only. */
  TELEPORT_PLANET_GAP: 50,
  TELEPORT_SHIP_GAP: 110,
  TELEPORT_PICKUP_GAP: 50,
  /** Spots keep this far from a black hole's edge (the Event Horizon one grows every volley): it would swallow them. */
  HOLE_GAP: 90,
  /** Random spots tried before giving up. */
  ATTEMPTS: 200,
  /** Lane placement: shots flown from a ship to find a spot on one of its paths, and how far along each. */
  LANE_SHOTS: 14,
  LANE_SECONDS: 6,
  /** A lane spot is at least this far from the ship whose path it is on, so it is never a free pickup. */
  LANE_MIN_RANGE: 160,
  /** Spots this far above a planet's surface (a swing-by lane) are preferred over open space. */
  LANE_BAND_FROM: 45,
  LANE_BAND_TO: 150,
  /** Chance that a new pickup is laid on the path of the ship that is behind. */
  CATCH_UP_CHANCE: 0.6,
  /** The reach of an aimed teleport at full aim power, how finely the ray is stepped back off an obstacle, and the most power it may use. */
  TELEPORT_RANGE: 1200,
  TELEPORT_AIM_STEP: 4,
  TELEPORT_MAX_POWER: 50,
  /** A black hole the power-up plants: a modest, fixed horizon. It lasts the round and never grows. */
  BLACKHOLE_RADIUS: 18,
  BLACKHOLE_MASS: 260_000,
  /** A black hole is never planted closer than this to another player's ship. */
  BLACKHOLE_PLAYER_GAP: 150,
  /**
   * The reach of an aimed nebula: like the teleport aim, the angle and power put one cloud down. A cloud
   * keeps this far from the field edge, so its aim spot is drawn whole.
   */
  NEBULA_EDGE_GAP: NEBULA.RADIUS,
  /** A planetary defense covers an area of this many times its planet's radius round the turret, in three zones. */
  DEFENSE_RADIUS_SHARE: 4,
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

/** Whether a point is clear of planets, ships, other pickups and the edges of the field. */
function isClear(world: World, x: number, y: number, planetGap: number, shipGap: number, pickups: readonly Pickup[], pickupGap: number, edge: number): boolean {
  if (x < edge || x > world.width - edge || y < edge || y > world.height - edge) return false;
  if (world.planets.some((p) => distance(x, y, p.x, p.y) < p.radius + planetGap)) return false;
  if (world.ships.some((s) => distance(x, y, s.x, s.y) < shipGap)) return false;
  if (world.holes.some((h) => distance(x, y, h.x, h.y) < h.radius + POWER_UP.HOLE_GAP)) return false;
  return !pickups.some((q) => distance(x, y, q.x, q.y) < pickupGap);
}

/** A random spot on the field that is clear of planets, ships and the other pickups. */
function clearSpot(world: World, rng: Rng, planetGap: number, shipGap: number, pickups: readonly Pickup[], pickupGap: number, edge: number): { x: number; y: number } | null {
  for (let attempt = 0; attempt < POWER_UP.ATTEMPTS; attempt++) {
    const x = edge + rng() * (world.width - 2 * edge);
    const y = edge + rng() * (world.height - 2 * edge);
    if (isClear(world, x, y, planetGap, shipGap, pickups, pickupGap, edge)) return { x, y };
  }
  return null;
}

/**
 * A spot on the path of a shot some ship could fire, far enough from that ship that taking it costs a real shot,
 * and so a pickup that can be reached by construction. Spots in a swing-by lane (close above a planet) count triple.
 * Null when no sampled path offers a clear spot.
 */
export function laneSpot(world: World, rng: Rng, rules: ShotRules, sources: readonly number[], pickups: readonly Pickup[]): { x: number; y: number } | null {
  const spots: { x: number; y: number; weight: number }[] = [];
  for (let attempt = 0; attempt < POWER_UP.LANE_SHOTS && sources.length; attempt++) {
    const source = sources[Math.floor(rng() * sources.length)];
    const from = world.ships[source];
    const shot = new Shot(world, source, rng() * 360, 25 + rng() * 75, rules);
    let steps = 0;
    while (!shot.end && shot.time < POWER_UP.LANE_SECONDS) {
      shot.step();
      if (++steps % 12 !== 0 || distance(shot.x, shot.y, from.x, from.y) < POWER_UP.LANE_MIN_RANGE) continue;
      if (!isClear(world, shot.x, shot.y, POWER_UP.PLANET_GAP, POWER_UP.SHIP_GAP, pickups, POWER_UP.PICKUP_GAP, POWER_UP.EDGE)) continue;
      const lane = world.planets.some((p) => {
        const gap = distance(shot.x, shot.y, p.x, p.y) - p.radius;
        return gap >= POWER_UP.LANE_BAND_FROM && gap <= POWER_UP.LANE_BAND_TO;
      });
      spots.push({ x: shot.x, y: shot.y, weight: lane ? 3 : 1 });
    }
  }
  if (!spots.length) return null;
  let roll = rng() * spots.reduce((sum, spot) => sum + spot.weight, 0);
  for (const spot of spots) {
    roll -= spot.weight;
    if (roll <= 0) return { x: spot.x, y: spot.y };
  }
  return spots[spots.length - 1];
}

/**
 * A new pickup of `kind`. With `sources` (the ships whose paths it may lie on) it goes on one of those paths;
 * without, or when that finds nothing, anywhere clear. Null when the field has no room left for one.
 */
export function spawnPickup(
  world: World,
  rng: Rng,
  pickups: readonly Pickup[],
  kind: PowerUpKind,
  id: number,
  pass: number,
  lane?: { rules: ShotRules; sources: readonly number[] },
): Pickup | null {
  const spot = (lane && laneSpot(world, rng, lane.rules, lane.sources, pickups)) || clearSpot(world, rng, POWER_UP.PLANET_GAP, POWER_UP.SHIP_GAP, pickups, POWER_UP.PICKUP_GAP, POWER_UP.EDGE);
  return spot ? { id, kind, x: spot.x, y: spot.y, born: pass } : null;
}

/** A random place for a ship to land: well clear of planets, the other ships and the pickups. */
export function teleportSpot(world: World, rng: Rng, pickups: readonly Pickup[] = []): { x: number; y: number } | null {
  return clearSpot(world, rng, POWER_UP.TELEPORT_PLANET_GAP, POWER_UP.TELEPORT_SHIP_GAP, pickups, POWER_UP.TELEPORT_PICKUP_GAP, POWER_UP.EDGE);
}

/**
 * Whether a spot is somewhere a ship may come to rest — and so somewhere an aimed black hole may be planted:
 * inside the field, clear of every planet and of every hole already there.
 */
function isLanded(world: World, x: number, y: number): boolean {
  if (x < POWER_UP.EDGE || x > world.width - POWER_UP.EDGE || y < POWER_UP.EDGE || y > world.height - POWER_UP.EDGE) return false;
  if (world.planets.some((p) => distance(x, y, p.x, p.y) < p.radius + POWER_UP.TELEPORT_PLANET_GAP)) return false;
  return !world.holes.some((h) => distance(x, y, h.x, h.y) < h.radius + POWER_UP.HOLE_GAP);
}

/**
 * The point `power` puts along `angle` from the ship, walked back along the ray until it is somewhere
 * a ship may rest and a black hole may be planted. So it never lands inside a planet or an existing hole,
 * or off the field. Null when the ray offers no such spot. Used by both the teleport and the black hole.
 */
export function aimedSpot(world: World, from: { x: number; y: number }, angle: number, power: number): { x: number; y: number } | null {
  const dir = aimDirection(angle);
  // A power from 0 to TELEPORT_MAX_POWER reaches nothing to half the field across; more power changes nothing.
  const full = (Math.min(POWER_UP.TELEPORT_MAX_POWER, Math.max(0, power)) / AIM.MAX_POWER) * POWER_UP.TELEPORT_RANGE;
  for (let reach = full; reach > 0; reach -= POWER_UP.TELEPORT_AIM_STEP) {
    const x = from.x + dir.x * reach;
    const y = from.y + dir.y * reach;
    if (isLanded(world, x, y)) return { x, y };
  }
  return null;
}

/** Whether a black hole may be planted at `spot` by ship `owner`: far enough from every other living ship. */
export function blackHoleFits(world: World, spot: { x: number; y: number }, owner: number): boolean {
  return world.ships.every((s, i) => i === owner || !s.alive || distance(s.x, s.y, spot.x, spot.y) >= POWER_UP.BLACKHOLE_PLAYER_GAP);
}

/**
 * Where a CPU sets the two portals of a wormhole: one a little way out from its own ship, towards the enemy,
 * and one close to the enemy, so a shot that goes in at the first comes out near its target. Each is walked
 * back along that line until it is clear of planets and holes and of the other portal. Null when the line
 * offers no such pair.
 */
export function cpuWormholeSpots(world: World, from: { x: number; y: number }, to: { x: number; y: number }, owner = -1): [{ x: number; y: number }, { x: number; y: number }] | null {
  const d = distance(from.x, from.y, to.x, to.y);
  if (!d) return null;
  const [ux, uy] = [(to.x - from.x) / d, (to.y - from.y) / d];
  const pick = (reach: number, others: { x: number; y: number }[]): { x: number; y: number } | null => {
    for (let r = reach; r > 0; r -= POWER_UP.TELEPORT_AIM_STEP) {
      const spot = { x: from.x + ux * r, y: from.y + uy * r };
      if (isLanded(world, spot.x, spot.y) && portalFits(world, spot, others, owner)) return spot;
    }
    return null;
  };
  const first = pick(0.3 * d, []);
  const second = first && pick(0.75 * d, [first]);
  return first && second ? [first, second] : null;
}

/**
 * Where an aimed nebula lands: the point `power` puts along `angle`, walked back only until the whole cloud
 * fits inside the field. A cloud may cover a planet or a hole, so nothing else blocks it. Null at no reach.
 */
export function nebulaSpot(world: World, from: { x: number; y: number }, angle: number, power: number): { x: number; y: number } | null {
  const dir = aimDirection(angle);
  const full = (Math.min(POWER_UP.TELEPORT_MAX_POWER, Math.max(0, power)) / AIM.MAX_POWER) * POWER_UP.TELEPORT_RANGE;
  const gap = POWER_UP.NEBULA_EDGE_GAP;
  for (let reach = full; reach > 0; reach -= POWER_UP.TELEPORT_AIM_STEP) {
    const x = from.x + dir.x * reach;
    const y = from.y + dir.y * reach;
    if (x >= gap && x <= world.width - gap && y >= gap && y <= world.height - gap) return { x, y };
  }
  return null;
}

/**
 * The planet an aimed planet killer would remove: the first one the aim ray enters, however far off. Only the
 * angle aims it: the power plays no part, so no planet is ever out of reach. Null when the ray meets no
 * planet, so a miss spends nothing.
 */
export function aimedPlanet(world: World, from: { x: number; y: number }, angle: number): { index: number; x: number; y: number } | null {
  const dir = aimDirection(angle);
  const full = Math.hypot(world.width, world.height);
  for (let reach = POWER_UP.TELEPORT_AIM_STEP; reach <= full; reach += POWER_UP.TELEPORT_AIM_STEP) {
    const x = from.x + dir.x * reach;
    const y = from.y + dir.y * reach;
    for (let i = 0; i < world.planets.length; i++) {
      const p = world.planets[i];
      if (distance(x, y, p.x, p.y) < p.radius) return { index: i, x: p.x, y: p.y };
    }
  }
  return null;
}

/**
 * Where an aimed planetary defense would stand: the surface point of the first planet the aim ray enters,
 * however far off. Like the planet killer only the angle aims it. Null when the ray meets no planet.
 */
export function aimedSurface(world: World, from: { x: number; y: number }, angle: number): { x: number; y: number; planet: number; radius: number } | null {
  const hit = aimedPlanet(world, from, angle);
  if (!hit) return null;
  const planet = world.planets[hit.index];
  const dx = from.x - planet.x;
  const dy = from.y - planet.y;
  // The ray enters the planet from the ship's side: walk back along it to the rim.
  const dir = aimDirection(angle);
  const b = dx * dir.x + dy * dir.y;
  const t = -b - Math.sqrt(Math.max(0, b * b - (dx * dx + dy * dy - planet.radius * planet.radius)));
  return { x: from.x + dir.x * t, y: from.y + dir.y * t, planet: hit.index, radius: planet.radius * POWER_UP.DEFENSE_RADIUS_SHARE };
}

/**
 * Every fourth physics step is sampled into the preview polyline, plus the muzzle and the last one.
 */
const PREVIEW_STRIDE = 4;

/**
 * How many point pairs a full preview window yields. The renderer fades a path against this, and not
 * against the path it was handed, so a shot that ends early — it hit something — cannot be told from
 * a shot that flies on by where or how its preview fades.
 */
export const PREVIEW_POINTS = 2 + Math.floor(Math.round(POWER_UP.PREVIEW_SECONDS / PHYSICS.DT) / PREVIEW_STRIDE);

/**
 * The first seconds of the flight a shot would make from the current aim, as a flat [x0, y0, x1, y1, …]
 * polyline. Stops early when the shot ends (it hits something) or leaves the field, so a short path is a
 * prefix of a full one: sample `i` is the same moment either way, which is what lets a fade be measured
 * in the window rather than along the path.
 */
export function previewPath(world: World, shooter: number, angle: number, power: number, rules: ShotRules): number[] {
  const shot = new Shot(world, shooter, angle, power, rules);
  const points = [shot.x, shot.y];
  const steps = Math.round(POWER_UP.PREVIEW_SECONDS / PHYSICS.DT);
  for (let i = 0; i < steps; i++) {
    if (shot.step()) break;
    if (i % PREVIEW_STRIDE === PREVIEW_STRIDE - 1) points.push(shot.x, shot.y);
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
