import { FIELD } from './config';
import type { Planet, PlanetStyle, World } from './physics';
import { createRng, intRange, pick, range } from './rng';

const TINTS: Record<PlanetStyle, readonly string[]> = {
  rocky: ['#c9a77c', '#b8664a', '#a39a8a', '#c78f6d'],
  gas: ['#d8b98a', '#9c8bb5', '#c9a0a0', '#b7c28f'],
  ice: ['#9fc3d6', '#bcd3dc', '#8fb3b0'],
};

const SHIP_CLEARANCE = 110;
const PLANET_GAP = 24;

/**
 * Lay out a fresh battlefield around ships on an evenly spaced inner orbit.
 * Same seed and player count → same world.
 */
export function generateWorld(seed: number, maxPlanets: number, playerCount = 2): World {
  const rng = createRng(seed);
  const { width, height } = FIELD;

  const count = Math.max(2, Math.min(6, Math.floor(playerCount)));
  const cx = width / 2;
  const cy = height / 2;
  const orbit = Math.min(width, height) / 2 - 140;
  const ships: World['ships'] = [];
  for (let i = 0; i < count; i++) {
    const angle = Math.PI + (i / count) * Math.PI * 2;
    ships.push({ x: cx + orbit * Math.cos(angle), y: cy + orbit * Math.sin(angle) });
  }

  const planetCount = intRange(rng, Math.min(2, maxPlanets), maxPlanets);
  const planets: Planet[] = [];
  for (let attempt = 0; planets.length < planetCount && attempt < 600; attempt++) {
    const radius = 16 + 44 * Math.pow(rng(), 1.4);
    const x = range(rng, 270, width - 270);
    const y = range(rng, radius + 24, height - radius - 24);
    const clearOfShips = ships.every((s) => Math.hypot(s.x - x, s.y - y) > radius + SHIP_CLEARANCE);
    const clearOfPlanets = planets.every((p) => Math.hypot(p.x - x, p.y - y) > p.radius + radius + PLANET_GAP);
    if (!clearOfShips || !clearOfPlanets) continue;

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

  return { width, height, planets, ships };
}

