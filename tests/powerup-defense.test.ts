import { describe, expect, it } from 'vitest';
import { createMatch, type Match } from '../src/game';
import { CPU_IGNORES, POWER_UP, POWER_UP_KINDS, aimedSurface } from '../src/powerups';
import { DEFENSE, PHYSICS } from '../src/config';
import { cloneWorld, Shot, simulateShot, type World } from '../src/physics';
import { Volley } from '../src/volley';
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

/**
 * A planet with a defense on its top rim, and the ship on the left firing along a line `above` units over the
 * turret, so the shot crosses the dome high over the rock.
 */
function overhead(protects: number[], above = 30): World {
  const rock = planet(640, 400);
  const radius = rock.radius * POWER_UP.DEFENSE_RADIUS_SHARE;
  return {
    width: 1280, height: 800, planets: [rock],
    ships: [{ x: 100, y: 360 - above, alive: true }, { x: 1180, y: 600, alive: true }],
    holes: [], nebulae: [], wormholes: [], version: 0,
    defenses: [{ x: 640, y: 360, radius, planet: rock.seed, owner: 1, protects }],
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

  it('lets an enemy shot fly on into the dome, locks on to it and shoots it down inside', () => {
    const world = overhead([1]);
    const d = world.defenses[0];
    const shot = new Shot(world, 0, 0, 60, rules);
    let enteredAt: number | null = null;
    let locked = false;
    let end = null;
    while (!end) {
      end = shot.step();
      if (enteredAt === null && Math.hypot(shot.x - d.x, shot.y - d.y) < d.radius) enteredAt = shot.x;
      if (shot.intercepts.length) locked = true;
    }
    expect(end).toEqual({ kind: 'shotdown', defense: 0 });
    expect(locked).toBe(true);
    // It went on into the dome after entering: it was not struck down at the edge.
    expect(shot.x - enteredAt!).toBeGreaterThan(20);
    // And it was hit inside the dome, short of the far edge.
    expect(Math.hypot(shot.x - d.x, shot.y - d.y)).toBeLessThan(d.radius);
  });

  it('fires only once the shot has stayed long enough, and the hit is sure after that', () => {
    const world = overhead([1]);
    const shot = new Shot(world, 0, 0, 60, rules);
    const fires: number[] = [];
    let steps = 0;
    let end = null;
    while (!end) {
      end = shot.step();
      steps++;
      if (shot.intercepts.length) {
        fires.push(steps);
        shot.intercepts.length = 0;
      }
    }
    expect(fires).toHaveLength(1);
    const dt = PHYSICS.DT;
    expect(fires[0] * dt).toBeGreaterThanOrEqual(DEFENSE.LOCK_TIME);
    // From the turret's fire to the hit it is TRAVEL_TIME.
    expect((steps - fires[0]) * dt).toBeGreaterThan(DEFENSE.TRAVEL_TIME - 2 * dt);
    expect((steps - fires[0]) * dt).toBeLessThan(DEFENSE.TRAVEL_TIME + 2 * dt);
  });

  it('lets a fast shot that only clips the dome get through without a lock', () => {
    // The dome's top is 68 above the turret: a shot skimming just under it is inside for a few steps only.
    const world = overhead([1], 70);
    const shot = new Shot(world, 0, 0, 100, rules);
    let end = null;
    let locked = false;
    while (!end) {
      end = shot.step();
      if (shot.intercepts.length) locked = true;
    }
    expect(locked).toBe(false);
    expect(end.kind).not.toBe('shotdown');
  });

  it('forgets a half-made lock when the shot leaves the dome', () => {
    const world = overhead([1]);
    const shot = new Shot(world, 0, 0, 60, rules);
    // Put it inside for a little while, then well outside.
    shot.x = world.defenses[0].x - 30;
    shot.y = world.defenses[0].y - 20;
    for (let i = 0; i < 5; i++) shot.step();
    expect(shot.locks[0]).toBeGreaterThan(0);
    shot.x = 10;
    shot.y = 10;
    shot.step();
    expect(shot.locks[0]).toBe(0);
  });

  it('carries the lock through a fork and through a volley snapshot', () => {
    const world = overhead([1]);
    const shot = new Shot(world, 0, 0, 60, rules);
    shot.x = world.defenses[0].x - 30;
    shot.y = world.defenses[0].y - 20;
    for (let i = 0; i < 5; i++) shot.step();
    expect(shot.fork(0.1).locks).toEqual(shot.locks);

    const volley = new Volley(world, [{ player: 0, angle: 0, power: 60 }], rules, false);
    volley.shots[0].shot.locks[0] = 0.04;
    const saved = volley.snapshot();
    const other = new Volley(world, [{ player: 0, angle: 0, power: 60 }], rules, false);
    other.restore(saved);
    expect(other.shots[0].shot.locks).toEqual([0.04]);
  });

  it('tells the match when the turret fires, from the turret to the shot', () => {
    const world = overhead([1]);
    const volley = new Volley(world, [{ player: 0, angle: 0, power: 60 }], rules, false);
    const events: { type: string; defense?: number }[] = [];
    while (!volley.done) events.push(...volley.step());
    expect(events.filter((e) => e.type === 'intercept')).toEqual([expect.objectContaining({ defense: 0 })]);
    expect(events.filter((e) => e.type === 'end')).toHaveLength(1);
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
    const world = overhead([1]);
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
