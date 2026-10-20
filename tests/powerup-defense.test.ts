import { describe, expect, it } from 'vitest';
import { createMatch, type Match } from '../src/game';
import { CPU_IGNORES, POWER_UP, POWER_UP_KINDS, aimedSurface } from '../src/powerups';
import { cloneWorld, Shot, simulateShot, type World } from '../src/physics';
import { DEFAULT_SETTINGS } from '../src/settings';

const rules = { bounce: false, timeLimit: 20 };

function duel(seed = 7): Match {
  const seats = ['human', 'human', 'off', 'off', 'off', 'off'] as const;
  return createMatch('classic', { ...DEFAULT_SETTINGS, powerUps: true, rounds: 1, maxPlanets: 0, seats: [...seats] }, { seats: [...seats], seed });
}

const planet = (x: number, y: number, radius = 40) => ({ x, y, radius, mass: 30_000, seed: 9, style: 'rocky' as const, tint: '#fff' });

/** A world with one planet between two ships on a line, and a defense on the planet's left rim. */
function guarded(protects: number[]): World {
  const rock = planet(640, 400);
  return {
    width: 1280, height: 800, planets: [rock],
    ships: [{ x: 100, y: 400, alive: true }, { x: 1180, y: 400, alive: true }],
    holes: [], nebulae: [], wormholes: [], version: 0,
    defenses: [{ x: 600, y: 400, radius: rock.radius * POWER_UP.DEFENSE_RADIUS_SHARE, planet: rock.seed, owner: 1, protects }],
  };
}

describe('planetary defense power-up', () => {
  it('is a known kind that a CPU takes up', () => {
    expect(POWER_UP_KINDS).toContain('defense');
    expect(CPU_IGNORES.defense).toBeUndefined();
  });

  it('aims at the rim of the first planet on the ray, facing the ship', () => {
    const world = guarded([]);
    const spot = aimedSurface(world, world.ships[0], 0)!;
    expect(spot.x).toBeCloseTo(600, 0);
    expect(spot.y).toBeCloseTo(400, 0);
    expect(spot.radius).toBe(40 * POWER_UP.DEFENSE_RADIUS_SHARE);
    expect(aimedSurface(world, world.ships[0], 90)).toBeNull();
  });

  it('shoots down an enemy shot that enters its ring', () => {
    const world = guarded([1]);
    const shot = new Shot(world, 0, 0, 60, rules);
    let end = null;
    while (!end) end = shot.step();
    expect(end).toEqual({ kind: 'shotdown', defense: 0 });
    // It never reached the planet's far side, let alone the ship.
    expect(shot.x).toBeLessThan(560);
    expect(shot.x).toBeGreaterThan(520);
  });

  it('lets the shots of the side it protects fly on', () => {
    const world = guarded([0]);
    const outcome = simulateShot(world, 0, 0, 60, rules);
    expect(outcome.end.kind).toBe('planet');
  });

  it('only guards the side above the surface: a shot passing the far side is not touched', () => {
    const world = guarded([1]);
    // From the right ship, flying left, the planet is in the way first.
    const outcome = simulateShot(world, 1, 180, 60, rules);
    expect(outcome.end.kind).toBe('planet');
  });

  it('shoots down a piercing shot too', () => {
    const world = guarded([1]);
    const outcome = simulateShot(world, 0, 0, 60, rules, [], 1, [], true);
    expect(outcome.end.kind).toBe('shotdown');
  });

  it('is aimed with the power-up key, fire sets it, and it spends the shot', () => {
    const match = duel();
    const shooter = match.players[match.current];
    const ship = match.world.ships[shooter.id];
    const rock = planet(ship.x + 400, ship.y);
    match.world.planets = [rock];
    const events: string[] = [];
    match.on((e) => events.push(e.type));

    shooter.powerUp = 'defense';
    shooter.angle = 0;
    shooter.power = 50;
    match.usePowerUp();
    expect(match.placing).toBe(true);
    expect(match.scene().placement!.kind).toBe('defense');
    expect(match.scene().placement!.target!.x).toBeCloseTo(rock.x - rock.radius, 3);

    match.commit();
    expect(match.world.defenses).toHaveLength(1);
    expect(match.world.defenses[0].radius).toBe(rock.radius * POWER_UP.DEFENSE_RADIUS_SHARE);
    expect(match.world.defenses[0].protects).toContain(shooter.id);
    expect(events).toContain('defense');
    expect(shooter.powerUp).toBeNull();
    expect(shooter.passed).toBe(true);
  });

  it('keeps the power-up when the ray meets no planet', () => {
    const match = duel();
    const shooter = match.players[match.current];
    shooter.powerUp = 'defense';
    shooter.angle = 0;
    match.usePowerUp();
    expect(match.scene().placement!.target).toBeNull();
    match.commit();
    expect(shooter.powerUp).toBe('defense');
  });

  it('goes with its planet when a planet killer takes the rock', () => {
    const match = duel();
    const shooter = match.players[match.current];
    const ship = match.world.ships[shooter.id];
    const rock = planet(ship.x + 400, ship.y);
    match.world.planets = [rock];
    match.world.defenses = [{ x: rock.x - rock.radius, y: rock.y, radius: 20, planet: rock.seed, owner: shooter.id, protects: [shooter.id] }];
    shooter.powerUp = 'planetkiller';
    shooter.angle = 0;
    match.usePowerUp();
    match.commit();
    expect(match.world.planets).toHaveLength(0);
    expect(match.world.defenses).toHaveLength(0);
  });

  it('is copied whole by cloneWorld', () => {
    const world = guarded([0, 1]);
    const copy = cloneWorld(world);
    copy.defenses[0].protects.push(2);
    expect(world.defenses[0].protects).toEqual([0, 1]);
  });
});
