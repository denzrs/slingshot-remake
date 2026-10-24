import { FIELD, HORIZON, SOLAR } from './config';
import type { BlackHole, Planet, PlanetStyle, Ship, World } from './physics';
import { createRng, intRange, pick, range, shuffle, type Rng } from './rng';

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

/** Where on its orbit a point is: its orbit's radius (half-height) and its angle round the sun. */
export function orbitOf(x: number, y: number): { r: number; a: number } {
  const c = solarCenter();
  const dx = (x - c.x) / SOLAR.STRETCH;
  const dy = y - c.y;
  return { r: Math.hypot(dx, dy), a: Math.atan2(dy, dx) };
}

/** The point at angle `a` on the orbit of radius `r`. */
export function onOrbit(r: number, a: number): { x: number; y: number } {
  const c = solarCenter();
  return { x: c.x + Math.cos(a) * r * SOLAR.STRETCH, y: c.y + Math.sin(a) * r };
}

/** Which of the three sectors an orbit of radius `r` lies in: 0 near the sun, 2 far out. */
export const orbitSector = (r: number): number =>
  Math.min(SOLAR.SECTOR_STEPS.length - 1, Math.max(0, Math.floor(((r - SOLAR.INNER_ORBIT) / (SOLAR.OUTER_ORBIT - SOLAR.INNER_ORBIT)) * SOLAR.SECTOR_STEPS.length)));

/** How far a body on an orbit of radius `r` turns in one step: it moves slowly near the sun and faster farther out. */
export const orbitTurn = (r: number): number => (Math.PI * 2) / SOLAR.SECTOR_STEPS[orbitSector(r)];

/** One orbit: shared by up to three planets (spread evenly round it, same speed), or by some of the ships, who may have a planet along (its radius is in `guests`). */
type Body = { kind: 'planets'; radii: number[] } | { kind: 'ships'; guests: number[] };

/**
 * A sun in the middle, the planets on orbits round it — up to three to an orbit. The ships ride the three outermost orbits — so that after every step the whole system turns and the gravity field with it. The orbits are spaced so
 * that no two bodies ever come near, however far each has turned.
 */
function generateSolarWorld(rng: Rng, opts: WorldOptions): World {
  const { width, height } = FIELD;
  const centre = solarCenter();
  const bands = Math.min(3, opts.players);

  const bodies: Body[] = [];
  // The mode's own planets are small, so more of them fit than on an open field: the setting is the least it draws.
  const wanted = opts.maxPlanets === 0 ? 0 : intRange(rng, Math.max(opts.maxPlanets, 2), Math.max(opts.maxPlanets, 2) + 3);
  const radii = Array.from({ length: wanted }, () => SOLAR.MIN_PLANET + (SOLAR.MAX_PLANET - SOLAR.MIN_PLANET) * Math.pow(rng(), 1.8));
  // A ship's orbit may carry a planet too: same speed, so it keeps its distance from the ships for good.
  const lanes: Body[] = Array.from({ length: bands }, () => ({ kind: 'ships', guests: radii.length > 2 && rng() < 0.7 ? [radii.pop()!] : [] }));
  for (let i = 0; i < radii.length; i += 3) bodies.push({ kind: 'planets', radii: radii.slice(i, i + 3) });
  const half = (b: Body): number => (b.kind === 'planets' ? Math.max(...b.radii) : Math.max(SOLAR.SHIP_BAND, ...b.guests));
  const span = (list: readonly Body[]): number => list.reduce((sum, b) => sum + 2 * half(b) + SOLAR.ORBIT_GAP, -SOLAR.ORBIT_GAP);
  const room = SOLAR.OUTER_ORBIT - SOLAR.INNER_ORBIT;
  bodies.push(...lanes);
  // Too many for the room: the planets give way, the ships' orbits stay.
  while (span(bodies) > room) {
    const last = bodies.map((b) => b.kind).lastIndexOf('planets');
    if (last >= 0) {
      bodies.splice(last, 1);
      continue;
    }
    // Still too much: a guest planet that widens a ship's orbit goes too.
    const wide = lanes.find((l) => l.kind === 'ships' && l.guests.length);
    if (!wide || wide.kind !== 'ships') break;
    wide.guests = [];
  }
  // The planets take the inner orbits, in random order; the ships ride the three outermost.
  const order = [...shuffle(rng, bodies.filter((b) => b.kind === 'planets')), ...bodies.filter((b) => b.kind === 'ships')];
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
  const bandGuests: number[][] = [];
  let cursor = SOLAR.INNER_ORBIT + slack * rng();
  for (const body of order) {
    const r = cursor + half(body);
    cursor += 2 * half(body) + SOLAR.ORBIT_GAP + slack;
    if (body.kind === 'ships') {
      bandRadii.push(r);
      bandGuests.push(body.guests);
      continue;
    }
    const turn = rng() * Math.PI * 2;
    body.radii.forEach((radius, k) => {
      const a = turn + (k * Math.PI * 2) / body.radii.length;
      const style: PlanetStyle = radius > 24 ? pick(rng, ['gas', 'gas', 'rocky', 'ice']) : pick(rng, ['rocky', 'rocky', 'ice']);
      planets.push({
        ...onOrbit(r, a),
        radius,
        mass: range(rng, 0.75, 1.3) * radius ** 3 * SOLAR.PLANET_HEAVY,
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
  const angles: number[][] = bandRadii.map(() => []);
  seats.forEach((player, slot) => {
    const a = offset + (slot * Math.PI * 2) / n;
    const lane = slot % bandRadii.length;
    angles[lane].push(a);
    ships[player] = { ...onOrbit(bandRadii[lane], a), alive: true };
  });
  // The guest planet takes the middle of the widest gap between the ships of its orbit, if it clears them all.
  bandGuests.forEach((guests, lane) => {
    for (const radius of guests) {
      const taken = [...angles[lane]].sort((x, y) => x - y);
      let at = taken[0] + Math.PI;
      let widest = taken.length ? 0 : Math.PI * 2;
      taken.forEach((a, i) => {
        const gap = (i + 1 < taken.length ? taken[i + 1] : taken[0] + Math.PI * 2) - a;
        if (gap > widest) {
          widest = gap;
          at = a + gap / 2;
        }
      });
      const spot = onOrbit(bandRadii[lane], at);
      if (ships.some((sh) => Math.hypot(sh.x - spot.x, sh.y - spot.y) < radius + SOLAR.SHIP_CLEARANCE)) continue;
      const style: PlanetStyle = radius > 24 ? pick(rng, ['gas', 'gas', 'rocky', 'ice']) : pick(rng, ['rocky', 'rocky', 'ice']);
      planets.push({ ...spot, radius, mass: range(rng, 0.75, 1.3) * radius ** 3 * SOLAR.PLANET_HEAVY, seed: Math.floor(rng() * 2 ** 31), style, tint: pick(rng, TINTS[style]) });
      angles[lane].push(at);
    }
  });

  return { width, height, planets, ships, holes: [], nebulae: [], wormholes: [], defenses: [], version: 0 };
}
