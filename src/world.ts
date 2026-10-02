import { FIELD, HORIZON } from './config';
import type { BlackHole, Planet, PlanetStyle, Ship, World } from './physics';
import { createRng, intRange, pick, range, type Rng } from './rng';

const TINTS: Record<PlanetStyle, readonly string[]> = {
  rocky: ['#c9a77c', '#b8664a', '#a39a8a', '#c78f6d'],
  gas: ['#d8b98a', '#9c8bb5', '#c9a0a0', '#b7c28f'],
  ice: ['#9fc3d6', '#bcd3dc', '#8fb3b0'],
};

const SHIP_CLEARANCE = 110;
const PLANET_GAP = 24;
const HOLE_CLEARANCE = 90;

export interface WorldOptions {
  /** Lower bound of the planet count (default 2); the count is drawn between this and `maxPlanets`. */
  minPlanets?: number;
  maxPlanets: number;
  players: number;
  /** Event Horizon: a black hole sits in the middle. */
  blackHole: boolean;
  /** Team per player (team mode), so teammates can start side by side. */
  teams?: readonly number[] | null;
}

/**
 * Lay out a fresh battlefield: ships around the rim, planets in between. Two ships in a classic
 * match face off left vs right like the original; otherwise ships spread around an ellipse.
 * Same seed → same world.
 */
export function generateWorld(seed: number, opts: WorldOptions): World {
  const rng = createRng(seed);
  const { width, height } = FIELD;
  const duel = opts.players === 2 && !opts.blackHole;
  const ships = duel ? duelShips(rng) : ringShips(rng, opts.players, opts.teams ?? null);

  const hole: BlackHole | null = opts.blackHole
    ? {
        x: width / 2 + range(rng, -40, 40),
        y: height / 2 + range(rng, -30, 30),
        radius: HORIZON.START_RADIUS,
        mass: HORIZON.START_MASS,
      }
    : null;

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
    const clearOfHole = !hole || Math.hypot(hole.x - x, hole.y - y) > radius + hole.radius + HOLE_CLEARANCE;
    if (!clearOfShips || !clearOfPlanets || !clearOfHole) continue;

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

  return { width, height, planets, ships, hole, version: 0 };
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
