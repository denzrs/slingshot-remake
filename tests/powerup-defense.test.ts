import { describe, expect, it } from 'vitest';
import { createMatch, type Match } from '../src/game';
import { CPU_IGNORES, POWER_UP, POWER_UP_KINDS, aimedSurface } from '../src/powerups';
import { cloneWorld, defenseChance, Shot, simulateShot, type World } from '../src/physics';
import { Volley } from '../src/volley';
import { DEFENSE } from '../src/config';
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
 * turret, so the shot crosses the area high over the rock.
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

  it('fires one missile as an enemy shot flies into the area, and none before', () => {
    const world = overhead([1]);
    const d = world.defenses[0];
    const shot = new Shot(world, 0, 0, 60, rules);
    let fired = 0;
    let end = null;
    while (!end && shot.x < 1000) {
      const inside = Math.hypot(shot.x - d.x, shot.y - d.y) < d.radius;
      end = shot.step();
      if (shot.launches.length) {
        fired += shot.launches.length;
        // The step that fired was the one that took the shot into the area.
        expect(inside || Math.hypot(shot.x - d.x, shot.y - d.y) < d.radius).toBe(true);
        shot.launches.length = 0;
      }
      if (fired === 0) expect(shot.missiles).toHaveLength(0);
    }
    expect(fired).toBe(1);
  });

  it('hits only as surely as the zone the missile catches the shot in', () => {
    const d = overhead([1]).defenses[0];
    expect(defenseChance(d, d.radius * 0.2)).toBe(1);
    expect(defenseChance(d, d.radius * 0.5)).toBe(0.5);
    expect(defenseChance(d, d.radius * 0.9)).toBe(0.25);
    expect(defenseChance(d, d.radius * 1.1)).toBe(0);
    // Whatever the dice say, a hit means they said less than the chance where the shot was caught.
    for (const roll of [0.01, 0.2, 0.4, 0.6, 0.999]) {
      const world = overhead([1]);
      const shot = new Shot(world, 0, 0, 60, rules);
      let end = null;
      let caught: number | null = null;
      let launched = false;
      let missile = { x: 0, y: 0 };
      while (!end && shot.x < 1000) {
        const misses = shot.misses.length;
        if (shot.missiles.length) missile = { x: shot.missiles[0].x, y: shot.missiles[0].y };
        end = shot.step();
        if (shot.missiles.length && !launched) {
          launched = true;
          shot.missiles[0].roll = roll;
        }
        if (shot.misses.length > misses) caught = Math.hypot(shot.misses[misses].x - d.x, shot.misses[misses].y - d.y);
      }
      expect(launched).toBe(true);
      if (end?.kind === 'shotdown') {
        // The missile meets the shot a little short of it, and the odds are those where the missile is.
        expect(roll).toBeLessThan(defenseChance(d, Math.hypot(missile.x - d.x, missile.y - d.y)));
      } else if (caught !== null) {
        expect(roll).toBeGreaterThanOrEqual(defenseChance(d, caught));
      }
    }
  });

  it('shoots a shot down in the area, not at its edge, when the dice are kind', () => {
    const world = overhead([1]);
    const d = world.defenses[0];
    const shot = new Shot(world, 0, 0, 60, rules);
    let entered: number | null = null;
    let end = null;
    let launched = false;
    while (!end) {
      end = shot.step();
      if (shot.missiles.length && !launched) {
        launched = true;
        shot.missiles[0].roll = 0.01;
      }
      if (entered === null && Math.hypot(shot.x - d.x, shot.y - d.y) < d.radius) entered = shot.x;
    }
    expect(end).toEqual({ kind: 'shotdown', defense: 0 });
    // It flew on into the area after entering: it was not struck down at the edge.
    expect(shot.x - entered!).toBeGreaterThan(20);
    expect(Math.hypot(shot.x - d.x, shot.y - d.y)).toBeLessThan(d.radius);
  });

  it('lets a shot through when the dice are unkind, and the missile that lost it flies on and is gone', () => {
    // The shot's closest pass is 100 above the turret: the best odds on offer are the middle zone's.
    const world = overhead([1], 100);
    world.width = 6000;
    const shot = new Shot(world, 0, 0, 60, rules);
    let launched = false;
    let lostAt = -1;
    let gone = false;
    for (let step = 0; step < 4000 && !shot.end; step++) {
      shot.step();
      if (shot.missiles.length && !launched) {
        launched = true;
        shot.missiles[0].roll = 0.999;
      }
      if (lostAt < 0 && shot.misses.length) lostAt = step;
      if (lostAt >= 0 && !shot.missiles.length) {
        gone = true;
        break;
      }
    }
    // A 0.999 roll beats only a sure hit: this shot never gets into the inner zone, so it misses.
    expect(lostAt).toBeGreaterThanOrEqual(0);
    expect(shot.end?.kind).not.toBe('shotdown');
    expect(gone).toBe(true);
  });

  it('meets the same luck for the same aim, and other luck for another', () => {
    const a = new Shot(overhead([1]), 0, 0, 60, rules);
    const b = new Shot(overhead([1]), 0, 0, 60, rules);
    const c = new Shot(overhead([1]), 0, 0.2, 60, rules);
    expect(a.seed).toBe(b.seed);
    expect(a.seed).not.toBe(c.seed);
    expect(a.fork(0.1).seed).not.toBe(a.seed);
  });

  it('fires from every defense that covers the shot, once each', () => {
    const world = overhead([1]);
    world.defenses.push({ ...world.defenses[0], x: 700, y: 365 });
    const shot = new Shot(world, 0, 0, 60, rules);
    const fired = new Set<number>();
    let end = null;
    while (!end && shot.x < 900) {
      end = shot.step();
      for (const launch of shot.launches) {
        expect(fired.has(launch.defense)).toBe(false);
        fired.add(launch.defense);
      }
      shot.launches.length = 0;
    }
    expect(fired.size).toBeGreaterThan(0);
    expect(fired.size).toBeLessThanOrEqual(2);
  });

  it('holds its fire until a missile can catch the shot where the odds are best', () => {
    const world = overhead([1], 30);
    const d = world.defenses[0];
    const shot = new Shot(world, 0, 0, 60, rules);
    let launchedAt = -1;
    let caught: number | null = null;
    for (let i = 0; i < 4000; i++) {
      const end = shot.step();
      if (shot.launches.length && launchedAt < 0) launchedAt = Math.hypot(shot.x - d.x, shot.y - d.y);
      if (end) {
        caught = Math.hypot(shot.x - d.x, shot.y - d.y);
        expect(end.kind).toBe('shotdown');
        break;
      }
    }
    // It did not launch at the rim of the area, and the catch is in the sure inner zone.
    expect(launchedAt).toBeLessThan(d.radius * 0.99);
    expect(caught).not.toBeNull();
    // The shot is caught within a missile's reach of the sure zone's line.
    expect(caught!).toBeLessThan(d.radius * 0.4 + DEFENSE.HIT_RADIUS * 2);
  });

  it('carries its missiles through a fork and through a volley snapshot', () => {
    const world = overhead([1]);
    const shot = new Shot(world, 0, 0, 60, rules);
    for (let i = 0; i < 400 && !shot.missiles.length; i++) shot.step();
    for (let i = 0; i < 2; i++) shot.step();
    expect(shot.missiles.length).toBe(1);
    const fork = shot.fork(0.1);
    expect(fork.fired).toEqual(shot.fired);
    expect(fork.missiles).toEqual(shot.missiles);
    expect(fork.missiles[0]).not.toBe(shot.missiles[0]);

    const volley = new Volley(world, [{ player: 0, angle: 0, power: 60 }], rules, false);
    const live = volley.shots[0].shot;
    for (let i = 0; i < 400 && !live.missiles.length; i++) volley.step();
    for (let i = 0; i < 2; i++) volley.step();
    const saved = JSON.parse(JSON.stringify(volley.snapshot()));
    const other = new Volley(world, [{ player: 0, angle: 0, power: 60 }], rules, false);
    other.restore(saved);
    expect(other.shots[0].shot.missiles).toEqual(live.missiles);
    expect(other.shots[0].shot.fired).toEqual(live.fired);
  });

  it('tells the match when a missile is fired, and how it ended', () => {
    const world = overhead([1]);
    const volley = new Volley(world, [{ player: 0, angle: 0, power: 60 }], rules, false);
    const events: { type: string; defense?: number }[] = [];
    while (!volley.done) events.push(...volley.step());
    expect(events.filter((e) => e.type === 'intercept')).toEqual([expect.objectContaining({ defense: 0 })]);
    expect(events.filter((e) => e.type === 'end')).toHaveLength(1);
    const outcome = events.filter((e) => e.type === 'interceptMiss').length + (events.some((e) => e.type === 'end' && (e as { end?: { kind: string } }).end?.kind === 'shotdown') ? 1 : 0);
    expect(outcome).toBeGreaterThanOrEqual(1);
  });

  it('lets the shots of the side it protects fly on', () => {
    const world = guarded([0]);
    const outcome = simulateShot(world, 0, 0, 60, rules);
    expect(outcome.end.kind).toBe('planet');
  });

  it('goes for a piercing shot like any other', () => {
    const world = overhead([1]);
    const shot = new Shot(world, 0, 0, 60, rules, false, [], true);
    let launched = false;
    while (!shot.end && shot.x < 1000) {
      shot.step();
      if (shot.missiles.length && !launched) {
        launched = true;
        shot.missiles[0].roll = 0.01;
      }
    }
    expect(launched).toBe(true);
    expect(shot.end?.kind).toBe('shotdown');
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

  it('has one defense to a planet: a second set on it replaces the first, whoever set it', () => {
    const match = duel();
    const [a, b] = [match.players[match.current], match.players[1 - match.current]];
    const [shipA, shipB] = [match.world.ships[a.id], match.world.ships[b.id]];
    const rock = planet((shipA.x + shipB.x) / 2, (shipA.y + shipB.y) / 2);
    match.world.planets = [rock];
    const toward = (from: { x: number; y: number }): number => (Math.atan2(-(rock.y - from.y), rock.x - from.x) * 180) / Math.PI;

    a.powerUp = 'defense';
    a.angle = toward(shipA);
    match.usePowerUp();
    match.commit();
    expect(match.world.defenses).toHaveLength(1);
    expect(match.world.defenses[0].owner).toBe(a.id);

    // The other player sets theirs on the same rock, from their side.
    const spot = aimedSurface(match.world, shipB, toward(shipB))!;
    (match.power as unknown as { plantDefense(id: number, spot: object): boolean }).plantDefense(b.id, spot);
    expect(match.world.defenses).toHaveLength(1);
    expect(match.world.defenses[0].owner).toBe(b.id);
    expect(match.world.defenses[0].protects).toContain(b.id);
    expect(match.world.defenses[0].protects).not.toContain(a.id);
  });

  describe('collateral damage', () => {
    const run = (volley: Volley, steps = 4000) => {
      const events = [];
      for (let i = 0; i < steps && !volley.done; i++) events.push(...volley.step());
      return events;
    };

    it('sends a missile that lost its shot on as a shot of its own, for the defense owner', () => {
      // A shot that only grazes the middle zone is caught at 50 %, so some aim loses its missile; look for a flight that does.
      let found = null;
      for (let power = 30; power <= 100 && !found; power += 2) {
        const world = overhead([1], 100);
        const volley = new Volley(world, [{ player: 0, angle: 0, power }], rules, false);
        run(volley);
        if (volley.shots.length > 1) found = volley;
      }
      expect(found).not.toBeNull();
      const stray = found!.shots[1];
      expect(stray.stray).toBe(true);
      expect(stray.owner).toBe(1);
      expect(stray.shot.end).not.toBeNull();
      expect(stray.trail.length).toBeGreaterThan(4);
    });

    it('bends in gravity and runs out its time like any shot', () => {
      const world = overhead([1], 30);
      const volley = new Volley(world, [{ player: 0, angle: 0, power: 60 }], { bounce: false, timeLimit: 3 }, false);
      const shot = volley.shots[0].shot;
      shot.missiles.push({ defense: 0, x: 400, y: 100, heading: 0, speed: 1000, age: 5, roll: 1, chasing: true, trail: [400, 100] });
      for (let i = 0; i < 10 && volley.shots.length < 2; i++) volley.step();
      expect(volley.shots).toHaveLength(2);
      const stray = volley.shots[1].shot;
      const speed0 = Math.hypot(stray.vx, stray.vy);
      expect(speed0).toBeCloseTo(1000, 0);
      for (let i = 0; i < 40; i++) stray.step();
      // Gravity has turned it: it no longer flies exactly along its launch heading.
      expect(Math.abs(stray.vy)).toBeGreaterThan(0.01);
      volley.step();
      for (let i = 0; i < 2000 && !stray.end; i++) stray.step();
      expect(stray.end).not.toBeNull();
    });

    it('hits an unprotected ship it meets, and passes through its owner\'s side', () => {
      for (const [protects, dies] of [[[1], true], [[0, 1], false]] as const) {
        const world = guarded([...protects]);
        const volley = new Volley(world, [{ player: 0, angle: 90, power: 20 }], rules, false);
        // A missile on its way left, straight at ship 0, which it lost its shot near.
        volley.shots[0].shot.missiles.push({ defense: 0, x: 200, y: 400, heading: Math.PI, speed: 1000, age: 5, roll: 1, chasing: true, trail: [200, 400] });
        const stepsLimit = 400;
        for (let i = 0; i < stepsLimit && volley.shots.length < 2; i++) volley.step();
        expect(volley.shots[1]?.shot.shooter).toBe(1);
        const stray = volley.shots[1].shot;
        for (let i = 0; i < 2000 && !stray.end; i++) volley.step();
        expect(stray.end?.kind === 'ship' && stray.end.ship === 0).toBe(dies);
      }
    });
  });
});
