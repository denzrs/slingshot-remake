import { normalizeAngle, type World } from '../sim/physics';
import { aimedPlanet, cpuWormholeSpots, POWER_UP } from '../sim/powerups';
import { AIM } from '../sim/config';
import type { Aim } from '../sim/ai';
import type { PlayerState } from './match-types';

/**
 * Where a CPU lays the placement it holds, as an aim: a rough spot, never a searched one. A black hole or
 * a nebula goes part way along the line to the nearest enemy, so that enemy's next shot runs into it; a defense
 * stands on the planet nearest the CPU, on the side that faces it; the
 * planet killer shoots the planet lying most in the way of that line; a antigravity turns the planet nearest the CPU
 * that still pulls (so the shots coming at it are pushed away); a wormhole aims at its first portal, the second
 * lying near the enemy. Null when the CPU holds no placement, or there is nothing to lay it on.
 */
export function cpuPlacementAim(world: World, players: readonly PlayerState[], p: PlayerState, friends: readonly number[]): Aim | null {
  const kind = p.powerUp;
  if (kind !== 'blackhole' && kind !== 'nebula' && kind !== 'planetkiller' && kind !== 'defense' && kind !== 'wormhole' && kind !== 'antigravity') return null;
  const from = world.ships[p.id];
  const enemies = players
    .filter((q) => q.alive && q.id !== p.id && !friends.includes(q.id))
    .map((q) => world.ships[q.id])
    .sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y));
  const reach = (POWER_UP.TELEPORT_MAX_POWER / AIM.MAX_POWER) * POWER_UP.TELEPORT_RANGE;
  const to = enemies[0] ?? from;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const span = dx * dx + dy * dy;
  /** How far a planet sits off the line the CPU shoots along — small means it is in the way. */
  const laneGap = (planet: { x: number; y: number }): number => {
    const t = span ? Math.max(0, Math.min(1, ((planet.x - from.x) * dx + (planet.y - from.y) * dy) / span)) : 0;
    return Math.hypot(from.x + t * dx - planet.x, from.y + t * dy - planet.y);
  };
  let spot: { x: number; y: number };
  if (kind === 'defense') {
    // On the planet nearest its own ship, on the side that faces it: the shots coming at the CPU pass there.
    const near = world.planets.filter((planet) => !planet.sun).sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y))[0];
    if (!near) return null;
    return { angle: normalizeAngle((Math.atan2(-(near.y - from.y), near.x - from.x) * 180) / Math.PI), power: 0 };
  }
  if (kind === 'antigravity') {
    // The nearest planet that pulls and that the aim would really meet first, so the placement lands on it.
    const angleTo = (planet: { x: number; y: number }): number => normalizeAngle((Math.atan2(-(planet.y - from.y), planet.x - from.x) * 180) / Math.PI);
    const near = world.planets
      .map((planet, index) => ({ planet, index }))
      .filter(({ planet, index }) => !planet.reversed && aimedPlanet(world, from, angleTo(planet))?.index === index)
      .sort((a, b) => Math.hypot(a.planet.x - from.x, a.planet.y - from.y) - Math.hypot(b.planet.x - from.x, b.planet.y - from.y))[0];
    if (!near) return null;
    return { angle: angleTo(near.planet), power: 0 };
  }
  if (kind === 'wormhole') {
    const spots = enemies[0] && cpuWormholeSpots(world, from, enemies[0], p.id);
    if (!spots) return null;
    spot = spots[0];
  } else if (kind === 'planetkiller') {
    // Never the sun: the aim passes over it, so a placement there meets nothing.
    const byGap = world.planets.filter((planet) => !planet.sun).sort((a, b) => laneGap(a) - laneGap(b));
    if (!byGap.length) return null;
    spot = { x: byGap[0].x, y: byGap[0].y };
  } else {
    // A little ahead of its own ship, on the way in: near enough for the enemy's shot to meet it.
    const d = Math.hypot(dx, dy) || 1;
    let along = Math.min(0.45 * d, reach);
    if (kind === 'blackhole') {
      // Short of the zone around the enemy, which a hole may not be laid in; too close for that, it keeps the hole.
      along = Math.min(along, d - POWER_UP.BLACKHOLE_PLAYER_GAP - 5);
      if (along < 60) return null;
    }
    spot = { x: from.x + (dx / d) * along, y: from.y + (dy / d) * along };
  }
  const distance = Math.hypot(spot.x - from.x, spot.y - from.y);
  return {
    angle: normalizeAngle((Math.atan2(-(spot.y - from.y), spot.x - from.x) * 180) / Math.PI),
    power: Math.min(POWER_UP.TELEPORT_MAX_POWER, (distance / POWER_UP.TELEPORT_RANGE) * AIM.MAX_POWER),
  };
}
