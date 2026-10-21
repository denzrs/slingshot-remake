import { FIELD, HORIZON, SOLAR } from './config';
import type { BlackHole, Planet, PlanetStyle, Ship, World } from './physics';
import { createRng, intRange, pick, range, type Rng } from './rng';

const TINTS: Record<PlanetStyle, readonly string[]> = {
  rocky: ['#c9a77c', '#b8664a', '#a39a8a', '#c78f6d'],
  gas: ['#d8b98a', '#9c8bb5', '#c9a0a0', '#b7c28f'],
  ice: ['#9fc3d6', '#bcd3dc', '#8fb3b0'],
  star: ['#f2c46d'],
};

const SHIP_CLEARANCE = 110;
const PLANET_GAP = 24;
const HOLE_CLEARANCE = 90;

interface WorldOptions {
  /** Lower bound of the planet count (default 2); the count is drawn between this and `maxPlanets`. */
  minPlanets?: number;
  maxPlanets: number;
  players: number;
  /** Event Horizon: a black hole sits in the middle. */
  blackHole: boolean;
  /** Team per player (team mode), so teammates can start side by side. */
  teams?: readonly number[] | null;
  /** Solar System: a sun in the middle, planets and ships on orbits round it. */
  solar?: boolean;
}

/**
 * Lay out a fresh battlefield: ships around the rim, planets in between. Two ships in a classic
 * match face off left vs right like the original; otherwise ships spread around an ellipse.
 * Same seed → same world.
 */
export function generateWorld(seed: number, opts: WorldOptions): World {
  const rng = createRng(seed);
  if (opts.solar) return generateSolarWorld(rng, opts);
  const { width, height } = FIELD;
  const duel = opts.players === 2 && !opts.blackHole;
  const ships = duel ? duelShips(rng) : ringShips(rng, opts.players, opts.teams ?? null);

  const holes: BlackHole[] = opts.blackHole
    ? [{
        x: width / 2 + range(rng, -40, 40),
        y: height / 2 + range(rng, -30, 30),
        radius: HORIZON.START_RADIUS,
        mass: HORIZON.START_MASS,
      }]
    : [];

  const xMargin = duel ? 270 : 150;
  const count = intRange(rng, Math.min(opts.minPlanets ?? 2, opts.maxPlanets), opts.maxPlanets);
  const planets: Planet[] = [];
  for (let attempt = 0; planets.length < count && attempt < 800; attempt++) {
    // Skew towards smaller bodies so big ones stay special.
    const radius = 16 + 44 * Math.pow(rng(), 1.4);
    const x = range(rng, xMargin, width - xMargin);
    // Beyond the duel a scoreboard runs along the top — keep planets out from under it.
    const y = range(rng, radius + (duel ? 24 : 120), height - radius - 24);
    const clearOfShips = ships.every((s) => Math.hypot(s.x - x, s.y - y) > radius + SHIP_CLEARANCE);
    const clearOfPlanets = planets.every((p) => Math.hypot(p.x - x, p.y - y) > p.radius + radius + PLANET_GAP);
    const clearOfHoles = holes.every((h) => Math.hypot(h.x - x, h.y - y) > radius + h.radius + HOLE_CLEARANCE);
    if (!clearOfShips || !clearOfPlanets || !clearOfHoles) continue;

    const style: PlanetStyle = radius > 40 ? pick(rng, ['gas', 'gas', 'rocky', 'ice']) : pick(rng, ['rocky', 'rocky', 'ice']);
    const density = range(rng, 0.75, 1.3);
    planets.push({
      x,
      y,
      radius,
      mass: density * radius ** 3,
      seed: Math.floor(rng() * 2 ** 31),
      style,
      tint: pick(rng, TINTS[style]),
    });
  }

  return { width, height, planets, ships, holes, nebulae: [], wormholes: [], defenses: [], version: 0 };
}

function duelShips(rng: Rng): Ship[] {
  const { width, height } = FIELD;
  return [
    { x: range(rng, 70, 190), y: range(rng, 130, height - 130), alive: true },
    { x: range(rng, width - 190, width - 70), y: range(rng, 130, height - 130), alive: true },
  ];
}

/**
 * Ships evenly spread around an ellipse hugging the field edge, with a random twist and jitter.
 * The ellipse sits a little low so no ship hides under the scoreboard along the top.
 * With teams, teammates take neighbouring slots and the first team's arc faces left,
 * so two teams line up left vs right like the original duel.
 */
function ringShips(rng: Rng, n: number, teams: readonly number[] | null): Ship[] {
  const { width, height } = FIELD;
  const cy = height / 2 + 25;
  const rx = width / 2 - 95;
  const ry = height / 2 - 115;
  const slice = (Math.PI * 2) / n;
  // Slot order: players grouped by team (stable), or just in seat order.
  const order = Array.from({ length: n }, (_, i) => i);
  let offset = rng() * Math.PI * 2;
  if (teams) {
    order.sort((a, b) => teams[a] - teams[b] || a - b);
    const firstTeam = teams.filter((t) => t === teams[order[0]]).length;
    offset = Math.PI - ((firstTeam - 1) / 2) * slice + range(rng, -0.25, 0.25);
  }
  const ships: Ship[] = new Array(n);
  order.forEach((player, slot) => {
    const a = offset + slot * slice + range(rng, -0.12, 0.12) * slice;
    ships[player] = { x: width / 2 + Math.cos(a) * rx, y: cy + Math.sin(a) * ry, alive: true };
  });
  return ships;
}

/** The sun's place, and the centre everything in a Solar System turns around. */
export const solarCenter = (): { x: number; y: number } => ({ x: FIELD.width / 2, y: FIELD.height / 2 + SOLAR.CENTER_Y_SHIFT });

/** How far a body on an orbit of radius `r` turns in one full step: the inner orbits are quicker. */
export const orbitTurn = (r: number): number => SOLAR.TURN * (SOLAR.REF_ORBIT / Math.max(r, 1)) ** SOLAR.FALLOFF;

/** One orbit: shared by up to two planets (opposite each other, same speed), or by some of the ships. */
type Body = { kind: 'planets'; radii: number[] } | { kind: 'ships' };

/**
 * A sun in the middle, the planets on orbits round it — two to an orbit, facing each other. The ships ride orbits too — two or three to
 * an orbit — so that after every step the whole system turns and the gravity field with it. The orbits are spaced so
 * that no two bodies ever come near, however far each has turned.
 */
function generateSolarWorld(rng: Rng, opts: WorldOptions): World {
  const { width, height } = FIELD;
  const centre = solarCenter();
  const bands = Math.min(2, Math.ceil(opts.players / 2));

  const bodies: Body[] = [];
  // The mode's own planets are small, so more of them fit than on an open field: the setting is the least it draws.
  const wanted = opts.maxPlanets === 0 ? 0 : intRange(rng, Math.max(opts.maxPlanets, 2), Math.max(opts.maxPlanets, 2) + 3);
  const radii = Array.from({ length: wanted }, () => SOLAR.MIN_PLANET + (SOLAR.MAX_PLANET - SOLAR.MIN_PLANET) * Math.pow(rng(), 1.4));
  for (let i = 0; i < radii.length; i += 2) bodies.push({ kind: 'planets', radii: radii.slice(i, i + 2) });
  const half = (b: Body): number => (b.kind === 'planets' ? Math.max(...b.radii) : SOLAR.SHIP_BAND);
  const span = (list: readonly Body[]): number => list.reduce((sum, b) => sum + 2 * half(b) + SOLAR.ORBIT_GAP, -SOLAR.ORBIT_GAP);
  const room = SOLAR.OUTER_ORBIT - SOLAR.INNER_ORBIT;
  for (let i = 0; i < bands; i++) bodies.push({ kind: 'ships' });
  // Too many for the room: the planets give way, the ships' orbits stay.
  while (span(bodies) > room) {
    const last = bodies.map((b) => b.kind).lastIndexOf('planets');
    if (last < 0) break;
    bodies.splice(last, 1);
  }
  // Random order, but the ships' orbits tend outwards: nobody starts huddled up against the sun.
  const order = bodies.map((b) => ({ b, key: rng() + (b.kind === 'ships' ? 0.5 : 0) })).sort((x, y) => x.key - y.key).map((e) => e.b);
  // What is left over is shared out between the orbits.
  const slack = Math.max(0, room - span(order)) / (order.length + 1);

  const planets: Planet[] = [{
    x: centre.x,
    y: centre.y,
    radius: SOLAR.SUN_RADIUS,
    mass: SOLAR.SUN_MASS,
    seed: Math.floor(rng() * 2 ** 31),
    style: 'star',
    tint: '#f2c46d',
    sun: true,
  }];
  const bandRadii: number[] = [];
  let cursor = SOLAR.INNER_ORBIT + slack * rng();
  for (const body of order) {
    const r = cursor + half(body);
    cursor += 2 * half(body) + SOLAR.ORBIT_GAP + slack;
    if (body.kind === 'ships') {
      bandRadii.push(r);
      continue;
    }
    const turn = rng() * Math.PI * 2;
    body.radii.forEach((radius, k) => {
      const a = turn + k * Math.PI;
      const style: PlanetStyle = radius > 24 ? pick(rng, ['gas', 'gas', 'rocky', 'ice']) : pick(rng, ['rocky', 'rocky', 'ice']);
      planets.push({
        x: centre.x + Math.cos(a) * r,
        y: centre.y + Math.sin(a) * r,
        radius,
        mass: range(rng, 0.75, 1.3) * radius ** 3,
        seed: Math.floor(rng() * 2 ** 31),
        style,
        tint: pick(rng, TINTS[style]),
      });
    });
  }

  // Ships take their places one after another round the sun, the bands in turn; teammates sit next to each other.
  const n = opts.players;
  const seats = Array.from({ length: n }, (_, i) => i);
  if (opts.teams) seats.sort((a, b) => opts.teams![a] - opts.teams![b] || a - b);
  const offset = rng() * Math.PI * 2;
  const ships: Ship[] = new Array(n);
  seats.forEach((player, slot) => {
    const a = offset + (slot * Math.PI * 2) / n;
    const r = bandRadii[slot % bandRadii.length];
    ships[player] = { x: centre.x + Math.cos(a) * r, y: centre.y + Math.sin(a) * r, alive: true };
  });

  return { width, height, planets, ships, holes: [], nebulae: [], wormholes: [], defenses: [], version: 0 };
}
