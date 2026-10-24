import { describe, expect, it } from 'vitest';
import { createMatch, SolarMatch } from '../src/game';
import { SOLAR, SOLAR_STORM } from '../src/config';
import { DEFAULT_SETTINGS, type Seat } from '../src/settings';
import { inNebula } from '../src/physics';
import { generateWorld, onOrbit, orbitOf, orbitTurn, solarCenter } from '../src/world';

const cpus = (n: number): Seat[] => [...Array(n).fill('medium'), ...Array(6 - n).fill('off')];
const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);

describe('solar system world', () => {
  it.each([2, 3, 4, 6])('puts the sun in the middle and every body on a clear orbit with %i ships', (players) => {
    for (let seed = 1; seed <= 60; seed++) {
      const world = generateWorld(seed, { maxPlanets: 6, players, blackHole: false, solar: true });
      const centre = solarCenter();
      const sun = world.planets[0];
      expect(sun.sun).toBe(true);
      expect(dist(sun, centre)).toBe(0);
      expect(world.ships).toHaveLength(players);
      // Even a full table leaves room for planets.
      expect(world.planets.length).toBeGreaterThanOrEqual(3);
      // Turning the system any amount never brings two bodies closer than they are now on their orbits: compare orbit radii.
      const bodies = [
        ...world.planets.slice(1).map((p) => ({ r: orbitOf(p.x, p.y).r, reach: p.radius })),
        ...world.ships.map((s) => ({ r: orbitOf(s.x, s.y).r, reach: SOLAR.SHIP_BAND / 2 })),
      ];
      for (const b of bodies) {
        expect(b.r - b.reach).toBeGreaterThan(sun.radius);
        expect(b.r + b.reach).toBeLessThan(SOLAR.OUTER_ORBIT + 1);
      }
      for (let i = 0; i < bodies.length; i++) {
        for (let j = i + 1; j < bodies.length; j++) {
          const gap = Math.abs(bodies[i].r - bodies[j].r);
          // Bodies on one orbit keep their distance; others never get nearer than their orbits are apart.
          if (gap > 0.01) expect(gap).toBeGreaterThan(bodies[i].reach + bodies[j].reach);
        }
      }
    }
  });

  it('turns a circle in 4 steps near the sun, 8 in the middle and 12 far out', () => {
    const third = (SOLAR.OUTER_ORBIT - SOLAR.INNER_ORBIT) / 3;
    for (const [r, steps] of [[SOLAR.INNER_ORBIT + 1, 4], [SOLAR.INNER_ORBIT + third * 0.9, 4], [SOLAR.INNER_ORBIT + third * 1.5, 8], [SOLAR.OUTER_ORBIT - third * 0.1, 12], [SOLAR.OUTER_ORBIT, 12]] as const) {
      expect(orbitTurn(r) * steps).toBeCloseTo(Math.PI * 2, 9);
    }
  });
});

describe('solar system orbits', () => {
  it('never bring two bodies into contact however long the system turns', () => {
    let tightest = Infinity;
    for (let seed = 1; seed <= 25; seed++) {
      const world = generateWorld(seed, { maxPlanets: 6, players: 6, blackHole: false, solar: true });
      const bodies = [
        ...world.planets.slice(1).map((p) => ({ o: p, reach: p.radius })),
        ...world.ships.map((s) => ({ o: s, reach: 8 })),
      ];
      for (let step = 0; step < 200; step++) {
        for (const { o } of bodies) {
          const { r, a } = orbitOf(o.x, o.y);
          const to = onOrbit(r, a + orbitTurn(r) * 0.2);
          o.x = to.x;
          o.y = to.y;
        }
        for (let i = 0; i < bodies.length; i++) {
          for (let j = i + 1; j < bodies.length; j++) tightest = Math.min(tightest, dist(bodies[i].o, bodies[j].o) - bodies[i].reach - bodies[j].reach);
        }
        for (const { o, reach } of bodies) tightest = Math.min(tightest, dist(o, solarCenter()) - SOLAR.SUN_RADIUS - reach);
      }
    }
    expect(tightest).toBeGreaterThan(0);
  });
});

describe('solar system match', () => {
  it('turns the planets and ships round the sun after a volley, keeping their orbits', () => {
    const seats = cpus(3);
    const match = createMatch('solar', { ...DEFAULT_SETTINGS, rounds: 1, seats }, { seats, seed: 5, deterministicCpu: true });
    try {
      expect(match).toBeInstanceOf(SolarMatch);
      const radii = () => [...match.world.planets.map((p) => orbitOf(p.x, p.y).r), ...match.world.ships.map((s) => orbitOf(s.x, s.y).r)];
      const before = radii();
      const sun = { ...match.world.planets[0] };
      const first = { ...match.world.planets[1] };
      let turned = false;
      for (let t = 0; t < 400 && match.phase !== 'roundOver'; t += 1 / 30) {
        match.update(1 / 30);
        if (match.phase === 'orbit') turned = true;
        if (match.phase === 'killcam') match.advance();
      }
      expect(turned).toBe(true);
      expect(match.world.planets[0].x).toBe(sun.x);
      expect(match.world.planets[0].y).toBe(sun.y);
      if (match.world.planets[1].seed === first.seed) expect(dist(match.world.planets[1], first)).toBeGreaterThan(1);
      radii().forEach((r, i) => expect(r).toBeCloseTo(before[i], 3));
    } finally {
      match.dispose();
    }
  });

  it('plays a round to its end with CPUs', () => {
    const seats = cpus(2);
    const match = createMatch('solar', { ...DEFAULT_SETTINGS, rounds: 1, seats }, { seats, seed: 9, deterministicCpu: true });
    try {
      for (let t = 0; t < 900 && match.phase !== 'gameOver'; t += 1 / 30) {
        match.update(1 / 30);
        if (match.phase === 'roundOver') match.advance();
      }
      expect(match.phase).toBe('gameOver');
    } finally {
      match.dispose();
    }
  });
});

describe('the sun\'s storm', () => {
  const solar = (seed: number, players = 3, rounds = 1): SolarMatch => {
    const seats = cpus(players);
    return createMatch('solar', { ...DEFAULT_SETTINGS, rounds, seats }, { seats, seed, deterministicCpu: true }) as SolarMatch;
  };
  /** The storm, set off at once. */
  const erupt = (match: SolarMatch): void => (match as unknown as { erupt(): void }).erupt();

  it('breaks out in a played round, as the system turns', () => {
    const match = solar(3, 4);
    try {
      // Keep this integration check quick and deterministic: make the natural storm timing the first pass.
      (match as unknown as { stormAt: number }).stormAt = 1;
      for (let t = 0; t < 1200 && match.phase !== 'gameOver'; t += 1 / 30) {
        match.update(1 / 30);
        if (match.phase === 'killcam') match.advance();
        const storm = match.world.nebulae.filter((n) => n.storm).length;
        if (storm === 0) continue;
        // The clouds are over the field before anybody can aim again.
        expect(match.phase).toBe('orbit');
        expect(storm).toBeGreaterThanOrEqual(1);
        expect(storm).toBeLessThanOrEqual(SOLAR_STORM.MAX_CLOUDS);
        return;
      }
      expect(match.world.nebulae.some((n) => n.storm)).toBe(true);
    } finally {
      match.dispose();
    }
  });

  it('turns the system once every ship has fired, not after each shot', () => {
    const match = solar(11, 3);
    try {
      const planets = () => match.world.planets.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join('|');
      const start = planets();
      const fired = new Set<number>();
      let turned = false;
      for (let t = 0; t < 600 && !turned; t += 1 / 30) {
        if (match.phase === 'aiming') fired.add(match.current);
        match.update(1 / 30);
        if (match.phase === 'killcam') match.advance();
        if (match.phase === 'orbit') {
          turned = true;
          // Everybody still in had a shot first.
          for (const p of match.alive) expect(fired.has(p.id)).toBe(true);
        } else {
          // Until the pass is over the planets stand still.
          expect(planets()).toBe(start);
        }
      }
      expect(turned).toBe(true);
      expect(fired.size).toBeGreaterThanOrEqual(2);
    } finally {
      match.dispose();
    }
  });

  it('lays a few clouds on the field, away from one another and the edge', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const match = solar(seed);
      erupt(match);
      const clouds = match.world.nebulae.filter((n) => n.storm);
      expect(clouds.length).toBeGreaterThanOrEqual(2);
      expect(clouds.length).toBeLessThanOrEqual(SOLAR_STORM.MAX_CLOUDS);
      for (const c of clouds) {
        expect(c.radius).toBeGreaterThanOrEqual(SOLAR_STORM.MIN_RADIUS);
        expect(c.radius).toBeLessThanOrEqual(SOLAR_STORM.MAX_RADIUS);
        expect(c.x).toBeGreaterThan(0);
        expect(c.x).toBeLessThan(1280);
        expect(c.y).toBeGreaterThan(0);
        expect(c.y).toBeLessThan(800);
      }
      for (let i = 0; i < clouds.length; i++) for (let j = i + 1; j < clouds.length; j++) expect(dist(clouds[i], clouds[j])).toBeGreaterThanOrEqual((clouds[i].radius + clouds[j].radius) * SOLAR_STORM.OVERLAP);
      match.dispose();
    }
  });

  it('counts as a nebula to the physics', () => {
    expect(inNebula([{ x: 100, y: 100, radius: 50, seed: 0.5, storm: true }], 120, 100)).toBe(true);
    expect(inNebula([{ x: 100, y: 100, radius: 50, seed: 0.5, storm: true }], 200, 100)).toBe(false);
  });

  it('thins away again a few passes after it broke out, as the system turns', () => {
    const match = solar(9, 3);
    try {
      const inner = match as unknown as { passes: number; stormAt: number; fired: Set<number>; afterVolley(): void };
      erupt(match);
      expect(match.world.nebulae.some((n) => n.storm)).toBe(true);
      // The pass before the last of the storm's life: the clouds still lie there.
      inner.passes = inner.stormAt + SOLAR_STORM.LIFETIME - 1;
      inner.fired = new Set(match.alive.map((p) => p.id));
      inner.afterVolley();
      expect(match.phase).toBe('orbit');
      expect(match.world.nebulae.filter((n) => n.storm).every((n) => n.fading)).toBe(true);
      expect(match.world.nebulae.some((n) => n.storm)).toBe(true);
      for (let t = 0; t < 10 && match.phase === 'orbit'; t += 1 / 30) match.update(1 / 30);
      expect(match.phase).not.toBe('orbit');
      expect(match.world.nebulae.some((n) => n.storm)).toBe(false);
    } finally {
      match.dispose();
    }
  });

  it('is gone with the round', () => {
    const match = solar(7, 2, 2);
    try {
      erupt(match);
      expect(match.world.nebulae.some((n) => n.storm)).toBe(true);
      match.startRound();
      expect(match.world.nebulae.some((n) => n.storm)).toBe(false);
    } finally {
      match.dispose();
    }
  });
});

describe('a CPU holding a placement it cannot lay', () => {
  it('shoots with one smooth swing instead of twitching between the placement spot and its shot', () => {
    const seats = cpus(2);
    const match = createMatch('solar', { ...DEFAULT_SETTINGS, rounds: 1, seats, powerUps: true }, { seats, seed: 4, deterministicCpu: true }) as SolarMatch;
    (match as unknown as { placeForCpu: () => boolean }).placeForCpu = () => false;
    match.players[match.current].powerUp = 'blackhole';
    const shooter = match.players[match.current];
    let last = shooter.angle;
    let heading = 0;
    let reversals = 0;
    for (let t = 0; t < 10 && match.phase === 'aiming'; t += 1 / 60) {
      match.update(1 / 60);
      const turned = ((shooter.angle - last + 540) % 360) - 180;
      if (turned !== 0) {
        if (heading && Math.sign(turned) !== heading) reversals++;
        heading = Math.sign(turned);
      }
      last = shooter.angle;
    }
    expect(match.phase).not.toBe('aiming');
    // Once is fine: from the placement spot over to the shot. Every frame is the twitch.
    expect(reversals).toBeLessThanOrEqual(1);
  });
});
